"""The page the kiosk shows (127.0.0.1 only): static files, an event stream and button actions."""
import asyncio
import json
import logging
import re
import time
import urllib.parse

from aiohttp import web

from . import __version__, music_api, update, weather
from .app import ROOT, Client, local_ip

log = logging.getLogger(__name__)
WEB = ROOT / 'web'
# changes on every restart (every deploy restarts the client): the page reloads itself when it
# reconnects to a different run, so the kiosk never keeps running an old app.js
BUILD = str(int(time.time()))


def make_app(client: Client):
    app = web.Application()

    def _resolve_ytm(video_id):
        """面板播放器放 YouTube Music：向网关要流地址（网关的助手缓存到签名快过期）。在线程里调。"""
        import urllib.parse
        import urllib.request
        url = (client.cfg.get('hub_http') or '') + '/kiosk/music/ytm/resolve?id=' + urllib.parse.quote(video_id)
        with urllib.request.urlopen(url, timeout=40) as r:
            data = json.loads(r.read().decode('utf-8'))
        if not data.get('url'):
            raise RuntimeError(data.get('error') or data.get('message') or '网关没给流地址')
        return data['url']

    if getattr(client, 'cfg', None) and client.cfg.get('hub_http'):
        music_api.resolver = _resolve_ytm

    async def index(_request):
        # the second design (orb with a face) is the UI since 2026-10-31; /v1 keeps the first one
        return web.FileResponse(WEB / 'v2' / 'index.html', headers={'Cache-Control': 'no-cache'})

    async def index_v1(_request):
        return web.FileResponse(WEB / 'index.html', headers={'Cache-Control': 'no-cache'})

    async def events(request):
        resp = web.StreamResponse(headers={'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache'})
        await resp.prepare(request)
        q = asyncio.Queue()
        client.events.queues.add(q)
        try:
            q.put_nowait(('snapshot', {**client.snapshot(), 'build': BUILD, 'version': __version__,
                                       'update': update.read()}))
            while True:
                try:
                    event, data = await asyncio.wait_for(q.get(), timeout=15)
                    await resp.write(f'event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'.encode())
                except asyncio.TimeoutError:
                    await resp.write(b': keepalive\n\n')
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            client.events.queues.discard(q)
        return resp

    def action(coro_fn):
        async def handler(_request):
            asyncio.create_task(coro_fn())
            return web.json_response({'ok': True})
        return handler

    async def text(request):
        body = await request.json()
        asyncio.create_task(client.say(body.get('text', '')))
        return web.json_response({'ok': True})

    forecast = weather.Weather((getattr(client, 'cfg', None) or {}).get('weather_city', '广州'))

    async def weather_now(_request):
        # the home screen line; empty when the network or the service is down (never an error page)
        return web.json_response(await forecast.get() or {})

    async def model(request):
        body = await request.json()
        return web.json_response(await client.set_model(body.get('kind'), body.get('vendor'), body.get('entry')))

    async def devices(_request):
        # the settings card's first paint; later changes come on /events as 'devices'
        return web.json_response(client.devices)

    async def device_set(request):
        body = await request.json()
        entity_id = body.get('entity_id') or ''
        action = body.get('action') or ''
        if not entity_id or not action:
            return web.json_response({'ok': False, 'error': '缺少 entity_id 或 action'}, status=400)
        result = await client.set_device(entity_id, action, body.get('value'))
        return web.json_response(result, status=200 if result.get('ok') else 409)

    async def sleep_setting(request):
        body = await request.json()
        try:
            value = await client.set_sleep(**{k: body.get(k) for k in ('enabled', 'start', 'end')})
        except ValueError as e:
            return web.json_response({'ok': False, 'error': str(e)}, status=400)
        return web.json_response({'ok': True, 'sleep': value})

    async def brightness(request):
        body = await request.json()
        try:
            value = await client.set_brightness(body.get('level'))
        except (TypeError, ValueError) as e:
            return web.json_response({'ok': False, 'error': str(e)}, status=400)
        return web.json_response({'ok': True, 'brightness': value})

    async def screen_off(request):
        body = await request.json()
        try:
            value = await client.set_screen_off(**{k: body.get(k) for k in ('enabled', 'minutes')})
        except ValueError as e:
            return web.json_response({'ok': False, 'error': str(e)}, status=400)
        return web.json_response({'ok': True, 'screen_off': value})

    async def volume(request):
        body = await request.json()
        try:
            value = await client.set_volume(body.get('volume'))
        except (TypeError, ValueError) as e:
            return web.json_response({'ok': False, 'error': str(e)}, status=400)
        return web.json_response({'ok': True, 'volume': value})

    async def alarm_volume(request):
        body = await request.json()
        try:
            value = await client.set_alarm_volume(body.get('volume'))
        except (TypeError, ValueError) as e:
            return web.json_response({'ok': False, 'error': str(e)}, status=400)
        return web.json_response({'ok': True, 'volume': value})

    async def alarm_tone(request):
        body = await request.json()
        try:
            if body.get('stop'):
                await client._stop_preview()      # the settings closed while a tone was being tried
            elif body.get('preview'):
                await client.preview_tone(body.get('tone'))
            else:
                client.set_alarm_tone(body.get('tone'))
        except ValueError as e:
            return web.json_response({'ok': False, 'error': str(e)}, status=400)
        return web.json_response({'ok': True})

    async def alarm_delete(request):
        body = await request.json()
        try:
            item = await client.delete_alarm(int(body.get('id')))
        except (TypeError, ValueError):
            return web.json_response({'ok': False, 'error': 'id must be a number'}, status=400)
        return web.json_response({'ok': bool(item), **({} if item else {'error': '这一条已经没有了'})})

    async def alarm_snooze(_request):
        found = await client.snooze_alarm()
        return web.json_response({'ok': bool(found), **({} if found else {'error': '没有刚响过的闹钟'})})

    async def alarm_stop(_request):
        return web.json_response({'ok': await client.stop_alarm()})

    async def alarm_missed_clear(_request):
        client.clear_missed()
        return web.json_response({'ok': True})

    async def clear_history(request):
        body = await request.json()
        return web.json_response(await client.clear_history(bool(body.get('memory_only'))))

    # ---- music (the top-bar pill and the player sheet) ----
    #
    # Idempotence, which the page relies on (it retries after a reload and a double tap must not
    # double anything): stop on a target that isn't playing is ok; playing the same track again
    # replaces the old one rather than starting a second player; a volume that is already there
    # sends no HA command; reading status never changes anything.

    async def music_tracks(request):
        q = request.query.get('q', '')
        limit = int(request.query.get('limit', 50))
        return web.json_response({'tracks': music_api.list_tracks(limit, q)})

    async def music_random(request):
        q = request.query.get('q', '')
        count = int(request.query.get('count', 20))
        genre = request.query.get('genre', '')
        return web.json_response({'tracks': music_api.random_tracks(count, q, genre)})

    async def music_ytm(request):
        """曲库之外的结果：网关 YouTube Music 搜索（面板搜索框下面那一栏）。"""
        q = (request.query.get('q') or '').strip()
        if not q:
            return web.json_response({'tracks': []})
        try:
            r = await client._hub_http('/kiosk/music/ytm/search?q=' + urllib.parse.quote(q))
        except Exception as e:
            return web.json_response({'tracks': [], 'error': str(e)}, status=502)
        return web.json_response({'tracks': (r or {}).get('tracks') or [], 'error': (r or {}).get('message')})

    async def music_kids(request):
        """「少儿」卡片：电视上放 Alphablocks / Numberblocks（网关挑没放过的一集，开电视、投屏要 10 来秒）。"""
        body = await request.json()
        import aiohttp
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as s:
                async with s.post(client.cfg['hub_http'] + '/kiosk/tv/kids',
                                  json={'channel': body.get('channel') or ''}) as r:
                    data = await r.json(content_type=None)
        except Exception as e:
            return web.json_response({'ok': False, 'error': '连不上网关: %s' % e}, status=502)
        return web.json_response({'ok': bool(data.get('ok')), 'message': data.get('message') or data.get('error')},
                                 status=200 if data.get('ok') else 409)

    async def music_play(request):
        body = await request.json()
        target = (body.get('target') or 'local').strip().lower()
        title = body.get('title') or ''
        if target not in ('local', 'tv'):
            return web.json_response({'ok': False, 'error': '未知的 target'}, status=400)
        queue = body.get('queue')
        if target == 'local' and isinstance(queue, list) and queue:
            # 面板的整张列表：放完一首自动接下一首（原来只放点的那一首）。路径必须在 NAS 曲库里。
            tracks = [t for t in queue if isinstance(t, dict)
                      and (str(t.get('path') or '').startswith(music_api.NAS_ROOTS)
                           or re.fullmatch(r'ytm:[A-Za-z0-9_-]{11}', str(t.get('path') or '')))]
            if tracks:
                if (client.music_status() or {}).get('source') == 'voice':
                    await client.music_control('stop')     # 喇叭同一时刻只放一样
                music_api.set_queue(tracks, body.get('index') or 0)
                vol = body.get('volume')
                if vol is None:
                    vol = (music_api.local_status().get('volume') or 55)
                r = await asyncio.to_thread(music_api.play_index, int(body.get('index') or 0), vol)
                client.events.publish('music', client.music_status())
                return web.json_response(r, status=200 if r.get('ok') else 404)
        track = music_api.find_track(title)
        if track is None:
            return web.json_response({'ok': False, 'error': '没找到这首'}, status=404)
        if target == 'local':
            if (client.music_status() or {}).get('source') == 'voice':
                await client.music_control('stop')
            # 面板的滑杆值就是本机音量；没传时沿用上一次的（重复点同一首不会突然变成默认 70）
            vol = body.get('volume')
            if vol is None:
                vol = (music_api.local_status().get('volume') or 70)
            music_api.set_queue([track], 0)
            r = music_api.local_play(track['path'], vol)
            client.events.publish('music', client.music_status())
            return web.json_response(r)
        # tv 交给 hub 的 cast_youtube 插件真正播放（不是只回个 echo）
        query = track.get('title') or title
        try:
            result = await client._hub_http('/kiosk/music/play',
                                            {'target': target, 'query': query})
        except Exception as e:
            return web.json_response({'ok': False, 'target': target, 'error': str(e)},
                                     status=502)
        ok = bool(result.get('ok'))
        return web.json_response({'ok': ok, 'target': target, 'track': track,
                                  'message': result.get('message'),
                                  'error': result.get('error')},
                                 status=200 if ok else 409)

    async def music_stop(request):
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass
        target = (body.get('target') or 'local').strip().lower()
        if target not in ('local', 'tv'):
            return web.json_response({'ok': False, 'error': '未知的 target'}, status=400)
        if target == 'local':
            if (client.music_status() or {}).get('source') == 'voice':
                await client.music_control('stop')                # 语音点的歌也从这里停
            r = music_api.local_stop()                            # nothing playing is still ok
            client.events.publish('music', client.music_status())
            return web.json_response(r)
        try:
            result = await client._hub_http('/kiosk/music/stop', {'target': target})
        except Exception as e:
            return web.json_response({'ok': False, 'target': target, 'error': str(e)},
                                     status=502)
        return web.json_response({'ok': bool(result.get('ok')), 'target': target,
                                  'message': result.get('message')})

    async def music_control(request):
        """本机喇叭上的 下一首/上一首/暂停/继续/停：语音点的歌交给 hub，面板自己的歌在这里处理。"""
        body = await request.json()
        action = str(body.get('action') or '').strip().lower()
        if action not in ('next', 'prev', 'pause', 'resume', 'stop'):
            return web.json_response({'ok': False, 'error': '未知的 action'}, status=400)
        st = client.music_status() or {}
        if st.get('source') == 'voice' or (action == 'resume' and not st.get('paused') and not st.get('playing')
                                           and not music_api.local_status().get('path')):
            ok = await client.music_control(action)
            return web.json_response({'ok': bool(ok), 'source': 'voice',
                                      **({} if ok else {'error': '现在没有在放语音点的歌'})},
                                     status=200 if ok else 409)
        r = await asyncio.to_thread({'next': lambda: music_api.local_next(1), 'prev': lambda: music_api.local_next(-1),
                                     'pause': music_api.local_pause, 'resume': music_api.local_resume,
                                     'stop': music_api.local_stop}[action])
        client.events.publish('music', client.music_status())
        return web.json_response(dict(r, source='local'), status=200 if r.get('ok') else 409)

    def _device_volume(entity_id):
        """That entity's volume as 0-100, or None when the hub hasn't reported one."""
        devs = client.devices
        if isinstance(devs, dict):
            devs = devs.get('devices') or []
        found = next((d for d in (devs or []) if d.get('entity_id') == entity_id), None)
        level = (found or {}).get('value')
        if level is None:
            level = (found or {}).get('volume')
        if isinstance(level, (int, float)):
            return int(round(level * 100))
        return None

    async def music_volume(request):
        body = await request.json()
        target = (body.get('target') or 'local').strip().lower()
        try:
            vol = max(0, min(100, int(body.get('volume', 70))))
        except (TypeError, ValueError):
            return web.json_response({'ok': False, 'error': 'volume must be 0-100'}, status=400)
        if target == 'local':
            if (client.music_status() or {}).get('source') == 'voice':
                # 语音点的歌从 hub 推流到本机喇叭：滑杆就是喇叭音量
                await client.set_volume(vol, 'page')
                return web.json_response({'ok': True, 'target': 'local', 'volume': vol, 'source': 'voice'})
            return web.json_response(await asyncio.to_thread(music_api.local_set_volume, vol))
        # 电视走 ARC 到 HT-Z9F soundbar，HA 的 volume_level 就是实际出声音量
        # [2026-11-10] HomePod 通路下线，面板只留本机与电视
        entity = {'tv': 'media_player.bravia_xr_55x90j'}.get(target)
        if not entity:
            return web.json_response({'ok': False, 'error': '未知的 target'}, status=400)

        # 电视（BRAVIA 集成）：volume_set 实测几乎不生效，只有 volume_up/volume_down 真改硬件。
        # 所以按当前音量算差值，用步进逼近目标。
        if target == 'tv':
            try:
                cur = _device_volume(entity)
                steps = 0
                if cur == vol:
                    return web.json_response({'ok': True, 'target': target, 'volume': vol,
                                              'from': cur, 'steps': 0})
                if cur is None:
                    await client.set_device(entity, 'volume_set', vol / 100.0)
                    steps = 1
                else:
                    # BRAVIA 集成一次 volume_up/down 实测改 2 格硬件音量，所以步数按 delta/2 算
                    delta = vol - cur
                    action = 'volume_up' if delta > 0 else 'volume_down'
                    presses = min((abs(delta) + 1) // 2, 50)
                    for _ in range(presses):
                        await client.set_device(entity, action)
                        steps += 1
                return web.json_response({'ok': True, 'target': target, 'volume': vol,
                                          'from': cur, 'steps': steps})
            except Exception as e:
                return web.json_response({'ok': False, 'target': target, 'error': str(e)},
                                         status=502)

        try:
            cur = _device_volume(entity)
            if cur == vol:
                return web.json_response({'ok': True, 'target': target, 'volume': vol,
                                          'from': cur, 'steps': 0})
            result = await client.set_device(entity, 'volume', vol / 100.0)
            return web.json_response({'ok': True, 'target': target, 'volume': vol, 'ha': result})
        except Exception as e:
            return web.json_response({'ok': False, 'target': target, 'error': str(e)}, status=502)

    async def music_target_volume(request):
        """切到某个目标时，拉它的当前音量做滑杆初值（只读）。"""
        target = (request.query.get('target') or 'local').strip().lower()
        if target == 'local':
            return web.json_response({'target': 'local', 'volume': 55})
        entity = {'tv': 'media_player.bravia_xr_55x90j'}.get(target)
        if not entity:
            return web.json_response({'ok': False, 'error': '未知的 target'}, status=400)
        return web.json_response({'target': target, 'volume': _device_volume(entity)})

    async def music_status(request):
        """按 target 报状态。

        原来只有 local_status()：投到电视/HomePod 后前端永远显示「没在放」，
        用户以为没投上。非本机走 hub 的 /kiosk/music/status 查 HA 实体。
        """
        target = (request.query.get('target') or 'local').strip().lower()
        if target == 'local':
            # 本机喇叭：语音点的歌（hub 推流）优先，没有才是面板自己的播放器
            return web.json_response(client.music_status())
        if target not in ('tv',):
            return web.json_response({'ok': False, 'error': '未知的 target'}, status=400)
        try:
            r = await client._hub_http('/kiosk/music/status?target=' + target)
        except Exception as e:
            # 后台不通时不要 500：前端只要知道「现在不知道」就够了
            return web.json_response({'ok': False, 'target': target,
                                      'playing': False, 'state': 'unknown',
                                      'error': str(e)})
        if isinstance(r, dict):
            return web.json_response(r)
        return web.json_response({'ok': False, 'target': target,
                                  'playing': False, 'state': 'unknown',
                                  'error': 'hub 返回格式异常'})

    async def health(_request):
        return web.json_response({'version': __version__, **client.health()})

    async def power_off(_request):
        return web.json_response(await client.power_off())

    async def network(_request):
        return web.json_response({'ip': local_ip()})

    async def update_check(_request):
        return web.json_response({'ok': update.request('check')})

    async def update_install(request):
        if client.state != 'idle':
            return web.json_response({'ok': False, 'error': '对话结束后再更新'}, status=409)
        body = await request.json()
        return web.json_response({'ok': update.request('install', str(body.get('version', '')))})

    watchers = []   # keeps the task referenced

    async def watch_updates(_app):
        watchers.append(asyncio.create_task(update.watch(client.events.publish)))

    async def watch_local_music(_app):
        # 曲库索引（几 MB JSON + 每首算搜索键）启动时就在后台读好：第一次搜歌原来要多等 8 s
        if hasattr(music_api, '_load_index'):
            watchers.append(asyncio.create_task(asyncio.to_thread(music_api._load_index)))

        async def loop():
            while True:
                await asyncio.sleep(1)
                try:
                    if await asyncio.to_thread(music_api.tick):   # a track ended: the next one is on
                        client.events.publish('music', client.music_status())
                except Exception:
                    pass
        watchers.append(asyncio.create_task(loop()))

    app.on_startup.append(watch_updates)
    app.on_startup.append(watch_local_music)
    app.router.add_get('/', index)
    app.router.add_get('/v2', index)
    app.router.add_get('/v1', index_v1)
    app.router.add_get('/events', events)
    app.router.add_post('/api/wake', action(lambda: client.wake('button')))
    app.router.add_post('/api/end', action(client.end))
    app.router.add_post('/api/abort', action(client.abort))
    app.router.add_post('/api/ptt/start', action(client.ptt_start))
    app.router.add_post('/api/ptt/stop', action(client.ptt_stop))
    app.router.add_post('/api/model', model)
    app.router.add_get('/api/devices', devices)
    app.router.add_post('/api/device/set', device_set)
    app.router.add_post('/api/text', text)
    app.router.add_post('/api/sleep', sleep_setting)
    app.router.add_post('/api/brightness', brightness)
    app.router.add_post('/api/screen-off', screen_off)
    app.router.add_post('/api/volume', volume)
    app.router.add_post('/api/alarm-volume', alarm_volume)
    app.router.add_post('/api/alarm-tone', alarm_tone)
    app.router.add_post('/api/alarms/delete', alarm_delete)
    app.router.add_post('/api/alarms/snooze', alarm_snooze)
    app.router.add_post('/api/alarms/stop', alarm_stop)
    app.router.add_post('/api/alarms/missed/clear', alarm_missed_clear)
    app.router.add_post('/api/reports/play', action(client.play_reports))
    app.router.add_post('/api/history/clear', clear_history)
    app.router.add_get('/api/music/tracks', music_tracks)
    app.router.add_get('/api/music/random', music_random)
    app.router.add_get('/api/music/status', music_status)
    app.router.add_get('/api/music/target_volume', music_target_volume)
    app.router.add_post('/api/music/play', music_play)
    app.router.add_post('/api/music/stop', music_stop)
    app.router.add_post('/api/music/volume', music_volume)
    app.router.add_post('/api/music/control', music_control)
    app.router.add_get('/api/music/ytm', music_ytm)
    app.router.add_post('/api/music/kids', music_kids)
    app.router.add_get('/api/health', health)
    app.router.add_get('/api/weather', weather_now)
    app.router.add_get('/api/network', network)
    app.router.add_post('/api/power-off', power_off)
    app.router.add_post('/api/update/check', update_check)
    app.router.add_post('/api/update/install', update_install)
    # [2026-11-15] 看作业：内置摄像头拍照 → 网关看图 → 屏幕卡片 + 语音
    from . import homework
    for path, handler in homework.install(client):
        app.router.add_route('*', path, handler)
    app.router.add_static('/static/', WEB)

    async def revalidate(request, response):
        # the kiosk keeps a disk cache; without this it goes on running the old app.js/css after
        # an update (heuristic freshness from Last-Modified). no-cache = check the ETag every load.
        if request.path.startswith('/static/'):
            response.headers['Cache-Control'] = 'no-cache'
    app.on_response_prepare.append(revalidate)
    return app
