"""The hub must not start music on its own while the device is answering.

2026-11-20 device log: 40 'the hub plays' in one day, 21 of them with no song_request/play_music
anywhere near them, all arriving while state == 'speaking' (16:19-16:26, the math questions:
'1/20: 06' restarted over and over, the child had to say the wake word twice to stop it).
A real request is allowed; a re-start right after a request is allowed; a resumed playlist while
the device is talking is paused (not destroyed, so "继续放" picks it up).
"""
import asyncio
import time

import pytest

from test_barge_in import make_client


def playing_soon(c):
    return [m for m in c.hub.sent if m.get('type') == 'music' and m.get('action') == 'pause']


@pytest.mark.asyncio
async def test_music_restart_while_speaking_without_a_request_is_paused():
    c = make_client()
    c.state = 'speaking'
    c.last_song_tool = time.monotonic() - 600          # last request: ten minutes ago
    c._on_music({'type': 'music', 'state': 'start', 'index': 1, 'total': 20,
                       'title': '06', 'source': 'nas'})
    await asyncio.sleep(0)
    assert playing_soon(c), 'no pause was sent for an unrequested restart'
    assert c.hub_music is None or c.hub_music.get('state') == 'start'


@pytest.mark.asyncio
async def test_a_real_song_request_is_not_paused():
    c = make_client()
    c.state = 'speaking'
    c.last_song_tool = time.monotonic() - 2             # the model just called song_request
    await c._on_json({'type': 'stt', 'text': '% song_request(song_name="06")'})
    c._on_music({'type': 'music', 'state': 'start', 'index': 1, 'total': 20,
                       'title': '06', 'source': 'nas'})
    await asyncio.sleep(0)
    assert not playing_soon(c), 'a requested song must play'


@pytest.mark.asyncio
async def test_music_starting_while_idle_is_left_alone():
    """A reconnect resumes the playlist with state == 'start'; that is not a spurious restart."""
    c = make_client()
    c.state = 'idle'
    c.last_song_tool = 0.0
    c._on_music({'type': 'music', 'state': 'start', 'index': 3, 'total': 20,
                       'title': '矜持', 'source': 'nas'})
    await asyncio.sleep(0)
    assert not playing_soon(c), 'a reconnect must not pause the playlist'


@pytest.mark.asyncio
async def test_playlist_advance_while_speaking_after_a_recent_request_is_left_alone():
    """Auto-advance (index 2 of 20) a few seconds after a request is normal continuous play."""
    c = make_client()
    c.state = 'speaking'
    c.last_song_tool = time.monotonic() - 20
    c._on_music({'type': 'music', 'state': 'start', 'index': 2, 'total': 20,
                       'title': 'Suite', 'source': 'nas'})
    await asyncio.sleep(0)
    assert not playing_soon(c)
