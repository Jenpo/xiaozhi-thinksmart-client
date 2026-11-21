"""题库（2026-11-17）：模板现出的题之外，再存一批应用题/奥数题，可以随时增量更新。

  GET  /api/qbank                      {version, updated, count, items}
  POST /api/qbank/import {items, source} → {added, updated, rejected: [[题, 原因], ...], count, version}

每道题：
  {"id": "...", "grade": 1-6, "topic": "pattern", "olympiad": false,
   "zh": "普通话题面", "yue": "粤语题面（可缺）", "en": "English text",
   "answer": 12, "answer_expr": "(5+7)"}
answer 必须是数（整数或最多两位小数）：语音判题只认数。answer_expr 有的话按它算一遍，和 answer 对不上就拒收
（模型出的题靠这一步挡掉算错的）。存 ~/.local/share/thinksmart-client/qbank.json（临时文件 + rename）。
第一次没有文件时用随包的 qbank_seed.json。
"""
import ast
import hashlib
import json
import logging
import math
import operator
import pathlib
import time

from aiohttp import web

log = logging.getLogger(__name__)

PATH = pathlib.Path.home() / '.local' / 'share' / 'thinksmart-client' / 'qbank.json'
SEED = pathlib.Path(__file__).with_name('qbank_seed.json')
MAX_ITEMS = 3000
MAX_TEXT = 200

_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
        ast.USub: operator.neg, ast.UAdd: operator.pos}


def safe_eval(expr):
    """只算数字和 + - * / // % **（指数 ≤ 6）、括号；别的一律 ValueError。"""
    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            a, b = ev(n.left), ev(n.right)
            if isinstance(n.op, ast.Pow) and (abs(b) > 6 or abs(a) > 1000):
                raise ValueError('power too big')
            return _OPS[type(n.op)](a, b)
        if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.operand))
        raise ValueError('not plain arithmetic')
    expr = str(expr).replace('×', '*').replace('÷', '/').replace('−', '-')
    if len(expr) > 120:
        raise ValueError('expression too long')
    return ev(ast.parse(expr, mode='eval'))


def _num_ok(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and 0 <= x <= 100000 \
        and abs(x * 100 - round(x * 100)) < 1e-6


def normalize(item):
    """校验并整理一道题，返回新 dict；不合格 raise ValueError(原因)。"""
    if not isinstance(item, dict):
        raise ValueError('不是对象')
    texts = {}
    for k in ('zh', 'yue', 'en'):
        v = str(item.get(k) or '').strip()
        if len(v) > MAX_TEXT:
            raise ValueError(f'{k} 太长')
        if v:
            texts[k] = v
    if 'zh' not in texts or 'en' not in texts:
        raise ValueError('至少要有 zh 和 en 题面')
    ans = item.get('answer')
    if isinstance(ans, str):
        try:
            ans = float(ans)
        except ValueError:
            raise ValueError('answer 不是数') from None
    if not _num_ok(ans):
        raise ValueError('answer 要是 0–100000、最多两位小数的数')
    expr = item.get('answer_expr')
    if expr not in (None, ''):
        try:
            got = safe_eval(expr)
        except (ValueError, SyntaxError, ZeroDivisionError, OverflowError) as e:
            raise ValueError(f'answer_expr 算不了：{e}') from None
        if abs(got - ans) > 1e-6:
            raise ValueError(f'answer_expr 算出 {got:g}，和 answer {ans:g} 不一致')
    try:
        grade = int(item.get('grade'))
    except (TypeError, ValueError):
        raise ValueError('grade 要是 1–6') from None
    if not 1 <= grade <= 6:
        raise ValueError('grade 要是 1–6')
    ans = int(round(ans)) if abs(ans - round(ans)) < 1e-9 else round(float(ans), 2)
    qid = str(item.get('id') or '').strip()[:40] or hashlib.sha1(texts['zh'].encode()).hexdigest()[:12]
    out = {'id': qid, 'grade': grade, 'topic': str(item.get('topic') or '')[:30],
           'olympiad': bool(item.get('olympiad')), 'answer': ans, **texts}
    if expr not in (None, ''):
        out['answer_expr'] = str(expr)[:120]
    return out


class Bank:
    def __init__(self, path=PATH, seed=SEED):
        self.path, self.seed = pathlib.Path(path), pathlib.Path(seed)
        self.data = self._load()

    def _load(self):
        for p in (self.path, self.seed):
            try:
                d = json.loads(p.read_text())
                items = []
                for it in d.get('items', []):
                    try:
                        items.append(normalize(it))
                    except ValueError as e:
                        log.warning('qbank: dropped %s from %s: %s', it.get('id') if isinstance(it, dict) else it, p.name, e)
                return {'version': int(d.get('version') or 1), 'updated': d.get('updated') or '', 'items': items}
            except (OSError, ValueError) as e:
                if p == self.path and p.exists():
                    log.warning('qbank: %s unreadable: %s', p, e)
        return {'version': 0, 'updated': '', 'items': []}

    def view(self):
        return {'version': self.data['version'], 'updated': self.data['updated'],
                'count': len(self.data['items']), 'items': self.data['items']}

    def import_items(self, items, source=''):
        if not isinstance(items, list):
            raise ValueError('items 要是列表')
        by_id = {it['id']: it for it in self.data['items']}
        by_text = {it['zh']: it['id'] for it in self.data['items']}
        added = updated = 0
        rejected = []
        for raw in items[:500]:
            try:
                it = normalize(raw)
            except ValueError as e:
                rejected.append([str((raw or {}).get('zh') if isinstance(raw, dict) else raw)[:60], str(e)])
                continue
            if it['id'] not in by_id and it['zh'] in by_text:      # 同一道题换了 id：当更新
                it['id'] = by_text[it['zh']]
            if source:
                it['source'] = str(source)[:40]
            if it['id'] in by_id:
                updated += 1
            else:
                added += 1
            by_id[it['id']] = it
            by_text[it['zh']] = it['id']
        if added or updated:
            items = list(by_id.values())[-MAX_ITEMS:]
            self.data = {'version': self.data['version'] + 1,
                         'updated': time.strftime('%Y-%m-%d %H:%M:%S'), 'items': items}
            self._save()
        log.info('qbank import from %s: +%d, ~%d, rejected %d, now %d', source or '?', added, updated,
                 len(rejected), len(self.data['items']))
        return {'added': added, 'updated': updated, 'rejected': rejected,
                'count': len(self.data['items']), 'version': self.data['version']}

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix('.tmp')
        with open(tmp, 'w') as f:
            json.dump(self.data, f, ensure_ascii=False, indent=1)
            f.flush()
            try:
                import os
                os.fsync(f.fileno())
            except OSError:
                pass
        tmp.replace(self.path)


def install(_client=None, bank=None):
    bank = bank or Bank()

    async def get(_r):
        return web.json_response({'ok': True, **bank.view()})

    async def imp(request):
        try:
            b = await request.json()
        except ValueError:
            return web.json_response({'ok': False, 'error': 'JSON 格式错误'}, status=400)
        try:
            return web.json_response({'ok': True, **bank.import_items((b or {}).get('items'), (b or {}).get('source', ''))})
        except ValueError as e:
            return web.json_response({'ok': False, 'error': str(e)}, status=400)

    return [('/api/qbank', get), ('/api/qbank/import', imp)]
