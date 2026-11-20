"""家庭与学习小功能（2026-11-15，owner「1-10 全部」）：屏幕和语音两头都能用，状态都在设备上。

  看电视限时  POST /api/tv-timer {minutes, language} / {cancel: true}
              到点前 5 分钟提醒一次，到点念「时间到」并关电视（经 hub 的 /kiosk/devices/set，同家电面板）。
  家庭留言    POST /api/notes/add {text, language, from?}   POST /api/notes/done {id}
              留言挂在主屏横幅上，点 🔊 念、点「知道了」收起；新留言来时念一遍。
  作息清单    POST /api/routine/set {list: morning|evening, items: [...]}
              POST /api/routine/tick {list, index, done}     勾选按天清零。
  睡前故事    POST /api/bedtime {minutes}  N 分钟后屏幕调暗关掉（故事本身由大模型讲）。
  hub 推屏幕  POST /api/ui {event: card|study|say, data}    （hub 插件 family_tools 用）
  朗读录音    POST /api/rec/start  POST /api/rec/stop → {text}  麦克风原样录下，切成 ≤9 s 交 hub 本机识别。
  全部状态    GET  /api/family
  星星积分    POST /api/stars/add {stars, why?, round?: {mode, level, right, total, seconds}}   每天另记「今天」，round 留最近 30 轮
  做题现场    POST /api/study/state {active, mode, n, total, right, streak, ans, opts, lang}（页面推）
              GET  /api/study/state → {quiz, stars}（hub studyFastPath 读：在做题就把口说的答案转回页面）
  等答案开麦  POST /api/study/listen {seconds}   POST /api/study/quiet   （页面念完题开麦 / 念讲解前收麦）
  点屏幕      POST /api/study/touch（页面每 3 s 最多一次）：刚点过就不提醒「没说话」，hub 也不说告别语

说话都交给页面（事件 say → /api/hw/tts，粤语/英文/普通话各用各的声音），和看作业的朗读同一套。
状态存 ~/.local/share/thinksmart-client/family.json（临时文件 + rename，防断电写坏）。
"""
import asyncio
import datetime
import json
import logging
import os
import pathlib
import re
import time
import uuid

import numpy as np
from aiohttp import web

log = logging.getLogger(__name__)

STATE = pathlib.Path.home() / '.local' / 'share' / 'thinksmart-client' / 'family.json'
TV_ENTITY = 'media_player.bravia_xr_55x90j'
TV_WARN = 300                # 到点前 5 分钟提醒
TV_MAX_MIN = 240
MAX_NOTES = 20
MAX_ROUTINE = 15
REC_MAX = 120                # 朗读最多录 2 分钟
REC_CHUNK = 9.0              # hub /kiosk/asr 一次最多 10 s
UI_EVENTS = ('card', 'study', 'say', 'study_answer')
MAX_ROUNDS = 30
QUIZ_STALE = 600            # 页面 10 分钟没推做题现场：当作没在做
# 语音答题（口算闪卡等，2026-11-17）：页面念完题后 POST /api/listen，这里录一句、自动断句、交 hub 识别。
# 不经大模型：语音回合首句 p50 3 s，每题等 3 s 节奏全断；hub /kiosk/asr 一句 ~0.4-0.9 s。
LISTEN_WAIT = 7.0            # 念完题后等开口
LISTEN_MAX = 6.0             # 一句最长
LISTEN_END = 0.5             # 说完后静这么久算答完（设备实测：答完到判定 ≈ 这个 + hub 识别 1.1-1.4 s）
LISTEN_PRE = 0.2             # 开口前多留一点，第一个字不被切
# 单个短音节（七、九、一百）hub 识别常错成「3」「じ」「一把」：前面垫一句同语言的「答案係」锁住语种，
# TTS 实测 12/12 全对（不垫 9/12）。识别完再把垫话剥掉。
CARRIER = {'yue': '答案係', 'zh': '答案是', 'en': 'The answer is'}
LISTS = ('morning', 'evening')
DEFAULT_ROUTINE = {'morning': ['刷牙洗脸', '吃早餐', '执好书包'], 'evening': ['做功课', '冲凉', '执好听日嘅书包']}

