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

    async def _asr(self, pcm_bytes):
        import aiohttp
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as s:
            async with s.post(self.client.cfg['hub_http'] + '/kiosk/asr', data=pcm_bytes) as r:
                d = await r.json(content_type=None)
        return (d.get('text') or '').strip()

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
        keep = ('active', 'mode', 'level', 'n', 'total', 'right', 'streak', 'ans', 'opts', 'lang', 'question', 'speaking')
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

    return [('/api/family', get_all), ('/api/ui', ui), ('/api/tv-timer', tv_timer),
            ('/api/notes/add', note_add), ('/api/notes/done', note_done),
            ('/api/routine/set', routine_set), ('/api/routine/tick', routine_tick),
            ('/api/bedtime', bedtime), ('/api/rec/start', rec_start), ('/api/rec/stop', rec_stop),
            ('/api/stars/add', stars_add), ('/api/study/state', study_state),
            ('/api/study/listen', study_listen), ('/api/study/quiet', study_quiet), ('/api/study/touch', study_touch)]
