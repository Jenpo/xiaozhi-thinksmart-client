"""The page's own API and the kiosk's static files: the same call twice must land the same state.

Two things this pins down (state review, 2026-11-09):

- Idempotence of the write endpoints: a page that retries (the kiosk reloads itself after an
  update, a double tap, a reconnecting event stream) must not double anything. Settings are
  absolute values, so a repeat sets the same value; the alarm actions are idempotent on the
  device side (deleting an id twice answers "already gone", snooze without a ringing alarm is a
  no-op); device actions carry the hub's answer and are asked for exactly once per call.
- The kiosk's assets: /v2 is the page it runs, every /static/ path the HTML references exists,
  and every element the script writes to is in the HTML (a renamed id would silently stop
  updating a control).

The fake client below answers like the real one without touching audio, files or the network.

Run like test_barge_in.py (it stubs the audio stack; importing it first does that here too).
"""
import asyncio
import json
import re
import types
from pathlib import Path

import pytest
import pytest_asyncio
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

import test_barge_in  # noqa: F401  (stubs the audio stack)

from thinksmart_client import web as web_mod


class FakeMusic:
    """Stands in for music_api (which reads the NAS index and spawns ffplay)."""

    def __init__(self):
        self.tracks = [{'title': '勇气', 'artist': '梁静茹', 'album': '勇气', 'ext': 'flac',
                        'path': '/mnt/thinksmart-music/main/PoP/勇气.flac'},
                       {'title': 'Aria in F Major', 'artist': '', 'album': 'Bach', 'ext': 'flac',
                        'path': '/mnt/thinksmart-music/main/Classical/Aria.flac'}]
        self.playing = None
        self.volume = 55
        self.starts = 0

    def list_tracks(self, limit=50, query=''):
        q = query.strip().lower()
        return [t for t in self.tracks
                if not q or q in t['title'].lower() or q in t['artist'].lower()][:limit]

    def random_tracks(self, count=20, query=''):
        return self.list_tracks(count, query)

    def find_track(self, title=''):
        q = title.strip().lower()
        if not q:
            return self.tracks[0]
        return next((t for t in self.tracks
                     if q in t['title'].lower() or q in t['artist'].lower()), None)

    NAS_ROOTS = ('/mnt/thinksmart-music/main', '/mnt/thinksmart-music/datavol2')

    def set_queue(self, tracks, index=0):
        self.queue = list(tracks)
        return self.queue[index] if self.queue else None

    def tick(self):
        return False

    def local_play(self, path, volume=70):
        self.starts += 1
        self.playing = path
        self.volume = int(volume)
        return {'ok': True, 'target': 'local', 'path': path, 'volume': self.volume}

    def local_stop(self):
        self.playing = None
        return {'ok': True, 'target': 'local', 'state': 'stopped'}

    def local_set_volume(self, volume):
        if self.playing is None:
            return {'ok': False, 'error': '本机没有在播'}
        self.volume = int(volume)
        return {'ok': True, 'target': 'local', 'volume': self.volume}

    def local_status(self):
        return {'playing': self.playing is not None, 'path': self.playing,
                'elapsed': 12.0 if self.playing else 0}

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web'


