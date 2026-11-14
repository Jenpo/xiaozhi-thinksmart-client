"""The kiosk's touch screen sometimes reports one tap on a suggestion card 6-15 times in the same
second, and now and then on the neighbouring card too (hub log 2026-11-14 09:16:26 and 12:31:54).
Every copy used to abort the turn before it; the last ghost won, so "明天天气怎么样？" was answered
as "帮我定一个 20 分钟后的计时". Text questions closer together than SAY_DEBOUNCE are one tap.

Run like test_barge_in.py (same stubs).
"""
import asyncio
import time as real_time
import types

import pytest

from test_barge_in import make_client
from thinksmart_client import app


class Clock:
    def __init__(self, now=1000.0):
        self.now = now

    def monotonic(self):
        return self.now

    def __getattr__(self, name):
        return getattr(real_time, name)


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(app, 'time', c)
    return c


def text_client():
    c = make_client()
    c.last_say = 0.0
    c.tools_listed = asyncio.Event()
    c.tools_listed.set()
    return c


def detects(c):
    return [m['text'] for m in c.hub.sent if m['type'] == 'listen' and m.get('state') == 'detect']


@pytest.mark.asyncio
async def test_a_burst_of_the_same_tap_asks_once_and_aborts_nothing(clock):
    c = text_client()
    for i in range(15):
        clock.now = 1000.0 + i * 0.02
        await c.say('讲个冷笑话')
    assert detects(c) == ['讲个冷笑话']
    assert not any(m['type'] == 'abort' for m in c.hub.sent)
    assert c.state == 'thinking'


@pytest.mark.asyncio
async def test_a_ghost_tap_on_the_next_card_does_not_replace_the_question(clock):
    c = text_client()
    await c.say('明天天气怎么样？')
    for i in range(6):
        clock.now += 0.05
        await c.say('帮我定一个 20 分钟后的计时')
    assert detects(c) == ['明天天气怎么样？']


@pytest.mark.asyncio
async def test_a_real_second_question_after_the_window_goes_through(clock):
    c = text_client()
    await c.say('明天天气怎么样？')
    clock.now += app.SAY_DEBOUNCE + 0.1
    await c.say('讲个冷笑话')
    assert detects(c) == ['明天天气怎么样？', '讲个冷笑话']


@pytest.mark.asyncio
async def test_empty_text_does_not_start_the_window(clock):
    c = text_client()
    await c.say('   ')
    await c.say('讲个冷笑话')
    assert detects(c) == ['讲个冷笑话']
