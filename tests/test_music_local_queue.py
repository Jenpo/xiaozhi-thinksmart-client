"""The page's own player (music_api): a finished track goes on to the next one in the list, stop and
switching don't, pause keeps the position, and a volume change restarts from where it was."""
import os
import sys
import time

import pytest

from thinksmart_client import music_api


@pytest.fixture
def player(tmp_path, monkeypatch):
    """A stand-in for ffplay: records its arguments, then plays for PLAY_SECONDS."""
    log = tmp_path / 'argv.log'
    fake = tmp_path / 'fakeplay'
    fake.write_text('#!%s\nimport sys, time\nopen(%r, "a").write(" ".join(sys.argv[1:]) + "\\n")\n'
                    'time.sleep(float(%r))\n' % (sys.executable, str(log), os.environ.get('PLAY_SECONDS', '0.4')))
    fake.chmod(0o755)
    monkeypatch.setattr(music_api, 'PLAYER_BIN', str(fake))
    tracks = []
    for i in range(3):
        f = tmp_path / ('t%d.flac' % i)
        f.write_bytes(b'x')
        tracks.append({'title': 'song %d' % i, 'artist': 'a', 'path': str(f)})
    yield tracks, log
    music_api.local_stop()
    music_api.set_queue([])


def wait_for(cond, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        music_api.tick()
        if cond():
            return True
        time.sleep(0.05)
    return False


def test_a_finished_track_goes_on_to_the_next(player):
    tracks, _ = player
    music_api.set_queue(tracks, 0)
    assert music_api.play_index(0, 50)['ok']
    assert music_api.local_status()['index'] == 1
    assert wait_for(lambda: music_api.local_status().get('index') == 2)
    assert music_api.local_status()['title'] == 'song 1'
    assert music_api.local_status()['total'] == 3


def test_stop_does_not_go_on(player):
    tracks, _ = player
    music_api.set_queue(tracks, 0)
    music_api.play_index(0, 50)
    music_api.local_stop()
    time.sleep(0.6)
    music_api.tick()
    assert not music_api.local_status()['playing']
    assert music_api.local_status()['path'] is None


def test_next_and_prev_wrap_around_the_list(player):
    tracks, _ = player
    music_api.set_queue(tracks, 0)
    music_api.play_index(0, 50)
    assert music_api.local_next(-1)['index'] == 2
    assert music_api.local_next(1)['index'] == 0


def test_pause_keeps_the_position_and_resume_goes_on(player, monkeypatch):
    tracks, _ = player
    monkeypatch.setenv('PLAY_SECONDS', '5')
    music_api.set_queue(tracks, 0)
    music_api.play_index(0, 50)
    time.sleep(0.3)
    assert music_api.local_pause()['ok']
    st = music_api.local_status()
    assert st['paused'] and not st['playing']
    held = st['elapsed']
    time.sleep(0.4)
    assert music_api.local_status()['elapsed'] == held          # frozen while paused
    assert music_api.local_resume()['ok']
    assert music_api.local_status()['playing']


def test_volume_change_restarts_from_the_current_position(player, monkeypatch):
    tracks, log = player
    monkeypatch.setenv('PLAY_SECONDS', '5')
    monkeypatch.setattr(music_api, '_local_started', 0.0)
    music_api.set_queue(tracks, 0)
    music_api.play_index(0, 50)
    music_api._local_started = time.time() - 30          # as if it had played 30 s
    music_api.local_set_volume(70)
    end = time.time() + 5
    while time.time() < end and not (log.exists() and '-volume 70' in log.read_text()):
        time.sleep(0.05)
    last = log.read_text().strip().splitlines()[-1]
    assert '-volume 70' in last and '-ss 30' in last
    assert music_api.local_status()['index'] == 1        # still the same track
