"""看作业：设备内置摄像头拍照 → 网关看图 → 屏幕卡片 + 粤语/英文语音。

拍照用 libcamera（gst libcamerasrc，1280x960，JPEG）。上游 PR #6 的摄像头支持已经在
thinksmart-camera 包里（2026-11-15 装上并验证：S5KC505A 3-0037 识别、30fps 出图）。

接口（只在本机 127.0.0.1 的 kiosk 页面上用）：
  POST /api/hw/capture           {language, countdown?, source?} 倒数→拍照→交给网关分析，返回网关的 JSON
                                 同一时间只拍一张（第二个请求回 409 busy）；镜头盖关着回 409 lens_closed
  GET  /api/hw/latest            网关最近一次的结果（页面重连/切场景时恢复）
  POST /api/hw/clear             清掉网关的最近一次
  GET  /api/hw/photo             拿最近一次的缩略图
  GET  /api/hw/diag              服务进程自己的设备权限 + 镜头盖状态
  GET  /api/hw/live              实时画面（multipart MJPEG，640x480 约 10 帧/秒，最长 LIVE_MAX 秒）；
                                 摄像头独占：拍照前自动停掉，拍的那一下回 409
  GET  /api/hw/book              错题本 + 本周小结（转网关 /kiosk/hw/book）
分析本身在网关（/kiosk/hw/analyze），这里只负责拍和转。
拍照各阶段经 /events 推 'homework' 事件给页面（countdown → shooting → analyzing → done/error），
语音触发（hub 的 homework_check）时屏幕也会自动打开面板、显示倒数和结果。
"""
import array
import asyncio
import base64
import fcntl
import glob
import logging
import os
import shutil
import subprocess
import time
import urllib.parse

import aiohttp
from aiohttp import web

log = logging.getLogger(__name__)

CAPTURE_WIDTH = 1280
CAPTURE_HEIGHT = 960
CAPTURE_TIMEOUT = 60
PHOTO_DIR = os.path.expanduser('~/.local/share/thinksmart/photo')
MAX_COUNTDOWN = 5
# 网关 aiohttp 收包上限 1 MB，照片按 base64 发（×1.34），原图超过这个就先压一遍。
# 2026-11-15 晚亮处拍出 894–933 KB → 413 → 页面一直转（实测 524 KB 时正常）。
MAX_SEND_BYTES = 600 * 1024
# 实时画面：实测 640x480@10fps 占一个核约 60%（8 核），SIGTERM 能干净退出
LIVE_CMD = ['gst-launch-1.0', '-q', 'libcamerasrc',
            '!', 'video/x-raw,width=640,height=480',
            '!', 'videorate', 'drop-only=true', '!', 'video/x-raw,framerate=10/1',
            '!', 'videoconvert', '!', 'jpegenc', 'quality=60',
            '!', 'multipartmux', 'boundary=frame', '!', 'fdsink', 'fd=1']
LIVE_MAX = 120             # 面板开着没人动也别一直占摄像头、发热

# 镜头盖：内核把侧面拨片报成 EV_SW / SW_CAMERA_LENS_COVER（1 = 盖着）
EV_SW = 0x05
SW_CAMERA_LENS_COVER = 0x09
SW_MAX = 0x10

def _ioc_read(nr, size):
    return (2 << 30) | (size << 16) | (ord('E') << 8) | nr

