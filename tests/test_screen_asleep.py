"""The page pauses its animations while the blanker has the screen dark (device.watch_screen).

Run: python -m pytest tests/test_screen_asleep.py
"""
import asyncio

from thinksmart_client import device


def test_screen_lit_reads_backlight(tmp_path, monkeypatch):
    bl = tmp_path / 'brightness'
    monkeypatch.setattr(device, 'BACKLIGHT_PATH', bl)
    assert device.screen_lit()            # no backlight file: count as lit
    bl.write_text('10\n')
    assert not device.screen_lit()        # the blanker's BLANK_BRIGHTNESS
    bl.write_text('1400\n')
    assert device.screen_lit()            # the user's 0 %
    bl.write_text('garbage')
    assert device.screen_lit()


def test_watch_screen_publishes_changes_only(tmp_path, monkeypatch):
    bl = tmp_path / 'brightness'
    bl.write_text('4095')
    monkeypatch.setattr(device, 'BACKLIGHT_PATH', bl)
    seen = []

    async def run():
        task = asyncio.create_task(device.watch_screen(lambda e, d: seen.append((e, d)), interval=0.01))
        await asyncio.sleep(0.05)
        bl.write_text('10')
        await asyncio.sleep(0.05)
        bl.write_text('3900')
        await asyncio.sleep(0.05)
        task.cancel()

    asyncio.run(run())
    assert seen == [('screen', {'on': False}), ('screen', {'on': True})]
