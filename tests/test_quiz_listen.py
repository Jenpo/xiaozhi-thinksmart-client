"""语音答题：family.Family.listen 的断句和垫话剥离（不需要声卡和 hub）。

Run: python -m pytest tests/test_quiz_listen.py
"""
import asyncio
import threading
import time
import types

import numpy as np

from thinksmart_client import family


def _fam(state='idle', uploading=False):
    f = family.Family.__new__(family.Family)
    f.client = types.SimpleNamespace(state=state, uploading=uploading, cfg={'hub_http': 'http://x'})
    f.rec = None
    f.lis = None
    f.lis_gen = 0
    f.carriers = {'yue': b'\0\0' * 100}
    return f


def _block(db, n=320, rng=np.random.default_rng(1)):
    x = rng.standard_normal(n).astype(np.float32)
    return x / np.sqrt(np.mean(x * x)) * 10 ** (db / 20)


def _feed(f, plan, stop):
    """plan: [(dBFS, seconds), ...] fed in real time-ish (20 ms blocks, 4x faster than real)."""
    while f.lis is None and not stop.is_set():
        time.sleep(0.001)
    for db, sec in plan:
        for _ in range(int(sec / 0.02)):
            if stop.is_set():
                return
            f.on_block(_block(db))
            time.sleep(0.005)


def _run(f, plan, **kw):
    sent = {}

    async def fake_asr(pcm):
        sent['bytes'] = len(pcm)
        return '答案系五十六。'
    f._asr = fake_asr
    stop = threading.Event()
    t = threading.Thread(target=_feed, args=(f, plan, stop), daemon=True)
    t.start()
    try:
        r = asyncio.run(f.listen('yue', **kw))
    finally:
        stop.set()
        t.join()
    return r, sent


def test_answer_is_cut_after_the_pause_and_carrier_stripped():
    r, sent = _run(_fam(), [(-50, 0.4), (-25, 0.8), (-50, 3.0)])
    assert r['status'] == 'ok'
    assert r['text'] == '五十六。'
    assert 0.8 <= r['speech'] <= 1.4          # 0.2 pre + 0.8 speech + tail, not the 3 s of silence
    assert sent['bytes'] > 200


def test_silence_times_out():
    r, _ = _run(_fam(), [(-50, 4.0)], wait=2.0)
    assert r['status'] == 'silent'


def test_a_click_is_not_speech():
    r, _ = _run(_fam(), [(-50, 0.4), (-20, 0.04), (-50, 3.0)], wait=2.0)
    assert r['status'] == 'silent'


def test_busy_while_the_assistant_speaks():
    assert asyncio.run(_fam(state='speaking').listen('yue'))['status'] == 'busy'


def test_strip_carrier_variants():
    s = family.strip_carrier
    assert s('答案系七。', 'yue') == '七。'
    assert s('答案係 廿四', 'yue') == '廿四'
    assert s('答案是32。', 'zh') == '32。'
    assert s('The answer is fifty six.', 'en') == 'fifty six.'
    assert s('答案，系七。', 'yue') == '七。'      # 设备实测：识别器在垫话后加逗号
    assert s('五十六', 'yue') == '五十六'       # no carrier heard: keep everything


def test_strip_garbled_english_carrier():
    # 11-20 设备日志：垫话被识别糊了，孩子讲的 apple 没被认出来
    s = family.strip_carrier
    assert s('D answerous apple.', 'en') == 'apple.'
    assert s('Danceous apple.', 'en') == 'apple.'
    assert s('answers twelve', 'en') == 'twelve'
    assert s('ants', 'en') == 'ants'               # 单独一个词：是孩子的回答，不动
    assert s('Dancer', 'en') == 'Dancer'
    assert s('fifteen', 'en') == 'fifteen'


def _run_rec_wait(plan, silence=0.5, max_wait=3.0):
    f = _fam()
    f.rec = []
    stop = threading.Event()

    def feed():
        for db, sec in plan:
            for _ in range(int(sec / 0.02)):
                if stop.is_set():
                    return
                f.rec.append(_block(db))
                time.sleep(0.004)
    t = threading.Thread(target=feed, daemon=True)
    t.start()
    try:
        return asyncio.run(f.rec_wait(silence, max_wait))
    finally:
        stop.set()
        t.join()


def test_reading_ends_after_the_pause():
    assert _run_rec_wait([(-50, 0.3), (-25, 1.0), (-50, 3.0)]) == 'ended'


def test_reading_never_started_is_silent():
    assert _run_rec_wait([(-50, 6.0)], max_wait=1.0) == 'silent'


def test_rec_wait_without_recording():
    f = _fam()
    assert asyncio.run(f.rec_wait()) == 'stopped'