def _lens_state():
    """读镜头盖：True=盖着，False=开着，None=找不到这个开关（不拦拍照）。"""
    nbytes = SW_MAX // 8 + 1
    for path in sorted(glob.glob('/dev/input/event*')):
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        except OSError:
            continue
        try:
            bits = array.array('B', [0] * nbytes)
            fcntl.ioctl(fd, _ioc_read(0x20 + EV_SW, nbytes), bits, True)       # EVIOCGBIT(EV_SW)
            if not bits[SW_CAMERA_LENS_COVER // 8] & (1 << (SW_CAMERA_LENS_COVER % 8)):
                continue
            state = array.array('B', [0] * nbytes)
            fcntl.ioctl(fd, _ioc_read(0x1b, nbytes), state, True)              # EVIOCGSW
            return bool(state[SW_CAMERA_LENS_COVER // 8] & (1 << (SW_CAMERA_LENS_COVER % 8)))
        except OSError:
            continue
        finally:
            os.close(fd)
    return None

def _gst_available():
    return shutil.which('gst-launch-1.0') is not None

def _shrink(jpeg, limit=MAX_SEND_BYTES):
    """太大的照片用 ffmpeg 降 JPEG 质量重压（尺寸不变，判题实测与分辨率/质量无关）。压不下来就缩到 960 宽。"""
    if len(jpeg) <= limit:
        return jpeg
    for q, vf in ((6, None), (9, None), (9, 'scale=960:-2')):
        cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0']
        if vf:
            cmd += ['-vf', vf]
        cmd += ['-q:v', str(q), '-f', 'mjpeg', 'pipe:1']
        try:
            p = subprocess.run(cmd, input=jpeg, capture_output=True, timeout=20)
        except (OSError, subprocess.SubprocessError) as e:
            log.warning('压照片失败: %s', e)
            return jpeg
        out = p.stdout
        if p.returncode == 0 and out.startswith(b'\xff\xd8\xff') and len(out) <= limit:
            log.info('照片 %dKB 压到 %dKB（q=%d%s）', len(jpeg) // 1024, len(out) // 1024, q, ' 960宽' if vf else '')
            return out
    log.warning('照片 %dKB 压不到 %dKB 以下', len(jpeg) // 1024, limit // 1024)
    return out if out and len(out) < len(jpeg) else jpeg


def _capture_sync(width=CAPTURE_WIDTH, height=CAPTURE_HEIGHT, timeout=CAPTURE_TIMEOUT):
    """拍一张 JPEG。libcamerasrc 不支持 num-buffers，所以用 multifilesink 收两帧后杀掉进程：
    第一帧常常还在等 AE/AWB 收敛，第二帧才正常。返回 bytes，失败抛 RuntimeError。"""
    # 固定工作目录：服务进程里 mkdtemp 出来的目录会立刻 isdir()=False（挂载命名空间里 /home 的
    # dentry 没刷新），gst 一帧都写不出来。用早就存在的目录就不踩这个坑。
    tmp = os.path.join(PHOTO_DIR, 'hw-current')
    os.makedirs(tmp, exist_ok=True)
    for f in os.listdir(tmp):
        try:
            os.unlink(os.path.join(tmp, f))
        except OSError:
            pass
    pattern = os.path.join(tmp, 'f-%03d.jpg')
    cmd = ['gst-launch-1.0', '-q',
           'libcamerasrc',
           '!', 'video/x-raw,width=%d,height=%d' % (width, height),
           '!', 'videoconvert',
           '!', 'jpegenc', 'quality=85',
           '!', 'multifilesink', 'location=' + pattern]
    started = time.monotonic()
    logpath = '/tmp/thinksmart-hw-gst.log'
    try:
        # stderr 别用 PIPE：libcamera 打很多 INFO，管道写满会把进程卡住（实测 40s 一张都不出）
        with open(logpath, 'wb') as logf:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=logf)
    except OSError as e:
        raise RuntimeError('起不了 gst-launch: %s' % e)
    best = None
    files = []
    try:
        # 等第二张：第一张常常还在等 AE/AWB 收敛。单张出图实测约 1-2 秒（2026-11-15 回执）。
        while time.monotonic() - started < timeout:
            files = sorted(f for f in os.listdir(tmp) if f.endswith('.jpg'))
            if len(files) >= 2:
                break
            if proc.poll() is not None and not files:
                break
            time.sleep(0.2)
        files = sorted(f for f in os.listdir(tmp) if f.endswith('.jpg'))
        if files:
            with open(os.path.join(tmp, files[-1]), 'rb') as f:
                best = f.read()
    finally:
        # gst-launch 收到 SIGTERM 有时不退出（实测留下一个 100% CPU 的僵尸，还占着 /dev/media0，
        # 下一张就报 "Device or resource busy"），所以 SIGTERM 后再确认，没走就 SIGKILL
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=6)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    log.warning('gst-launch 没能退出（pid %s），摄像头可能被占住', proc.pid)
    if not best:
        log.warning('拍照空: dir=%s rc=%s elapsed=%.1fs',
                    tmp, proc.poll(), time.monotonic() - started)
        # 把 gst 的原话带出来：摄像头忙 / 没有摄像头 / 驱动没起来，原因都在这里面
        tail = ''
        try:
            with open(logpath, 'rb') as f:
                raw = f.read().decode('utf-8', 'replace').splitlines()
            lines = []
            for l in raw:
                if l.startswith('['):          # 去掉 libcamera 的 [时间] [pid] 前缀
                    parts = l.split('] ', 2)
                    l = parts[-1] if len(parts) > 2 else l
                if 'ERROR' in l or 'busy' in l or 'Could not' in l or 'permitted' in l:
                    lines.append(l.strip())
            tail = '；'.join(dict.fromkeys(lines))[:400]
        except OSError:
            pass
        raise RuntimeError('没拍到画面（%s）' % (tail or '摄像头可能被别的程序占着'))
    if not best.startswith(b'\xff\xd8\xff'):
        raise RuntimeError('拍到的不是 JPEG')
    log.info('拍照 %dx%d %dKB %.1fs', width, height, len(best) // 1024, time.monotonic() - started)
    return best

def install(client):
    """把这些接口挂到客户端（和 web.py 里的路由同一份 app）。"""

    lock = asyncio.Lock()
    live = {'proc': None, 'shooting': False}

    async def stop_live():
        """停掉实时画面，等 gst 真退出（不然 /dev/media0 还被占着，拍照报 busy）。"""
        p, live['proc'] = live['proc'], None
        if not p or p.returncode is not None:
            return
        p.terminate()
        try:
            await asyncio.wait_for(p.wait(), 4)
        except asyncio.TimeoutError:
            p.kill()
            try:
                await asyncio.wait_for(p.wait(), 3)
            except asyncio.TimeoutError:
                log.warning('实时画面 gst 没退出（pid %s）', p.pid)
        await asyncio.sleep(0.3)

    async def live_stream(request):
        if live['shooting']:
            return web.json_response({'ok': False, 'code': 'busy', 'error': '正在拍'}, status=409)
        if client.cfg.get('homework_lens_check', True) and await asyncio_to_thread(_lens_state) is True:
            return web.json_response({'ok': False, 'code': 'lens_closed', 'error': '镜头盖没打开'}, status=409)
        await stop_live()                     # 只留一路：新开的页面/重连顶掉旧的
        try:
            proc = await asyncio.create_subprocess_exec(
                *LIVE_CMD, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        except OSError as e:
            return web.json_response({'ok': False, 'error': '起不了实时画面: %s' % e}, status=503)
        live['proc'] = proc
        resp = web.StreamResponse(headers={'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
                                           'Cache-Control': 'no-store'})
        await resp.prepare(request)
        until = time.monotonic() + LIVE_MAX
        try:
            while time.monotonic() < until:
                chunk = await proc.stdout.read(65536)
                if not chunk:
                    break
                await resp.write(chunk)
        except (ConnectionResetError, ConnectionError):
            pass
        finally:
            if live['proc'] is proc:
                await stop_live()
            elif proc.returncode is None:
                proc.kill()
        return resp

    def push(phase, **data):
        client.events.publish('homework', {'phase': phase, **data})

    async def diag(request):
        """诊断：在服务进程自己身上报告设备权限，排查「同 ns 能开、服务里打不开」。"""
        info = {'pid': os.getpid(), 'groups': os.getgroups(), 'devs': {}}
        for p in ('/dev/media0', '/dev/video0', '/dev/dma_heap/default_cma_region'):
            try:
                st = os.stat(p)
                fd = os.open(p, os.O_RDWR | os.O_NONBLOCK)
                os.close(fd)
                info['devs'][p] = 'OK major=%d' % os.major(st.st_rdev)
            except OSError as e:
                info['devs'][p] = 'FAIL %s' % e
        info['lens_covered'] = await asyncio_to_thread(_lens_state)
        info['lens_check'] = bool(client.cfg.get('homework_lens_check', True))
        info['busy'] = lock.locked()
        return web.json_response(info)

    async def capture(request):
        body = {}
        if request.can_read_body:
            try:
                body = await request.json()
            except ValueError:
                body = {}
        if not isinstance(body, dict):
            body = {}
        language = (body.get('language') or 'yue').strip()
        source = (body.get('source') or 'page').strip()
        try:
            countdown = max(0, min(MAX_COUNTDOWN, int(body.get('countdown') or 0)))
        except (TypeError, ValueError):
            countdown = 0
        if lock.locked():
            # 语音和点按同时来：两次拍照会互删 hw-current 里的帧、抢 /dev/media0
            return web.json_response({'ok': False, 'code': 'busy', 'error': '正在拍，等一下'}, status=409)
        async with lock:
            def fail(code, msg, status):
                push('error', error=msg, code=code, source=source)
                return web.json_response({'ok': False, 'code': code, 'error': msg}, status=status)

            if not _gst_available():
                return fail('no_gst', '这台设备没有 gst-launch', 501)
            if client.cfg.get('homework_lens_check', True):
                if await asyncio_to_thread(_lens_state) is True:
                    return fail('lens_closed', '镜头盖没打开', 409)
            if countdown:
                push('countdown', seconds=countdown, language=language, source=source)
                await asyncio.sleep(countdown)
            push('shooting', source=source)
            live['shooting'] = True
            try:
                await stop_live()             # 实时画面在倒数时开着，拍之前让出摄像头
                jpeg = await asyncio_to_thread(_capture_sync)
            except RuntimeError as e:
                log.warning('拍照失败: %s', e)
                return fail('capture', str(e), 503)
            except Exception as e:
                log.exception('拍照失败')
                return fail('capture', '拍照失败: %s' % e, 500)
            finally:
                live['shooting'] = False
            push('analyzing', source=source)
            jpeg = await asyncio_to_thread(_shrink, jpeg)
            payload = {'image': base64.b64encode(jpeg).decode(), 'language': language,
                       'source': 'camera'}
            try:
                data = await client._hub_http('/kiosk/hw/analyze', payload, total=150)
            except Exception as e:
                return fail('hub', '网关没答: %s' % e, 502)
            if not data.get('ok'):
                return fail('analyze', data.get('error') or '没看成', 502)
            push('done', data=data, source=source)
            return web.json_response(data)

    async def latest(_request):
        try:
            data = await client._hub_http('/kiosk/hw/latest')
        except Exception as e:
            return web.json_response({'ok': False, 'error': '网关没答: %s' % e}, status=502)
        return web.json_response(data)

    async def book(request):
        """错题本 + 本周小结：原样转网关 /kiosk/hw/book。"""
        days = request.query.get('days') or '30'
        try:
            data = await client._hub_http('/kiosk/hw/book?days=' + urllib.parse.quote(days))
        except Exception as e:
            return web.json_response({'ok': False, 'error': '网关没答: %s' % e}, status=502)
        return web.json_response(data)

    async def clear(_request):
        try:
            data = await client._hub_http('/kiosk/hw/clear', {})
        except Exception as e:
            return web.json_response({'ok': False, 'error': '网关没答: %s' % e}, status=502)
        return web.json_response(data)

    async def photo(_request):
        """最近一次的缩略图：网关 /kiosk/hw/latest 带 thumb（data URI），这里解出来当图片回。
        （以前的 which=full 实际也回缩略图，已去掉；原图只在网关盘上，按需再开接口。）"""
        try:
            data = await client._hub_http('/kiosk/hw/latest')
        except Exception:
            return web.Response(status=502)
        hw = (data or {}).get('homework') or {}
        uri = hw.get('thumb') or ''
        if ',' not in uri:
            return web.Response(status=404)
        try:
            raw = base64.b64decode(uri.split(',', 1)[1])
        except ValueError:
            return web.Response(status=500)
        return web.Response(body=raw, content_type='image/jpeg',
                            headers={'Cache-Control': 'no-store'})

    async def tts(request):
        """念作业：转给网关的 /kiosk/hw/tts（edge-tts），把 mp3 原样回给页面。"""
        text = (request.query.get('text') or '').strip()
        lang = (request.query.get('lang') or 'yue').strip()
        if not text:
            return web.json_response({'ok': False, 'error': '缺少 text'}, status=400)
        url = (client.cfg.get('hub_http') or '') + '/kiosk/hw/tts?' + urllib.parse.urlencode(
            {'text': text[:600], 'lang': lang})
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as s:
                async with s.get(url) as r:
                    if r.status != 200:
                        return web.json_response({'ok': False, 'error': '网关没合成'}, status=502)
                    body = await r.read()
        except Exception as e:
            return web.json_response({'ok': False, 'error': '连不上网关: %s' % e}, status=502)
        return web.Response(body=body, content_type='audio/mpeg', headers={'Cache-Control': 'no-store'})

    client.hw_photo = photo
    return [('/api/hw/capture', capture), ('/api/hw/latest', latest),
            ('/api/hw/clear', clear), ('/api/hw/photo', photo), ('/api/hw/tts', tts),
            ('/api/hw/diag', diag), ('/api/hw/book', book), ('/api/hw/live', live_stream)]

async def asyncio_to_thread(func, *args, **kwargs):
    import functools
    return await asyncio.get_running_loop().run_in_executor(None, functools.partial(func, *args, **kwargs))