class FakeClient:
    """Just enough of app.Client for the routes: settings are values, so repeats are visible."""

    def __init__(self):
        self.events = types.SimpleNamespace(publish=lambda *_a: None, queues=set())
        self.state = 'idle'
        self.cfg = {'device_id': 'dev-1'}
        self.devices = {'homes': [], 'devices': [], 'error': None}
        self.models = {'current': None, 'options': []}
        self.volume = 60
        self.brightness = 100
        self.screen_off = {'enabled': True, 'minutes': 5}
        self.alarm_volume = 70
        self.tone = 'coffee'
        self.sleep = {'enabled': False, 'start': '22:00', 'end': '07:00'}
        self.alarms = [{'id': 1, 'kind': 'countdown', 'at': 0, 'text': '煮蛋'}]
        self.calls = []            # (path, body) of everything that reached the "hub"
        self.actions = []          # (name, args) of the coroutine actions
        self.missed_cleared = 0
        self.preview = []

    # ---- what the routes use ----
    def snapshot(self):
        return {'state': self.state, 'volume': self.volume}

    def health(self):
        return {'state': self.state, 'audio': 'ok'}

    def music_status(self):
        from thinksmart_client import web
        return web.music_api.local_status()     # nothing streams from the hub in these tests

    async def music_control(self, action):
        self.actions.append(('music_control', (action,)))
        return False

    async def set_volume(self, value):
        if value is None or not 0 <= float(value) <= 100:
            raise ValueError('volume must be 0-100')
        self.volume = int(value)
        return self.volume

    async def set_alarm_volume(self, value):
        if value is None or not 0 <= float(value) <= 100:
            raise ValueError('volume must be 0-100')
        self.alarm_volume = int(value)
        return self.alarm_volume

    async def set_brightness(self, level):
        if level is None or not 0 <= float(level) <= 100:
            raise ValueError('brightness must be 0-100')
        self.brightness = int(level)
        return self.brightness

    async def set_screen_off(self, enabled=None, minutes=None):
        if minutes is not None and int(minutes) not in (1, 3, 5, 10, 30):
            raise ValueError('minutes must be 1, 3, 5, 10 or 30')
        if enabled is not None:
            self.screen_off['enabled'] = bool(enabled)
        if minutes is not None:
            self.screen_off['minutes'] = int(minutes)
        return dict(self.screen_off)

    async def set_sleep(self, enabled=None, start=None, end=None):
        for k, v in (('enabled', enabled), ('start', start), ('end', end)):
            if v is not None:
                self.sleep[k] = v
        return dict(self.sleep)

    def set_alarm_tone(self, tone):
        if tone not in ('coffee', 'morning', 'bright', 'hop', 'marimba'):
            raise ValueError('unknown tone')
        self.tone = tone

    async def preview_tone(self, tone):
        self.set_alarm_tone(tone)
        self.preview.append(tone)

    async def _stop_preview(self):
        self.preview.append('stop')

    async def delete_alarm(self, ident):
        for a in list(self.alarms):
            if a['id'] == ident:
                self.alarms.remove(a)
                return a
        return None      # already gone: the page shows "这一条已经没有了", nothing breaks

    async def snooze_alarm(self):
        return False if not self.alarms else self.alarms[0]

    async def stop_alarm(self):
        return True

    def clear_missed(self):
        self.missed_cleared += 1

    async def clear_history(self, memory_only=False):
        self.calls.append(('/kiosk/chat/clear', {'memory_only': memory_only}))
        return {'ok': True}

    async def power_off(self):
        self.calls.append(('/api/power-off', None))
        return {'ok': True, 'state': 'off'}

    async def set_model(self, kind, vendor, entry=None):
        self.calls.append(('/kiosk/llm/use', {'kind': kind, 'vendor': vendor, 'entry': entry}))
        return {'ok': True}

    async def set_device(self, entity_id, action, value=None):
        body = {'device': self.cfg['device_id'], 'entity_id': entity_id, 'action': action}
        if value is not None:
            body['value'] = value
        self.calls.append(('/kiosk/devices/set', body))
        return {'ok': True, 'entity_id': entity_id, 'action': action}

    async def _hub_http(self, path, body=None):
        """The hub's /kiosk/... endpoints; a test replaces this to script the answers."""
        self.calls.append((path.split('?')[0], body))
        return {'ok': True, 'message': '已生效'}

    async def wake(self, *_a):
        self.actions.append(('wake', _a))

    async def end(self):
        self.actions.append(('end', ()))

    async def abort(self):
        self.actions.append(('abort', ()))

    async def ptt_start(self):
        self.actions.append(('ptt_start', ()))

    async def ptt_stop(self):
        self.actions.append(('ptt_stop', ()))

    async def say(self, text):
        self.actions.append(('say', (text,)))

    async def play_reports(self):
        self.actions.append(('play_reports', ()))


