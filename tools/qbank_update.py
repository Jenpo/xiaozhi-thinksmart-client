#!/usr/bin/env python3
"""题库更新（2026-11-17）：让大模型出一批新题（一至六年级应用题 + 一年级/低年级奥数，普通话/粤语/英文三种题面），
两道关卡挡掉错题，再导入客户端题库（POST /api/qbank/import）。

  关卡 1：每题要带 answer_expr（纯算式），客户端导入时按算式重算，和 answer 对不上拒收。
  关卡 2：把题面（不带答案）再交给模型独立解一遍，答案不一致的不要。

用法（设备上，系统 python3，要 PyYAML）：
  python3 tools/qbank_update.py                 # 出 20 道，导入
  python3 tools/qbank_update.py --count 30 --dry-run
模型和密钥沿用 hub 的配置（data/.config.yaml 里 selected_module.LLM 那一段），不另存密钥。
每周跑一次：deploy/thinksmart-qbank.timer（用户级 systemd）。
"""
import argparse
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request

HUB_CONFIG = pathlib.Path.home() / 'xiaozhi-hub-server/main/xiaozhi-server/data/.config.yaml'
CLIENT = 'http://127.0.0.1:8090'

GEN_PROMPT = """你是小学数学出题老师。出 {n} 道新题，给小朋友做，用嘴回答，所以答案必须是一个数（整数，或最多两位小数），不能是分数、单位或文字。
分布：一年级 {g1} 道、二年级 {g2} 道、三四年级 {g34} 道、五六年级 {g56} 道；其中大约三分之一是奥数思维题（找规律、排队、植树、年龄、鸡兔同笼、握手、钱币、简单逻辑），奥数题主要放在一二年级。
每道题三种题面：zh 普通话简体；yue 地道粤语口语（用「幾多」「係」「俾」「咗」等，繁体）；en 简单英文。题面要短（一两句、念出来 10 秒内），数字用阿拉伯数字，不要出现答案。
answer_expr 写只含数字和 + - * / ( ) 的算式，算出来就是答案。
不要和这些已有题目重复或只改数字：
{existing}
只输出 JSON：{{"items":[{{"grade":1,"topic":"pattern","olympiad":true,"zh":"...","yue":"...","en":"...","answer":16,"answer_expr":"11+5"}}]}}"""

CHECK_PROMPT = """逐题解答下面的小学数学题，只要最后的数字答案（整数或小数，不带单位）。
只输出 JSON：{{"answers":[数字, ...]}}，顺序和题目一致，共 {n} 个。
{questions}"""


def llm_config(path):
    import yaml
    cfg = yaml.safe_load(pathlib.Path(path).read_text())
    name = (cfg.get('selected_module') or {}).get('LLM')
    c = (cfg.get('LLM') or {}).get(name) or {}
    if not c.get('base_url') or not c.get('model_name'):
        raise SystemExit(f'LLM {name!r} 没有 base_url/model_name')
    return c


def chat(c, prompt, max_tokens=6000, temperature=0.7, timeout=240):
    body = {'model': c['model_name'], 'messages': [{'role': 'user', 'content': prompt}],
            'max_tokens': max_tokens, 'temperature': temperature, 'stream': False}
    body.update(c.get('extra_body') or {})
    headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + str(c.get('api_key') or ''),
               'User-Agent': 'xiaozhi-hub/qbank'}           # Python-urllib 的 UA 会被 Cloudflare 1010 拦
    headers.update({k: str(v) for k, v in (c.get('headers') or {}).items()})
    req = urllib.request.Request(c['base_url'].rstrip('/') + '/chat/completions', data=json.dumps(body).encode(),
                                 headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read())
    return d['choices'][0]['message']['content']


def parse_json(text):
    text = re.sub(r'^```(?:json)?|```$', '', text.strip(), flags=re.M).strip()
    i, j = text.find('{'), text.rfind('}')
    return json.loads(text[i:j + 1])


def http(method, path, body=None):
    req = urllib.request.Request(CLIENT + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--count', type=int, default=20)
    ap.add_argument('--config', default=str(HUB_CONFIG))
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    n = max(4, min(40, a.count))
    c = llm_config(a.config)
    bank = http('GET', '/api/qbank')
    existing = '\n'.join('- ' + it['zh'] for it in bank.get('items', [])[-60:]) or '（暂无）'
    g1 = max(1, round(n * .3)); g2 = max(1, round(n * .25)); g34 = max(1, round(n * .25)); g56 = n - g1 - g2 - g34
    items = parse_json(chat(c, GEN_PROMPT.format(n=n, g1=g1, g2=g2, g34=g34, g56=g56, existing=existing))).get('items', [])
    print(f'generated {len(items)}')
    items = [it for it in items if isinstance(it, dict) and it.get('zh')]
    if not items:
        raise SystemExit('模型没出题')
    qs = '\n'.join(f'{i + 1}. {it["zh"]}' for i, it in enumerate(items))
    try:
        answers = parse_json(chat(c, CHECK_PROMPT.format(n=len(items), questions=qs), max_tokens=2000, temperature=0)).get('answers', [])
    except (ValueError, KeyError, urllib.error.URLError) as e:
        raise SystemExit(f'复核失败，不导入：{e}')
    keep, dropped = [], []
    for it, got in zip(items, answers + [None] * len(items)):
        try:
            ok = got is not None and abs(float(got) - float(it.get('answer'))) < 1e-6
        except (TypeError, ValueError):
            ok = False
        (keep if ok else dropped).append((it, got))
    for it, got in dropped:
        print(f'  复核不一致，丢掉：{it.get("zh")}  出题答案 {it.get("answer")}  复核 {got}')
    keep = [dict(it, id=None) for it, _ in keep]
    print(f'pass check {len(keep)} / {len(items)}')
    if a.dry_run:
        for it in keep:
            print(f'  [{it.get("grade")}{" 奥" if it.get("olympiad") else ""}] {it.get("zh")} = {it.get("answer")}  | {it.get("en")}')
        return
    r = http('POST', '/api/qbank/import', {'items': keep, 'source': 'llm-' + c['model_name']})
    for q, why in r.get('rejected', []):
        print(f'  导入拒收：{q}  {why}')
    print(f'imported +{r.get("added")} ~{r.get("updated")}, bank now {r.get("count")} (v{r.get("version")})')


if __name__ == '__main__':
    sys.exit(main())
