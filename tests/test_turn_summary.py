"""One log line per turn: how slow the whole round trip actually was.

Stage 0 of the 2026-11-20 review: before changing behaviour again, make "the child waited X seconds"
and "the answer ran Y seconds" measurable. The line is:
  turn: asr=1.8 s, first audio=0.9 s, play=9.12 s, dry=1, interrupted=False, said=120 chars
"""
import pytest

from test_barge_in import PACKET, make_client
from thinksmart_client import app


@pytest.mark.asyncio
async def test_the_turn_line_carries_theasr_the_first_audio_and_the_play_time(caplog):
    c = make_client()
    c.speech_end = 0.0
    await c._on_json({'type': 'stt', 'text': '讲个冷笑话'})
    assert c.turn_at > 0 and c.turn_first == 0.0
    await c._on_json({'type': 'tts', 'state': 'start'})
    c._on_audio(PACKET)
    assert c.turn_first > 0, 'the first packet must be timed'
    for _ in range(4):
        c._on_audio(PACKET)
    with caplog.at_level('INFO'):
        await c._on_json({'type': 'tts', 'state': 'stop'})
    line = [r.getMessage() for r in caplog.records if 'turn:' in r.message]
    assert line, 'no turn summary was logged'
    got = line[-1] if isinstance(line[-1], str) else line[-1]
    assert 'asr=' in got and 'first audio=' in got and 'play=' in got and 'interrupted=False' in got


@pytest.mark.asyncio
async def test_an_interrupted_turn_says_so(caplog):
    c = make_client()
    await c._on_json({'type': 'stt', 'text': '把音乐停了'})
    await c._on_json({'type': 'tts', 'state': 'start'})
    c._on_audio(PACKET)
    with caplog.at_level('INFO'):
        await c._on_json({'type': 'tts', 'state': 'stop', 'interrupted': True})
    joined = ' '.join(r.getMessage() for r in caplog.records if 'turn:' in r.message)
    assert 'interrupted=True' in joined