@pytest_asyncio.fixture
async def client(monkeypatch):
    fake = FakeClient()
    # update.watch would poll the network on startup; the routes are all that matter here
    monkeypatch.setattr(web_mod.update, 'watch', lambda publish: asyncio.sleep(0))
    monkeypatch.setattr(web_mod.update, 'read', lambda: {'state': 'idle'})
    music = FakeMusic()
    monkeypatch.setattr(web_mod, 'music_api', music)
    fake.music = music
    app = web_mod.make_app(fake)
    server = TestServer(app)
    c = TestClient(server)
    await c.start_server()
    try:
        yield c, fake
    finally:
        await c.close()


async def post(c, path, body=None):
    resp = await c.post(path, json=body if body is not None else {})
    return resp.status, await resp.json()


# ---- settings: a repeat lands the same value, and a bad one changes nothing ----


@pytest.mark.asyncio
async def test_setting_volume_twice_is_the_same_state(client):
    c, fake = client
    for _ in range(2):
        status, body = await post(c, '/api/volume', {'volume': 35})
        assert status == 200 and body == {'ok': True, 'volume': 35}
    assert fake.volume == 35


@pytest.mark.asyncio
async def test_a_rejected_value_leaves_the_old_one(client):
    c, fake = client
    await post(c, '/api/volume', {'volume': 35})
    status, body = await post(c, '/api/volume', {'volume': 140})
    assert status == 400 and body['ok'] is False
    assert fake.volume == 35
    status, body = await post(c, '/api/volume', {})
    assert status == 400 and fake.volume == 35      # missing value is refused, not set to 0


@pytest.mark.asyncio
async def test_screen_off_partial_updates_do_not_reset_the_other_field(client):
    c, fake = client
    await post(c, '/api/screen-off', {'minutes': 10})
    await post(c, '/api/screen-off', {'enabled': False})
    assert fake.screen_off == {'enabled': False, 'minutes': 10}
    await post(c, '/api/screen-off', {'enabled': False})      # the same again
    assert fake.screen_off == {'enabled': False, 'minutes': 10}


@pytest.mark.asyncio
async def test_alarm_tone_preview_then_close_leaves_the_choice(client):
    c, fake = client
    await post(c, '/api/alarm-tone', {'tone': 'marimba', 'preview': True})
    await post(c, '/api/alarm-tone', {'stop': True})
    await post(c, '/api/alarm-tone', {'tone': 'marimba'})
    assert fake.tone == 'marimba' and fake.preview == ['marimba', 'stop']


@pytest.mark.asyncio
async def test_deleting_the_same_alarm_twice(client):
    c, fake = client
    status, body = await post(c, '/api/alarms/delete', {'id': 1})
    assert status == 200 and body['ok'] is True
    status, body = await post(c, '/api/alarms/delete', {'id': 1})
    assert status == 200 and body['ok'] is False and body['error']
    assert fake.alarms == []


@pytest.mark.asyncio
async def test_alarm_id_must_be_a_number(client):
    c, fake = client
    status, body = await post(c, '/api/alarms/delete', {'id': 'x'})
    assert status == 400 and body['ok'] is False
    assert len(fake.alarms) == 1


@pytest.mark.asyncio
async def test_device_set_is_asked_for_once_per_call_and_checks_its_input(client):
    c, fake = client
    status, body = await post(c, '/api/device/set', {'entity_id': 'light.office', 'action': 'on'})
    assert status == 200 and body['ok'] is True
    assert fake.calls == [('/kiosk/devices/set',
                           {'device': 'dev-1', 'entity_id': 'light.office', 'action': 'on'})]
    status, body = await post(c, '/api/device/set', {'action': 'on'})
    assert status == 400 and body['ok'] is False
    assert len(fake.calls) == 1        # nothing reached the hub