SAY = {
    'tv_set': {'yue': '好，电视可以睇多{m}分钟，差五分钟我会提你', 'en': 'OK, {m} more minutes of TV. I will remind you five minutes before',
               'zh': '好，电视还能看{m}分钟，差五分钟我会提醒你'},
    'tv_warn': {'yue': '仲有五分钟就要熄电视喇', 'en': 'Five more minutes of TV', 'zh': '还有五分钟就要关电视了'},
    'tv_end': {'yue': '时间到喇，电视熄咗，休息下眼', 'en': 'Time is up. The TV is off now. Rest your eyes',
               'zh': '时间到了，电视关了，休息一下眼睛'},
    'note': {'yue': '有留言：{t}', 'en': 'A message for you: {t}', 'zh': '有留言：{t}'},
    'night': {'yue': '晚安，好好瞓', 'en': 'Good night, sleep well', 'zh': '晚安，好好睡'},
}


def _lang(x):
    return x if x in ('yue', 'en', 'zh') else 'yue'


def _today():
    return datetime.date.today().isoformat()


class Family:
    def __init__(self, client):
        self.client = client
        self.state = {'notes': [], 'routine': {k: {'items': list(v), 'done': [], 'date': ''} for k, v in DEFAULT_ROUTINE.items()},
                      'tv': None, 'bedtime': None,
                      'stars': {'total': 0, 'today': 0, 'date': '', 'best_streak': 0, 'rounds': []}}
        self.quiz = None             # 页面推来的做题现场（只在内存，重启就没了）
        self.rec = None              # 录音中：[float32 块...]
        self.rec_started = 0.0
        self.lis = None              # 语音答题在听：[float32 块...]
        self.lis_gen = 0             # 每次 listen/cancel 加一，旧的那次自己退出
        self.carriers = {}           # lang -> int16 PCM（含尾部 0.15 s 静音）
        self._load()

    # ---- 存取 ----

    def _load(self):
        try:
            data = json.loads(STATE.read_text())
        except (OSError, ValueError):
            return
        if isinstance(data, dict):
            for k in self.state:
                if k in data:
                    self.state[k] = data[k]

    def _save(self):
        try:
            STATE.parent.mkdir(parents=True, exist_ok=True)
            tmp = STATE.with_suffix('.tmp')
            with open(tmp, 'w') as f:
                json.dump(self.state, f, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, STATE)
        except OSError as e:
            log.warning('family state not saved: %s', e)

    # ---- 星星积分（2026-11-19 owner「对小朋友鼓励，有小星星什么的积分」）----

    def _stars(self):
        st = self.state.get('stars')
        if not isinstance(st, dict):
            st = self.state['stars'] = {}
        for k, v in (('total', 0), ('today', 0), ('date', ''), ('best_streak', 0), ('rounds', [])):
            st.setdefault(k, v)
        if st['date'] != _today():
            st['date'], st['today'] = _today(), 0
        return st

    def stars_add(self, n, why='', round_=None, streak=0):
        n = int(n)
        if not 0 <= n <= 20:
            raise ValueError('一次加 0-20 颗星')
        st = self._stars()
        st['total'] += n
        st['today'] += n
        if int(streak or 0) > st['best_streak']:
            st['best_streak'] = int(streak)
        if isinstance(round_, dict):
            r = {k: round_.get(k) for k in ('mode', 'level', 'right', 'total', 'seconds', 'stars')}
            r['at'] = int(time.time())
            st['rounds'] = (st['rounds'] + [r])[-MAX_ROUNDS:]
        self._save()
        self.publish()
        return self.stars_view()

    def stars_view(self):
        st = self._stars()
        today = [r for r in st['rounds'] if datetime.date.fromtimestamp(r.get('at', 0)).isoformat() == _today()]
        return {'total': st['total'], 'today': st['today'], 'best_streak': st['best_streak'],
                'last_round': st['rounds'][-1] if st['rounds'] else None,
                'today_rounds': len(today), 'today_right': sum(int(r.get('right') or 0) for r in today),
                'today_questions': sum(int(r.get('total') or 0) for r in today)}

    def quiz_view(self):
        q = self.quiz
        if not q or time.time() - q.get('at', 0) > QUIZ_STALE:
            return None
        return q

    def view(self):
        self._roll_routine()
        tv = self.state['tv']
        return {'notes': self.state['notes'], 'routine': self.state['routine'],
                'tv': tv and {'end': tv['end'], 'left': max(0, int(tv['end'] - time.time())), 'language': tv.get('language')},
                'bedtime': self.state['bedtime'], 'recording': self.rec is not None, 'stars': self.stars_view()}

    def publish(self):
        self.client.events.publish('family', self.view())

    def say(self, text, language='yue'):
        """页面念（/api/hw/tts 按语言选声音），同时弹一条提示。"""
        self.client.events.publish('say', {'text': text, 'language': _lang(language)})

    # ---- 看电视限时 ----

    def tv_set(self, minutes, language='yue'):
        m = int(minutes)
        if not 1 <= m <= TV_MAX_MIN:
            raise ValueError('分钟数要在 1 到 %d 之间' % TV_MAX_MIN)
        self.state['tv'] = {'end': time.time() + m * 60, 'warned': m * 60 <= TV_WARN, 'language': _lang(language)}
        self._save()
        self.publish()
        return SAY['tv_set'][_lang(language)].format(m=m)

    def tv_cancel(self):
        had = self.state['tv'] is not None
        self.state['tv'] = None
        self._save()
        self.publish()
        return had

    async def _tick_tv(self, now):
        tv = self.state['tv']
        if not tv:
            return
        lang = tv.get('language') or 'yue'
        if not tv.get('warned') and now >= tv['end'] - TV_WARN:
            tv['warned'] = True
            self._save()
            self.say(SAY['tv_warn'][lang], lang)
            self.publish()
        if now >= tv['end']:
            self.state['tv'] = None
            self._save()
            entity = self.client.cfg.get('tv_entity') or TV_ENTITY
            result = await self.client.set_device(entity, 'turn_off')
            if not result.get('ok'):
                log.warning('tv timer: turning the TV off failed: %s', result.get('error'))
            self.say(SAY['tv_end'][lang], lang)
            self.publish()

    # ---- 留言 ----

    def note_add(self, text, language='yue', sender=''):
        text = str(text or '').strip()[:200]
        if not text:
            raise ValueError('留言是空的')
        note = {'id': uuid.uuid4().hex[:8], 'text': text, 'language': _lang(language),
                'from': str(sender or '')[:20], 'at': time.strftime('%m-%d %H:%M')}
        self.state['notes'] = ([note] + self.state['notes'])[:MAX_NOTES]
        self._save()
        self.publish()
        self.say(SAY['note'][note['language']].format(t=text), note['language'])
        return note

    def note_done(self, note_id):
        before = len(self.state['notes'])
        self.state['notes'] = [n for n in self.state['notes'] if n['id'] != note_id]
        self._save()
        self.publish()
        return len(self.state['notes']) != before

    # ---- 作息清单 ----

    def _roll_routine(self):
        today = _today()
        for k in LISTS:
            r = self.state['routine'].setdefault(k, {'items': [], 'done': [], 'date': today})
            if r.get('date') != today:
                r['date'], r['done'] = today, []

    def routine_set(self, which, items):
        if which not in LISTS:
            raise ValueError('清单只有 morning（早上）和 evening（晚上）')
        items = [str(i).strip()[:30] for i in items if str(i).strip()][:MAX_ROUTINE]
        self._roll_routine()
        self.state['routine'][which] = {'items': items, 'done': [], 'date': _today()}
        self._save()
        self.publish()
        return items

    def routine_tick(self, which, index, done):
        self._roll_routine()
        r = self.state['routine'].get(which)
        if not r or not 0 <= int(index) < len(r['items']):
            raise ValueError('没有这一项')
        d = set(r['done'])
        (d.add if done else d.discard)(int(index))
        r['done'] = sorted(d)
        self._save()
        self.publish()
        return r

    # ---- 睡前故事 ----

    def bedtime(self, minutes):
        m = max(1, min(60, int(minutes or 15)))
        self.state['bedtime'] = {'at': time.time() + m * 60}
        self._save()
        self.publish()
        return m

    async def _tick_bedtime(self, now):
        b = self.state['bedtime']
        if not b or now < b['at']:
            return
        self.state['bedtime'] = None
        self._save()
        try:
            await self.client.set_brightness(5)
        except Exception as e:
            log.warning('bedtime: dimming failed: %s', e)
        self.publish()

    # ---- 朗读录音 ----

    def on_block(self, block):
        """麦克风线程每 20 ms 调一次（app._on_block）。"""
        rec = self.rec
        if rec is not None and time.monotonic() - self.rec_started < REC_MAX:
            rec.append(np.array(block, dtype=np.float32).reshape(-1))
        lis = self.lis
        if lis is not None:
            lis.append(np.array(block, dtype=np.float32).reshape(-1))

    def rec_start(self):
        self.rec = []
        self.rec_started = time.monotonic()
        self.publish()

    async def rec_stop(self):
        blocks, self.rec = self.rec, None
        self.publish()
        if not blocks:
            return '', 0.0
        audio = np.concatenate(blocks)
        pcm = (np.clip(audio, -1, 1) * 32767).astype('<i2')
        texts = []
        for chunk in _split(pcm, 16000):
            try:
                texts.append(await self._asr(chunk.tobytes()))
            except Exception as e:
                log.warning('reading check: recognition failed: %s', e)
        return ''.join(t for t in texts if t), len(pcm) / 16000

    async def rec_wait(self, silence=2.5, max_wait=REC_MAX):
        """朗读检查自动收尾：读过一阵之后静了 silence 秒就返回 ended（页面再调 rec_stop）。
        返回 ended | timeout | stopped（录音已被停掉）| silent（一直没出声，max_wait 到）。"""
        rec = self.rec
        if rec is None:
            return 'stopped'
        lvl, spoke, t0 = [], 0, time.monotonic()
        while True:
            await asyncio.sleep(0.1)
            if self.rec is not rec:
                return 'stopped'
            for b in rec[len(lvl):]:
                lvl.append(20 * np.log10(float(np.sqrt(np.mean(b * b))) + 1e-9))
            if not lvl:
                if time.monotonic() - t0 > 3:
                    return 'stopped'
                continue
            bs = len(rec[0]) / 16000
            floor = min(float(np.percentile(lvl[:max(5, min(len(lvl), 15))], 30)), -44.0)
            on, off = max(floor + 10, -42.0), max(floor + 6, -46.0)
            spoke = spoke or sum(1 for v in lvl[-50:] if v >= on) >= 10      # 有过 0.2 s 以上的人声
            quiet = 0
            for v in reversed(lvl):
                if v >= off:
                    break
                quiet += 1
            if spoke and quiet * bs >= silence:
                return 'ended'
            if time.monotonic() - t0 > max_wait:
                return 'timeout' if spoke else 'silent'

    async def _asr(self, pcm_bytes):
        import aiohttp
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as s:
            async with s.post(self.client.cfg['hub_http'] + '/kiosk/asr', data=pcm_bytes) as r:
                d = await r.json(content_type=None)
        return (d.get('text') or '').strip()

    # ---- 语音答题 ----

    async def quiz_prepare(self, wait=12.0):
        """开始语音答题前：等小麦把这句（「好，口算开始」）讲完，再结束对话。不结束的话孩子答的数字
        会被 hub 当成新问题交给大模型（2026-11-17 11:59：模型回「屏幕上的题在做吗？」）。"""
        c = self.client
        t = time.monotonic()
        while c.state in ('thinking', 'speaking') and time.monotonic() - t < wait:
            await asyncio.sleep(0.1)
        if c.hub.connected or c.uploading:
            await c.end()
        return c.state

    def listen_cancel(self):
        self.lis_gen += 1
        self.lis = None

    async def listen(self, lang, wait=LISTEN_WAIT):
        """录孩子的一句回答：等开口（最多 wait 秒）、说完静 LISTEN_END 秒收尾，交 hub 识别。
        返回 {'status': ok|silent|busy|cancelled|error, 'text', 'raw', 'speech', 'asr_ms'}。"""
        c = self.client
        if c.uploading or c.state in ('thinking', 'speaking'):
            return {'status': 'busy'}
        self.lis_gen += 1
        gen = self.lis_gen
        self.lis = buf = []
        blocks = []                    # 已经看过的块
        lvl = []                       # 每块 dBFS
        start = end = None
        quiet = 0
        t0 = time.monotonic()
        try:
            while True:
                await asyncio.sleep(0.04)
                if gen != self.lis_gen:
                    return {'status': 'cancelled'}
                if c.uploading:        # 孩子叫了「小麦小麦」：让给对话
                    return {'status': 'busy'}
                while len(blocks) < len(buf):
                    b = buf[len(blocks)]
                    blocks.append(b)
                    lvl.append(20 * np.log10(float(np.sqrt(np.mean(b * b))) + 1e-9))
                if not blocks:
                    if time.monotonic() - t0 > 2:
                        return {'status': 'error', 'error': '麦克风没有声音'}
                    continue
                bs = len(blocks[0]) / 16000                    # 一块多少秒（20 ms）
                # 底噪取开头 0.3 s 的偏低值；封顶 -44：孩子一念完就抢答时开头已经是人声，门限不能跟着抬上去
                floor = min(float(np.percentile(lvl[:max(5, min(len(lvl), 15))], 30)), -44.0)
                on, off = max(floor + 10, -42.0), max(floor + 6, -46.0)
                if start is None:
                    run = 0
                    for i in range(max(0, len(lvl) - 3), len(lvl)):
                        run = run + 1 if lvl[i] >= on else 0
                    if run >= 3 and len(lvl) > 5:
                        start = len(lvl) - 3
                    elif len(lvl) * bs > wait:
                        return {'status': 'silent'}
                    continue
                quiet = 0
                for i in range(len(lvl) - 1, start, -1):
                    if lvl[i] >= off:
                        break
                    quiet += 1
                if quiet * bs >= LISTEN_END or (len(lvl) - start) * bs >= LISTEN_MAX:
                    end = len(lvl) - quiet + int(0.15 / bs)
                    break
        finally:
            if gen == self.lis_gen:
                self.lis = None
        pre = int(LISTEN_PRE / bs)
        audio = np.concatenate(blocks[max(0, start - pre):end])
        pcm = (np.clip(audio, -1, 1) * 32767).astype('<i2')
        lang = _lang(lang)
        carrier = await self._carrier(lang)
        t1 = time.monotonic()
        try:
            raw = await self._asr(carrier + pcm.tobytes())
        except Exception as e:
            log.warning('quiz: recognition failed: %s', e)
            return {'status': 'error', 'error': '识别失败'}
        asr_ms = round((time.monotonic() - t1) * 1000)
        text = strip_carrier(raw, lang) if carrier else raw
        if gen != self.lis_gen:        # 识别途中被取消（孩子按了键盘、关了面板）
            return {'status': 'cancelled'}
        log.info('quiz heard %.1f s (waited %.1f s), asr %d ms: %r -> %r',
                 len(pcm) / 16000, start * bs, asr_ms, raw, text)
        return {'status': 'ok', 'text': text, 'raw': raw, 'speech': round(len(pcm) / 16000, 2), 'asr_ms': asr_ms}

    async def _carrier(self, lang):
        """「答案係」的 PCM（hub 同一个 TTS 合成，ffmpeg 解码，掐头去尾）。失败就不垫，返回 b''。"""
        if lang in self.carriers:
            return self.carriers[lang]
        import urllib.parse
        import aiohttp
        pcm = b''
        try:
            url = self.client.cfg['hub_http'] + '/kiosk/hw/tts?' + urllib.parse.urlencode(
                {'text': CARRIER[lang], 'lang': lang})
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as s:
                async with s.get(url) as r:
                    mp3 = await r.read() if r.status == 200 else b''
            if mp3:
                p = await asyncio.create_subprocess_exec(
                    'ffmpeg', '-loglevel', 'quiet', '-i', '-', '-ac', '1', '-ar', '16000', '-f', 's16le', '-',
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
                out, _ = await p.communicate(mp3)
                a = np.frombuffer(out, dtype='<i2')
                loud = np.nonzero(np.abs(a) > 300)[0]
                if len(loud):
                    a = a[max(0, loud[0] - 1600):loud[-1] + 1600]
                    pcm = a.tobytes() + bytes(int(0.15 * 16000) * 2)
        except Exception as e:
            log.warning('quiz: no carrier for %s: %s', lang, e)
        if pcm:                        # 失败不缓存，下次再试
            self.carriers[lang] = pcm
        return pcm

    # ---- 循环 ----

    async def loop(self):
        while True:
            try:
                now = time.time()
                await self._tick_tv(now)
                await self._tick_bedtime(now)
            except Exception:
                log.exception('family loop')
            await asyncio.sleep(2)


_CARRIER_RX = {
    'yue': re.compile(r'^\s*[答达搭]?[案按岸暗]?[，,。、\s]*[系係是喺啊]?[，,。、\s]*'),
    'zh': re.compile(r'^\s*[答达搭]?[案按岸暗]?[，,。、\s]*[是事试市系]?[，,。、\s]*'),
    'en': re.compile(r'^\s*(the\s+)?answers?\s*(is|was|\'s)?[\s,.]*', re.I),
}


def strip_carrier(text, lang):
    """去掉识别结果开头的垫话「答案係」（识别器可能写成「答案系」「答按是」），剩下孩子说的。"""
    text = (text or '').strip()
    rx = _CARRIER_RX.get(lang, _CARRIER_RX['yue'])
    m = rx.match(text)
    if m and m.end() >= 2:
        return text[m.end():].strip()
    if lang == 'en':
        # 垫话被识别糊了：'D answerous apple.'、'Danceous apple.'（11-20 09:20/09:26，孩子讲的是 apple，被判没听清）。
        # 只在后面还有词时去掉开头这一个糊掉的词，孩子单独答「ants」之类不动
        m = _CARRIER_EN_FUZZY.match(text)
        if m and text[m.end():].strip(' ,.'):
            return text[m.end():].strip(' ,')
    return text


_CARRIER_EN_FUZZY = re.compile(r'^\s*(?:the|d|da|de|th)?\s*a?n\w*s\w*\b(?:\s+(?:is|was))?[\s,.]+', re.I)


def _split(pcm, rate, chunk=REC_CHUNK):
    """切成 ≤chunk 秒的段，切点挑每段最后 2 秒里最安静的 20 ms，少切断字。"""
    n, step, out, i = len(pcm), int(chunk * rate), [], 0
    blk = rate // 50
    while n - i > step:
        lo, hi = i + step - 2 * rate, i + step
        seg = pcm[lo:hi].astype(np.float32)
        k = len(seg) // blk
        energy = (seg[:k * blk].reshape(k, blk) ** 2).mean(axis=1)
        cut = lo + int(energy.argmin()) * blk + blk // 2
        out.append(pcm[i:cut])
        i = cut
    if n - i > rate // 5:
        out.append(pcm[i:])
    return out


def install(client):
    fam = Family(client)
    client.family = fam
    asyncio.get_event_loop().create_task(fam.loop())

    def ok(**data):
        return web.json_response({'ok': True, **data})

    def bad(msg, status=400):
        return web.json_response({'ok': False, 'error': msg}, status=status)

    async def body_of(request):
        try:
            b = await request.json()
            return b if isinstance(b, dict) else {}
        except ValueError:
            return {}

    async def get_all(_r):
        return ok(**fam.view())

    async def ui(request):
        b = await body_of(request)
        ev = b.get('event')
        if ev not in UI_EVENTS or not isinstance(b.get('data'), dict):
            return bad('event 只能是 %s，data 要是对象' % '/'.join(UI_EVENTS))
        client.events.publish(ev, b['data'])
        if ev == 'study_answer' and hasattr(client, 'study_answered'):
            client.study_answered()
        return ok()

    async def tv_timer(request):
        b = await body_of(request)
        if b.get('cancel'):
            return ok(cancelled=fam.tv_cancel())
        try:
            return ok(say=fam.tv_set(b.get('minutes'), b.get('language')), **fam.view())
        except (TypeError, ValueError) as e:
            return bad(str(e))

    async def note_add(request):
        b = await body_of(request)
        try:
            return ok(note=fam.note_add(b.get('text'), b.get('language'), b.get('from')))
        except ValueError as e:
            return bad(str(e))

    async def note_done(request):
        b = await body_of(request)
        return ok(removed=fam.note_done(str(b.get('id') or '')))

    async def routine_set(request):
        b = await body_of(request)
        items = b.get('items') if isinstance(b.get('items'), list) else None
        if items is None:
            return bad('items 要是列表')
        try:
            return ok(items=fam.routine_set(b.get('list'), items))
        except ValueError as e:
            return bad(str(e))

    async def routine_tick(request):
        b = await body_of(request)
        try:
            return ok(routine=fam.routine_tick(b.get('list'), int(b.get('index')), bool(b.get('done'))))
        except (TypeError, ValueError) as e:
            return bad(str(e))

    async def bedtime(request):
        b = await body_of(request)
        try:
            return ok(minutes=fam.bedtime(b.get('minutes')))
        except (TypeError, ValueError) as e:
            return bad(str(e))

    async def stars_add(request):
        b = await body_of(request)
        try:
            return ok(stars=fam.stars_add(b.get('stars', 0), b.get('why', ''), b.get('round'), b.get('streak', 0)))
        except (TypeError, ValueError) as e:
            return bad(str(e))

    async def study_state(request):
        if request.method == 'GET':
            return ok(quiz=fam.quiz_view(), stars=fam.stars_view(),
                      touch_age=round(time.time() - getattr(client, 'touch_at', 0), 1))
        b = await body_of(request)
        keep = ('active', 'mode', 'level', 'n', 'total', 'right', 'streak', 'ans', 'opts', 'lang', 'question', 'speaking',
                'kind', 'sec', 'reveal')
        fam.quiz = {k: b.get(k) for k in keep} if b.get('active') else None
        if fam.quiz:
            fam.quiz['at'] = time.time()
        return ok()

    async def study_listen(request):
        b = await body_of(request)
        try:
            seconds = float(b.get('seconds') or 12)
        except (TypeError, ValueError):
            seconds = 12
        return ok(listening=await client.listen_answer(seconds))

    async def study_touch(_r):
        client.touch_at = time.time()
        return ok()

    async def study_quiet(_r):
        return ok(stopped=await client.listen_quiet_stop())

    async def rec_start(_r):
        fam.rec_start()
        return ok()

    async def rec_stop(_r):
        text, seconds = await fam.rec_stop()
        return ok(text=text, seconds=round(seconds, 1))

    async def quiz_prepare(_r):
        return ok(state=await fam.quiz_prepare())

    async def listen(request):
        b = await body_of(request)
        try:
            wait = max(2.0, min(15.0, float(b.get('wait') or LISTEN_WAIT)))
        except (TypeError, ValueError):
            wait = LISTEN_WAIT
        return ok(**await fam.listen(b.get('lang') or b.get('language'), wait))

    async def rec_wait(request):
        b = await body_of(request)
        try:
            silence = max(1.0, min(8.0, float(b.get('silence') or 2.5)))
        except (TypeError, ValueError):
            silence = 2.5
        return ok(status=await fam.rec_wait(silence))

    async def listen_cancel(_r):
        fam.listen_cancel()
        return ok()

    return [('/api/rec/wait', rec_wait), ('/api/quiz/prepare', quiz_prepare), ('/api/listen', listen), ('/api/listen/cancel', listen_cancel),
            ('/api/family', get_all), ('/api/ui', ui), ('/api/tv-timer', tv_timer),
            ('/api/notes/add', note_add), ('/api/notes/done', note_done),
            ('/api/routine/set', routine_set), ('/api/routine/tick', routine_tick),
            ('/api/bedtime', bedtime), ('/api/rec/start', rec_start), ('/api/rec/stop', rec_stop),
            ('/api/stars/add', stars_add), ('/api/study/state', study_state),
            ('/api/study/listen', study_listen), ('/api/study/quiet', study_quiet), ('/api/study/touch', study_touch)]
