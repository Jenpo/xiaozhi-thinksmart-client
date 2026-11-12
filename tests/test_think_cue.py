"""A slow reply gets a short local filler ("嗯，我看看") instead of silence; a quick one doesn't."""
import asyncio

import numpy as np
import pytest

from test_barge_in import PACKET, make_client   # stubs the device's audio stack on import
from thinksmart_client.audio import OUT_RATE

CUE_S = 0.1


def with_cue(after=0.05):
    c = make_client()
    c.cfg['think_cue_seconds'] = after
    c.think_cues = [np.full((int(OUT_RATE * CUE_S), 2), 0.1, np.float32)]
    c.think_cue_n, c.think_task = 0, None
    return c


async def question(c, text='放首周杰伦的歌'):
    await c.start_listening('realtime')
    await c._on_json({'type': 'stt', 'text': text})
    await c._on_json({'type': 'tts', 'state': 'start'})


@pytest.mark.asyncio
async def test_slow_reply_gets_the_filler_and_the_reply_follows_it():
    c = with_cue()
    await question(c)
    await asyncio.sleep(0.1)
    assert c.state == 'thinking'
    assert abs(c.audio.player.buffered() - CUE_S) < 0.01 and c.think_cue_n == 1
    await c._on_json({'type': 'tts', 'state': 'sentence_start', 'text': '好的'})
    c._on_audio(PACKET)
    assert c.state == 'speaking'
    assert abs(c.audio.player.buffered() - CUE_S - 0.06) < 0.01   # queued behind the filler


@pytest.mark.asyncio
async def test_quick_reply_gets_no_filler():
    c = with_cue()
    await question(c, '你好')
    await c._on_json({'type': 'tts', 'state': 'sentence_start', 'text': '你好呀'})
    c._on_audio(PACKET)
    await asyncio.sleep(0.1)
    assert c.think_cue_n == 0


@pytest.mark.asyncio
async def test_interrupted_question_gets_no_filler():
    c = with_cue()
    await question(c)
    await c.wake('voice')                     # the wake word again before any answer
    await asyncio.sleep(0.1)
    assert c.think_cue_n == 0 and c.audio.player.buffered() < 0.01


@pytest.mark.asyncio
async def test_a_newer_question_replaces_the_pending_filler():
    c = with_cue(0.08)
    await question(c, '第一句')
    await asyncio.sleep(0.04)
    await c._on_json({'type': 'stt', 'text': '第二句'})
    await asyncio.sleep(0.06)                 # the first one's time is up: nothing for it
    assert c.think_cue_n == 0
    await asyncio.sleep(0.05)
    assert c.think_cue_n == 1


@pytest.mark.asyncio
async def test_off_when_set_to_zero():
    c = with_cue(0)
    await question(c)
    await asyncio.sleep(0.05)
    assert c.think_task is None and c.think_cue_n == 0
