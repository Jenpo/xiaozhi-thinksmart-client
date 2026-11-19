"""题库：校验、算式复算、导入合并（不需要设备）。

Run: python -m pytest tests/test_qbank.py
"""
import json

import pytest

from thinksmart_client import qbank


def _item(**kw):
    it = {'grade': 2, 'topic': 't', 'zh': '每盒 6 支笔，4 盒几支？', 'en': '6 pens a box, 4 boxes?', 'answer': 24, 'answer_expr': '6*4'}
    it.update(kw)
    return it


def test_safe_eval_only_arithmetic():
    assert qbank.safe_eval('(28-2*10)/2') == 4
    assert qbank.safe_eval('3×4÷2') == 6
    for bad in ('__import__("os")', 'a+1', '2**100', 'open("x")'):
        with pytest.raises((ValueError, SyntaxError)):
            qbank.safe_eval(bad)


def test_normalize_rejects_wrong_or_unspeakable_answers():
    assert qbank.normalize(_item())['answer'] == 24
    with pytest.raises(ValueError, match='不一致'):
        qbank.normalize(_item(answer=25))
    with pytest.raises(ValueError):
        qbank.normalize(_item(answer=1 / 3, answer_expr='1/3'))       # 不是两位以内小数
    with pytest.raises(ValueError):
        qbank.normalize(_item(en=''))
    with pytest.raises(ValueError):
        qbank.normalize(_item(grade=9))
    assert qbank.normalize(_item(answer='2.5', answer_expr='5/2'))['answer'] == 2.5


def test_import_merges_and_persists(tmp_path):
    seed = tmp_path / 'seed.json'
    seed.write_text(json.dumps({'version': 1, 'items': [_item(id='a')]}, ensure_ascii=False))
    b = qbank.Bank(tmp_path / 'bank.json', seed)
    assert b.view()['count'] == 1
    r = b.import_items([_item(zh='新题 1+1？', en='1+1?', answer=2, answer_expr='1+1'), _item(answer=99), 'junk'], 'test')
    assert (r['added'], len(r['rejected']), r['count'], r['version']) == (1, 2, 2, 2)
    r = b.import_items([_item(id='other', en='changed')])          # 同一题面换 id：算更新
    assert (r['added'], r['updated'], r['count']) == (0, 1, 2)
    again = qbank.Bank(tmp_path / 'bank.json', seed)                # 存盘后重读
    assert again.view()['count'] == 2 and again.view()['version'] == 3


def test_seed_is_valid():
    d = json.loads(qbank.SEED.read_text())
    assert len(d['items']) >= 30
    for it in d['items']:
        qbank.normalize(it)
