"""A reply that ends normally with audio still queued: the mic must not upload that tail (it would send the
device's own words to the hub; 2026-11-20 09:30 the weather reply came back as a question).
An interruption clears the hold at once."""
import asyncio
import time

import pytest

from test_barge_in import PACKET, ask, make_client


async def _reply_with_tail(c, seconds=2.0):
    await ask(c)
    for _ in range(int(seconds / 0.06)):
        c._on_audio(PACKET)
    c.uploading = True                     # the mic is open while the reply's last seconds play
    await c._on_json({'type': 'tts', 'state': 'stop', 'interrupted': False})


def _sender(c):
    sent = []

    async def send_audio(packet):
        sent.append(packet)
    c.hub.send_audio = send_audio
    c._send_q = asyncio.Queue(10)
    return sent, asyncio.create_task(c._sender())


@pytest.mark.asyncio
async def test_mic_waits_for_the_queued_reply_tail():
    c = make_client()
    await _reply_with_tail(c)
    assert c.echo_until > time.monotonic() + 1.5          # about 2 s of tail + 0.3 s room echo
    sent, task = _sender(c)
    c._send_q.put_nowait(b'echo')
    await asyncio.sleep(0.1)
    assert sent == []                                    # the device's own voice is not uploaded
    c.echo_until = time.monotonic() - 0.01               # the tail has played
    c._send_q.put_nowait(b'child')
    await asyncio.sleep(0.1)
    task.cancel()
    assert sent == [b'child']


@pytest.mark.asyncio
async def test_follow_up_window_counts_from_the_end_of_playback():
    c = make_client()
    await _reply_with_tail(c)
    assert c.deadline > time.monotonic() + c.cfg['follow_up_seconds'] + 1.5


@pytest.mark.asyncio
async def test_abort_clears_the_hold():
    c = make_client()
    await _reply_with_tail(c)
    await c.abort('wake_word_detected')
    assert c.echo_until == 0.0
