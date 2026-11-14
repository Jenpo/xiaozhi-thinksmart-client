"""A tool call (a pause on the TV, the volume) runs before the model's first sentence. The follow-up
window used to close the mic while it ran: the hub then saw an idle connection and dropped it, and
anything said meanwhile never reached it.

Run like test_barge_in.py (same stubs).
"""
import pytest
import types

from test_barge_in import make_client
from thinksmart_client import app


async def tick_once(c, now):
    """One step of _ticker (it sleeps 0.1 s per step and never returns).

    The clock is swapped in the module's `time` for this one step only: monkeypatch would make
    asyncio.sleep itself wait for `now` to pass.
    """
    import asyncio
    import thinksmart_client.app as real_app
    saved = real_app.time
    real_app.time = types.SimpleNamespace(monotonic=lambda: now, sleep=asyncio.sleep)
    try:
        task = asyncio.create_task(c._ticker())
        await asyncio.sleep(0.15)
    finally:
        task.cancel()
        real_app.time = saved
    try:
        await task
    except asyncio.CancelledError:
        pass


@pytest.mark.asyncio
async def test_tool_note_keeps_the_mic_open_while_the_follow_up_window_expires(monkeypatch):
    c = make_client()
    await c._on_json({'type': 'stt', 'text': '把电视暂停'})
    assert c.state == 'thinking'
    c.uploading = True          # the follow-up window kept the mic open
    c.deadline = 99.0           # ... and it has just run out
    await c._on_json({'type': 'stt', 'text': '% cast_youtube'})
    assert c.hold_open
    await tick_once(c, 100.0)
    assert c.uploading            # no reply yet: the mic stays open
    assert c.deadline > 100.0    # pushed back, not closed


@pytest.mark.asyncio
async def test_the_reply_closes_the_hold(monkeypatch):
    c = make_client()
    await c._on_json({'type': 'stt', 'text': '把电视暂停'})
    c.uploading = True
    await c._on_json({'type': 'stt', 'text': '% cast_youtube'})
    assert c.hold_open
    await c._on_json({'type': 'tts', 'state': 'start'})
    assert not c.hold_open
    await c._on_json({'type': 'stt', 'text': '好，暂停了'})
    assert not c.hold_open


@pytest.mark.asyncio
async def test_a_mic_already_closed_is_not_reopened(monkeypatch):
    c = make_client()
    await c._on_json({'type': 'stt', 'text': '把电视暂停'})
    c.uploading = False         # push-to-talk already released: nothing to hold
    c.deadline = 100.0
    await c._on_json({'type': 'stt', 'text': '% cast_youtube'})
    assert not c.hold_open
    await tick_once(c, 100.0)
    assert not c.uploading
