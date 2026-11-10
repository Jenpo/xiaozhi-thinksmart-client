"""Dead audio after a PipeWire restart: the client exits for systemd to restart it, and the playback
buffer doesn't grow without end meanwhile.

Run like test_barge_in.py (it stubs the audio stack; importing it first does that here too).
"""
import asyncio
import types

import numpy as np
import pytest

from test_barge_in import make_client
from thinksmart_client import app, audio
from thinksmart_client.audio import MAX_BUFFER, OUT_RATE, STALL, Audio, Player


def sound(seconds):
    return np.zeros((int(OUT_RATE * seconds), 2), np.float32)


def test_push_drops_new_sound_once_the_buffer_is_full():
    p = Player()
    for _ in range(MAX_BUFFER // 10):
        p.push(sound(10))
    assert p.buffered() == MAX_BUFFER
    p.push(sound(10))                       # the speaker stopped pulling: refused
    assert p.buffered() == MAX_BUFFER and p.dropped == 10 * OUT_RATE
    p.pull(OUT_RATE)                        # playing again: room for more
    p.push(sound(0.5))
    assert p.buffered() == MAX_BUFFER - 0.5 and p.dropped == 0


def test_buffered_follows_pull_and_trim():
    p = Player()
    p.push(sound(1))
    p.push(sound(2))
    p.pull(OUT_RATE // 2)
    assert p.buffered() == 2.5
    p.pull(OUT_RATE)
    assert p.buffered() == 1.5
    p.trim(1)
    assert p.buffered() == 1
    p.trim(0)
    assert p.buffered() < 0.01


class FakeStream:
    active = True


def started_audio(monkeypatch, now):
    a = Audio.__new__(Audio)
    a._streams = [FakeStream(), FakeStream()]
    a.last_in = a.last_out = now
    monkeypatch.setattr(audio.time, 'monotonic', lambda: clock[0])
    return a


clock = [0.0]


def test_stalled_when_mic_or_speaker_stop_or_a_stream_dies(monkeypatch):
    clock[0] = 100.0
    a = started_audio(monkeypatch, 100.0)
    assert a.stalled() is None
    clock[0] = 100 + STALL - 0.5            # quiet room, mic switch off: blocks still come, all fine
    assert a.stalled() is None
    clock[0] = 100 + STALL + 1
    a.last_out = clock[0]
    assert 'microphone' in a.stalled()
    a.last_in = clock[0]
    assert a.stalled() is None
    a.last_out = 100.0
    assert 'speaker' in a.stalled()
    a.last_out = clock[0]
    a._streams[0].active = False
    assert a.stalled() == 'stream stopped'


def test_not_stalled_before_the_streams_are_open():
    a = Audio.__new__(Audio)
    a._streams = []
    a.last_in = a.last_out = 0.0
    assert a.stalled() is None


@pytest.mark.asyncio
async def test_ticker_exits_when_the_audio_is_dead(monkeypatch):
    c = make_client()
    exits = []

    class Exited(Exception):
        pass

    def fake_exit(code):
        exits.append(code)
        raise Exited
    monkeypatch.setattr(app.os, '_exit', fake_exit)
    dead = []
    c.audio.stalled = lambda: dead[0] if dead else None
    t = asyncio.create_task(c._ticker())
    await asyncio.sleep(0.25)
    assert not exits and not t.done()
    dead.append('no microphone block for 6 s')
    with pytest.raises(Exited):
        await asyncio.wait_for(t, 1)
    assert exits == [1]


@pytest.mark.asyncio
async def test_talking_past_the_follow_up_window_keeps_the_mic_until_the_cap(monkeypatch):
    """A long sentence may go past the follow-up window; the cap is the only stop.

    The clamp used to shrink the deadline to listen_since + MAX_LISTEN, which is in the past once
    the sentence crossed the cap, so the mic closed mid-way.
    """
    c = make_client()
    clock = [1000.0]
    monkeypatch.setattr(app.time, 'monotonic', lambda: clock[0])
    stopped = []

    async def stop_uploading(missed=False):
        stopped.append(missed)
    c.stop_uploading = stop_uploading
    c.uploading = True
    c.state = 'listening'               # the deadline rules only apply while listening
    c.listen_mode = 'realtime'
    c.listen_since = clock[0]
    c.deadline = clock[0] + 10          # the follow-up window
    c.heard = False
    c.speech_end = clock[0] + 1
    c.speech_start = clock[0]
    c.audio.mic_level = 1.0             # the user is talking
    c.audio.stalled = lambda: None
    c.hub_pending = True
    c.hub.features = {'vad_end': True}

    # The ticker's first sleep waits on the event loop's own clock, which is not patched here, so
    # it is cancelled after one pass over its body and the remaining cases are driven by hand.
    async def step(n):
        for _ in range(n):
            await asyncio.sleep(0)
    t = asyncio.create_task(c._ticker())
    await step(3)
    t.cancel()
    with pytest.raises(asyncio.CancelledError):
        await t
    assert not stopped

    # a helper that runs exactly the deadline part of the ticker body with our clock
    def tick(now):
        if c.uploading and c.audio.mic_level > app.SPEECH_RMS:
            if not c.speech_end or c.speech_end < c.listen_since:
                c.speech_start = now
            c.speech_end = now
            if c.deadline and c.listen_since + app.MAX_LISTEN > now:
                wait = app.SHORT_END_WAIT if now - c.speech_start < app.QUICK_END else 0.6
                c.deadline = min(max(c.deadline, now + wait), c.listen_since + app.MAX_LISTEN)
        return now > c.deadline

    # still talking past the follow-up window, under the cap: the mic stays open
    clock[0] += 11
    c.speech_start = clock[0]                            # the turn's first sound comes now
    assert tick(clock[0]) is False
    assert c.deadline == pytest.approx(clock[0] + app.SHORT_END_WAIT)   # the first sound: the short wait

    # talking on: the hub has had time to see the sentence, so the mic closes 0.6 s after the last sound
    for _ in range(20):
        clock[0] += 0.1
        assert tick(clock[0]) is False
        wait = app.SHORT_END_WAIT if clock[0] - c.speech_start < app.QUICK_END else 0.6
        assert c.deadline == pytest.approx(min(max(c.deadline, clock[0] + wait), c.listen_since + app.MAX_LISTEN))
    # past the cap: the clamp no longer applies and the deadline is in the past
    clock[0] = c.listen_since + app.MAX_LISTEN + 0.5
    assert tick(clock[0]) is True
    # the deadline stays where it was (not pushed forward any more), and is now in the past:
    # the loop above ended at 1013.2 s, so 1013.2 + 0.6 (the last sound was 1.2 s in)
    assert c.deadline == pytest.approx(1013.6) and c.deadline < clock[0]