@pytest.mark.asyncio
async def test_a_failed_device_action_is_a_conflict_not_a_retry(client, monkeypatch):
    c, fake = client

    async def failing(entity_id, action, value=None):
        fake.calls.append(('/kiosk/devices/set', {'entity_id': entity_id, 'action': action}))
        return {'ok': False, 'error': '插座是只读的'}
    monkeypatch.setattr(fake, 'set_device', failing)
    status, body = await post(c, '/api/device/set', {'entity_id': 'switch.printer', 'action': 'on'})
    assert status == 409 and body['ok'] is False
    assert len(fake.calls) == 1


@pytest.mark.asyncio
async def test_clearing_history_twice_is_the_same_request(client):
    c, fake = client
    await post(c, '/api/history/clear', {'memory_only': True})
    await post(c, '/api/history/clear', {'memory_only': True})
    assert fake.calls == [('/kiosk/chat/clear', {'memory_only': True})] * 2


@pytest.mark.asyncio
async def test_the_button_actions_reach_the_client_once_each(client):
    c, fake = client
    for path, name in (('/api/wake', 'wake'), ('/api/end', 'end'), ('/api/abort', 'abort'),
                       ('/api/ptt/start', 'ptt_start'), ('/api/ptt/stop', 'ptt_stop')):
        status, body = await post(c, path)
        assert status == 200 and body == {'ok': True}
    await post(c, '/api/text', {'text': '几点了'})
    await asyncio.sleep(0.05)      # the actions run as tasks
    assert [n for n, _ in fake.actions] == ['wake', 'end', 'abort', 'ptt_start', 'ptt_stop', 'say']
    assert fake.actions[-1][1] == ('几点了',)


@pytest.mark.asyncio
async def test_health_and_network_answer_without_touching_the_device(client):
    c, fake = client
    resp = await c.get('/api/health')
    assert resp.status == 200 and (await resp.json())['audio'] == 'ok'
    resp = await c.get('/api/network')
    assert resp.status == 200 and 'ip' in await resp.json()


# ---- music: the same command twice is one player, and status never changes anything ----


@pytest.mark.asyncio
async def test_stopping_what_is_not_playing_is_ok(client):
    c, fake = client
    for _ in range(3):
        status, body = await post(c, '/api/music/stop', {'target': 'local'})
        assert status == 200 and body['ok'] is True
    assert fake.music.starts == 0


@pytest.mark.asyncio
async def test_playing_the_same_track_twice_leaves_one_player(client):
    c, fake = client
    await post(c, '/api/music/play', {'target': 'local', 'title': '勇气', 'volume': 55})
    await post(c, '/api/music/play', {'target': 'local', 'title': '勇气', 'volume': 55})
    assert fake.music.starts == 2            # the second replaces the first: one process at a time
    assert fake.music.playing.endswith('勇气.flac')
    status, body = await post(c, '/api/music/stop', {'target': 'local'})
    assert status == 200 and fake.music.playing is None


@pytest.mark.asyncio
async def test_playing_an_unknown_title_changes_nothing(client):
    c, fake = client
    await post(c, '/api/music/play', {'target': 'local', 'title': '勇气'})
    status, body = await post(c, '/api/music/play', {'target': 'local', 'title': '不存在的歌'})
    assert status == 404 and body['ok'] is False
    assert fake.music.starts == 1 and fake.music.playing.endswith('勇气.flac')


@pytest.mark.asyncio
async def test_an_unknown_target_is_refused_for_every_music_route(client):
    c, fake = client
    for path, body in (('/api/music/play', {'target': 'radio', 'title': '勇气'}),
                       ('/api/music/stop', {'target': 'radio'}),
                       ('/api/music/volume', {'target': 'radio', 'volume': 10})):
        status, answer = await post(c, path, body)
        assert status == 400 and answer['ok'] is False
    assert (await c.get('/api/music/status?target=radio')).status == 400
    assert (await c.get('/api/music/target_volume?target=radio')).status == 400
    assert fake.music.starts == 0 and fake.calls == []


