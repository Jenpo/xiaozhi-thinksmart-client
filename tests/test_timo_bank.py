"""TIMO question bank (web/v2/timo_bank.js) and its figure crops stay consistent.

2026-11-20: an earlier 100-question bank copied one paper into another under fake question
numbers and described figures it never showed. These checks keep the rebuilt bank honest
without needing node on the device: every paper question is listed once, every figure it
names is on disk, and the spoken-answer matcher in app.js only accepts whole numbers.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V2 = ROOT / 'web' / 'v2'


def bank():
    return (V2 / 'timo_bank.js').read_text(encoding='utf-8')


def test_each_paper_question_appears_once():
    srcs = re.findall(r"src: '(TIMO-[^']+)'", bank())
    assert len(srcs) >= 90, len(srcs)
    dup = sorted({s for s in srcs if srcs.count(s) > 1})
    assert not dup, dup


def test_every_figure_named_by_the_bank_exists():
    figs = re.findall(r"fig: '(timo_fig/[^']+)'", bank())
    assert figs, 'figure questions should show the paper figure'
    missing = [f for f in figs if not (V2 / f).exists()]
    assert not missing, missing


def test_spoken_numbers_are_matched_whole_not_as_substrings():
    js = (V2 / 'app.js').read_text(encoding='utf-8')
    start = js.index('function timoMatchNumber(')
    body = js[start:js.index('\n}\n', start)]
    # the old matcher accepted "12" for 2 via indexOf on the heard text
    assert 'indexOf(want)' not in body
    assert 'nums[nums.length - 1]' in body
