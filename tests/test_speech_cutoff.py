"""A reply must not be cut off mid-sentence when the hub simply finished sending it.

2026-11-20: the hub streams all the sentences and then sends {"type":"tts","state":"stop"} without
"interrupted"; playback is usually a few seconds behind. The client used to fall back to
"buffered() > NORMAL_STOP_TAIL" when the flag was missing, so a normal ending looked like an abort
and the rest of the reply was trimmed away ("话说一半就停了"). In that day's log 128 of 139 stops
carried more than 0.6 s still queued.
"""
import asyncio

import pytest

from test_barge_in import PACKET, make_client


async def speaking_client(packets=20):
    """A reply that has streamed `packets` x 60 ms and is still playing."""
    c = make_client()
    await c._on_json({'type': 'tts', 'state': 'start'})
    await c._on_json({'type': 'tts', 'state': 'sentence_start', 'text': '好的'})
    for _ in range(packets):
        c._on_audio(PACKET)
    assert c.state == 'speaking'
    return c


@pytest.mark.asyncio
async def test_a_normal_end_lets_the_queued_audio_play():
    c = await speaking_client()
    queued = c.audio.player.buffered()
    assert queued > 0.6, 'the fixture must leave more than the old tail threshold queued'
    await c._on_json({'type': 'tts', 'state': 'stop'})
    assert abs(c.audio.player.buffered() - queued) < 0.01, 'a normal stop threw the rest of the reply away'


@pytest.mark.asyncio
async def test_an_interrupted_reply_is_still_cut():
    c = await speaking_client()
    await c._on_json({'type': 'tts', 'state': 'stop', 'interrupted': True})
    assert c.audio.player.buffered() < 0.2, 'an abort must drop the queued audio'


@pytest.mark.asyncio
async def test_a_new_reply_clears_the_tail_of_the_previous_one():
    """Older hubs abort by just starting a new reply: the old tail must not play over it."""
    c = await speaking_client()
    await c._on_json({'type': 'tts', 'state': 'stop'})          # no flag: treated as a normal end
    assert c.audio.player.buffered() > 0.6
    await c._on_json({'type': 'tts', 'state': 'start'})
    assert c.audio.player.buffered() < 0.2, 'the previous reply kept playing under the new one'