@pytest.mark.asyncio
async def test_a_remote_play_asks_the_hub_once_and_reports_its_answer(client, monkeypatch):
    c, fake = client
    answers = [{'ok': True, 'message': '已在电视上播放'}]

    async def hub_http(path, body=None):
        fake.calls.append((path.split('?')[0], body))
        return answers.pop(0)
    monkeypatch.setattr(fake, '_hub_http', hub_http)
    status, body = await post(c, '/api/music/play', {'target': 'tv', 'title': '勇气'})
    assert status == 200 and body['ok'] is True and body['message'] == '已在电视上播放'
    assert fake.calls == [('/kiosk/music/play', {'target': 'tv', 'query': '勇气'})]
    assert fake.music.starts == 0


@pytest.mark.asyncio
async def test_a_remote_play_that_the_hub_refuses_is_a_conflict(client, monkeypatch):
    c, fake = client

    async def hub_http(path, body=None):
        fake.calls.append((path.split('?')[0], body))
        return {'ok': False, 'error': '电视连不上'}
    monkeypatch.setattr(fake, '_hub_http', hub_http)
    status, body = await post(c, '/api/music/play', {'target': 'tv', 'title': '勇气'})
    assert status == 409 and body['ok'] is False and body['error'] == '电视连不上'
    assert len(fake.calls) == 1


@pytest.mark.asyncio
async def test_reading_music_status_does_not_change_anything(client, monkeypatch):
    c, fake = client
    await post(c, '/api/music/play', {'target': 'local', 'title': '勇气'})
    before = dict(fake.music.__dict__)
    first = await (await c.get('/api/music/status')).json()
    second = await (await c.get('/api/music/status')).json()
    assert first == second and first['playing'] is True
    assert fake.music.starts == before['starts'] and fake.calls == []


@pytest.mark.asyncio
async def test_a_hub_that_is_down_reports_unknown_instead_of_failing(client, monkeypatch):
    c, fake = client

    async def hub_http(path, body=None):
        raise OSError('refused')
    monkeypatch.setattr(fake, '_hub_http', hub_http)
    resp = await c.get('/api/music/status?target=tv')
    assert resp.status == 200
    body = await resp.json()
    assert body['playing'] is False and body['state'] == 'unknown'


@pytest.mark.asyncio
async def test_setting_the_volume_it_already_has_sends_nothing(client, monkeypatch):
    c, fake = client
    fake.devices = {'homes': [], 'error': None, 'devices': [
        {'entity_id': 'media_player.bravia_xr_55x90j', 'value': 0.30}]}
    status, body = await post(c, '/api/music/volume', {'target': 'tv', 'volume': 30})
    assert status == 200 and body['steps'] == 0 and body['from'] == 30
    assert fake.calls == []          # no HA command for a value that is already there


@pytest.mark.asyncio
async def test_the_tv_volume_steps_toward_the_target(client, monkeypatch):
    c, fake = client
    fake.devices = {'homes': [], 'error': None, 'devices': [
        {'entity_id': 'media_player.bravia_xr_55x90j', 'value': 0.30}]}
    status, body = await post(c, '/api/music/volume', {'target': 'tv', 'volume': 40})
    assert status == 200 and body['from'] == 30 and body['steps'] == 5   # 2 steps per press
    assert all(call[1]['action'] == 'volume_up' for call in fake.calls)


@pytest.mark.asyncio
async def test_a_bad_volume_is_refused(client):
    c, fake = client
    status, body = await post(c, '/api/music/volume', {'target': 'tv', 'volume': 'loud'})
    assert status == 400 and body['ok'] is False
    assert fake.calls == []


# ---- the kiosk's files ----


def read(path):
    return (WEB / path).read_text(encoding='utf-8')


@pytest.mark.asyncio
async def test_the_kiosk_gets_v2_and_an_event_stream(client):
    c, _ = client
    resp = await c.get('/')
    html = await resp.text()
    assert resp.status == 200 and 'v2' in html and 'orb' in html
    assert resp.headers['Cache-Control'] == 'no-cache'
    resp = await c.get('/v2')
    assert resp.status == 200 and 'orb' in await resp.text()
    resp = await c.get('/v1')
    assert resp.status == 200


@pytest.mark.asyncio
async def test_every_asset_the_page_references_is_served(client):
    c, _ = client
    html = read('v2/index.html')
    paths = set(re.findall(r'(?:src|href)="([^"]+)"', html))
    paths |= set(re.findall(r"['\"]((?:logos|sounds|v2|test)/[^'\"]+)['\"]", read('v2/app.js')))
    local = sorted(p for p in paths if not p.startswith(('http', 'data:', '#')))
    assert '/static/v2/app.js' in local and '/static/v2/app.css' in local
    for p in local:
        resp = await c.get(p if p.startswith('/') else '/static/' + p)
        assert resp.status == 200, p
        assert resp.headers.get('Cache-Control') == 'no-cache', p     # an update must reach the kiosk


@pytest.mark.asyncio
async def test_a_missing_static_file_is_a_404(client):
    c, _ = client
    assert (await c.get('/static/v2/nope.js')).status == 404


def test_the_page_and_the_script_agree_on_the_ids():
    """Every id the script writes to exists in the page, and every button it listens on too."""
    html = read('v2/index.html')
    js = read('v2/app.js')
    ids = set(re.findall(r'id="([^"]+)"', html))
    used = set(re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", js))
    used |= set(re.findall(r"\$\('#([A-Za-z0-9_-]+)'\)", js))
    missing = sorted(used - ids)
    assert not missing, f'app.js writes to ids the page lacks: {missing}'
    # the API paths the page posts to must exist in web.py
    routes = set(re.findall(r"add_(?:get|post)\('([^']+)'", read_web()))
    # a path built at runtime ("/api/alarms/" + id) is checked by its prefix
    posted = set(re.findall(r"['\"](/api/[A-Za-z0-9/_-]*[A-Za-z0-9_-])['\"]", js))
    unknown = sorted(p for p in posted
                     if p not in routes and not p.endswith('/') and
                     not any(r.startswith(p + '/') for r in routes))
    assert not unknown, f'app.js posts to unknown routes: {unknown}'


def read_web():
    return (ROOT / 'thinksmart_client' / 'web.py').read_text(encoding='utf-8')


def test_the_page_keeps_no_settings_of_its_own():
    """The kiosk reloads itself on a new build and the client is the only store.

    localStorage here only remembers "this update toast was shown", which is safe to lose.
    Anything that looks like a setting (volume, brightness, alarms) must come from the client.
    """
    js = read('v2/app.js')
    keys = set(re.findall(r"localStorage\.(?:get|set)Item\(['\"]([^'\"]+)['\"]", js))
    assert keys <= {'updShown'}, keys
    assert 'sessionStorage' not in js


def test_the_manifest_of_sound_and_logo_files_matches_the_disk():
    """app.js names the sounds and logos; a renamed file would leave a dead reference."""
    js = read('v2/app.js')
    for name in sorted(set(re.findall(r"['\"]sounds/([A-Za-z0-9_.-]+)['\"]", js))):
        assert (WEB / 'sounds' / name).exists(), name
    for name in sorted(set(re.findall(r"['\"]logos/([A-Za-z0-9_.-]+)['\"]", js))):
        assert (WEB / 'logos' / name).exists(), name


def test_the_page_deduplicates_events_by_identity():
    """A replayed event must be handled once, and a new one never swallowed.

    The kiosk reloads and reconnects on its own; the client replays a snapshot then. Only events
    that name the thing that happened are deduplicated, and a new connection clears the memory
    (seenEvents.clear()) so nothing from the old stream can block the new one.
    """
    js = read('v2/app.js')
    assert 'function eventKey(' in js and 'function once(' in js
    keyed = re.search(r'function eventKey\(name, d\) \{(.*?)\n\}', js, re.S).group(1)
    assert "'message:' + d.id" in keyed          # a message is identified by its id
    assert "return null;" in keyed               # state/level are always applied
    assert 'seenEvents.clear()' in js            # a fresh connection forgets the old stream


def test_the_page_sends_a_volume_once_while_it_is_in_flight():
    """Dragging the slider must not press the TV's remote for every pixel."""
    js = read('v2/app.js')
    assert 'const volSending = {}' in js
    assert 'if (volSending[key]) return volSending[key];' in js


def test_the_music_module_is_idempotent_on_the_track_it_plays(tmp_path, monkeypatch):
    """The real music_api: playing the same track twice does not restart it.

    ffplay is replaced by a stand-in, so nothing comes out of the speaker here.
    """
    import types as _types
    from thinksmart_client import music_api

    track = tmp_path / '勇气.flac'
    track.write_bytes(b'x')
    monkeypatch.setattr(music_api, '_load_index', lambda: [
        {'title': '勇气', 'artist': '梁静茹', 'path': str(track)},
        {'title': '勇气（伴奏）', 'artist': '梁静茹', 'path': str(tmp_path / 'gone.flac')},
    ])
    monkeypatch.setattr(music_api, '_exist_cache', {})

    class Proc:
        def __init__(self):
            self.returncode = None

        def poll(self):
            return self.returncode

        def terminate(self):
            self.returncode = 0

        def wait(self, timeout=None):
            return 0

        def kill(self):
            self.returncode = -9
    starts = []

    def popen(cmd, **_kw):
        starts.append(cmd)
        return Proc()
    monkeypatch.setattr(music_api.subprocess, 'Popen', popen)

    found = music_api.find_track('勇气')
    assert found['title'] == '勇气'          # the exact title, not the accompaniment
    first = music_api.local_play(found['path'], 55)
    second = music_api.local_play(found['path'], 55)
    assert first['restarted'] is True and second['restarted'] is False
    assert len(starts) == 1                   # one player, still on the same track
    third = music_api.local_play(found['path'], 30)     # a new volume: ffplay must restart
    assert third['restarted'] is True and len(starts) == 2
    status = music_api.local_status()
    assert status['playing'] is True and status['volume'] == 30
    music_api.local_stop()
    assert music_api.local_status()['playing'] is False
    assert music_api.local_stop()['ok'] is True          # stopping again is still ok


def test_the_snapshot_tells_the_page_whether_the_hub_answered():
    """connected=false is not "the client is down": the page needs hub to word the banner.

    The snapshot carries the same hub field as /api/health, so the kiosk can say
    "后台在，点麦克风开始对话" instead of "还没连上后台" when only the conversation hasn't started.
    """
    src = (ROOT / 'thinksmart_client' / 'app.py').read_text(encoding='utf-8')
    snap = re.search(r'def snapshot\(self\):(.*?)\n    def ', src, re.S).group(1)
    assert "hub=self.health()['hub']" in snap
    js = read('v2/app.js')
    assert 'function backendUp()' in js and "ui.status.hub === true" in js


def test_json_round_trip_of_the_snapshot_is_stable():
    """The page reads the snapshot as JSON; encoding it twice must not change it (idempotent)."""
    snap = FakeClient().snapshot()
    once = json.dumps(snap, ensure_ascii=False)
    twice = json.dumps(json.loads(once), ensure_ascii=False)
    assert once == twice


@pytest.mark.asyncio
async def test_setting_the_same_volume_again_does_not_touch_the_speaker(monkeypatch):
    """The page sends the slider value on release; the same value must not run wpctl again."""
    from thinksmart_client import app as app_mod, mcp
    calls = []

    async def fake_set(v):
        calls.append(v)
    monkeypatch.setattr(mcp, 'set_volume', fake_set)
    c = app_mod.Client.__new__(app_mod.Client)
    c.volume_lock = asyncio.Lock()
    c.volume = None
    c.held_volume = None
    c.events = app_mod.Events()
    assert await c.set_volume(40) == 40
    assert await c.set_volume(40) == 40      # already there: no second wpctl
    assert calls == [40]
    assert await c.set_volume(55) == 55
    assert calls == [40, 55]
    assert await c.set_volume(300) == 100    # clamped
    assert calls == [40, 55, 100]
