// ThinkSmart voice client page v2: renders what the client streams on /events and sends the buttons back.
// Same contract as v1. Open with ?demo (or ?demo=<scene>) to preview without a client.
const $ = id => document.getElementById(id);

// 页面点按/报错进客户端日志（kiosk 没控制台）。2026-11-16「看图有预览，点拍摄没有反应」：客户端一个
// 拍照请求都没收到，离屏 WebKit 里按钮又点得到，只能在真机上记下点按到了哪一步。
function pageLog(kind, msg) {
  if (location.search.includes('demo')) return;
  try {
    fetch('/api/page-log', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, msg: String(msg).slice(0, 300) }) }).catch(() => {});
  } catch (e) { /* 记日志本身不能再出错 */ }
}
window.addEventListener('error', e => pageLog('error', `${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => pageLog('rejection', e.reason && e.reason.message ? `${e.reason.message} | ${e.reason.stack || ''}` : e.reason));
for (const type of ['touchstart', 'click']) {
  document.addEventListener(type, e => {
    const b = e.target && e.target.closest && e.target.closest('#hwSheet button, #stSheet button');
    if (b) pageLog('tap', `${type} ${b.id || ''} 「${(b.textContent || '').trim().slice(0, 12)}」 hidden=${b.hidden} disabled=${b.disabled}`);
  }, { capture: true, passive: true });
}

// 孩子在点屏幕：告诉客户端（每 3 s 最多一次），小麦就不会在后台提醒「没说话 / 我先休息啦」（owner 2026-11-19）
let lastTouchPost = 0;
document.addEventListener('pointerdown', () => {
  const now = Date.now();
  if (now - lastTouchPost < 3000) return;
  lastTouchPost = now;
  fetch('/api/study/touch', { method: 'POST' }).catch(() => {});
}, { capture: true, passive: true });

// 曲名/歌手来自 NAS 与后台，直接拼 innerHTML 会把 & < > 吃掉或注入标签
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const WEEK = '日一二三四五六';
const DEMO = new URLSearchParams(location.search).get('demo');   // null when not a demo
if (DEMO !== null && /[?&]still\b/.test(location.search)) document.documentElement.classList.add('still');

const ui = {
  status: { state: 'idle', connected: false, uploading: false },
  models: { current: null, options: [] },
  thread: { entry: null, messages: [] },
  ptt: false,
  alarms: { synced: true, items: [], missed: [], ringing: null, volume: 70, tone: 'coffee', tones: {} },
  devices: { homes: [], devices: [], error: null },
};

// 建议问题按场景分组：kiosk 在厨房/客厅，用户最常问的是音乐、家电、夜间、天气，
// 而不是「帮我想个周末计划」。每组一个短名，页面上可以横向切。
const SCENES = [
  ['日常', [
    // 不带城市：hub 提示词要求直接调 get_weather 不传 location，用设备所在城市（默认广州，见 hub 配置）
    ['明天天气怎么样？', '#ffb54729', '#ffcf7a', '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>'],
    ['帮我定一个 20 分钟后的计时', '#5ee0ff24', '#8ff0ff', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
    ['讲个冷笑话', '#ff7ac824', '#ff9bd6', '<circle cx="12" cy="12" r="9"/><path d="M8 14.5a5 5 0 0 0 8 0M9 9.5h.01M15 9.5h.01"/>'],
  ]],
  ['音乐', [
    ['放点王菲', '#9b7bff2b', '#c8b4ff', '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>'],
    ['在电视上放点音乐', '#5ee0ff24', '#8ff0ff', '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>'],
    // HomePod 通路 11-10 已从面板下线，这里不再推荐它
    ['来点古典音乐，连着放', '#ffb54729', '#ffcf7a', '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>'],
    ['把音量调小一点', '#9b7bff2b', '#c8b4ff', '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 12h4"/>'],
  ]],
  ['家电', [
    ['客厅灯打开', '#ffb54729', '#ffcf7a', '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5V16h8v-2.5A6 6 0 0 0 12 3z"/>'],
    ['现在家里有哪些设备', '#5ee0ff24', '#8ff0ff', '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'],
    ['电视关掉', '#ff7ac824', '#ff9bd6', '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>'],
  ]],
  ['看作业', [
    ['睇下我嘅作业', '#5ee0ff24', '#8ff0ff', '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'],
    ['帮我看一下作业', '#ffb54729', '#ffcf7a', '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'],
    ['Check my homework', '#9b7bff2b', '#c8b4ff', '<path d="M4 6l2 2 3-3M4 13l2 2 3-3M12 7h8M12 14h8"/>'],
  ]],
  ['学习', [
    ['口算闪卡', '#5ee0ff24', '#8ff0ff', '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h3M9.5 7.5v3M13 9h3M8 15h3M13 14h3M13 16h3"/>', 'flash'],
    ['听写', '#ffb54729', '#ffcf7a', '<path d="M4 20l4-1 10-10-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>', 'dictation'],
    ['这是什么', '#9b7bff2b', '#c8b4ff', '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M9.5 9a1.8 1.8 0 1 1 2.3 1.8c-.5.2-.8.6-.8 1.1M11 14h.01"/>', 'identify'],
    ['朗读检查', '#ff7ac824', '#ff9bd6', '<path d="M4 5h6a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4zM20 5h-6a3 3 0 0 0-3 3"/>', 'read'],
    ['TIMO 奥数 K2 / P1', '#5ee0ff24', '#8ff0ff', '<path d="M5 4h11l3 3v13H5z"/><path d="M9 9h5M9 13h5M9 17h3"/><circle cx="17.5" cy="17.5" r="3"/>', 'timo'],
    ['错题本', '#5ee0ff24', '#8ff0ff', '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8l6 6M15 8l-6 6"/>', 'book'],
  ]],
  ['家庭', [
    ['作息清单', '#5ee0ff24', '#8ff0ff', '<path d="M4 6l2 2 3-3M4 13l2 2 3-3M12 7h8M12 14h8M12 20h8"/>', 'routine'],
    ['电视再睇 30 分钟就熄', '#ffb54729', '#ffcf7a', '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M12 9v3l2 1"/>'],
    ['讲个睡前故事', '#9b7bff2b', '#c8b4ff', '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'],
    ['留言：放学返嚟先食生果', '#ff7ac824', '#ff9bd6', '<path d="M4 5h16v11H8l-4 4z"/>'],
  ]],
  ['夜间', [
    ['晚安', '#5ee0ff24', '#8ff0ff', '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'],
    ['把屏幕亮度调到 20%', '#ffb54729', '#ffcf7a', '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'],
    ['明天早上 7 点叫我', '#9b7bff2b', '#c8b4ff', '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3l-2 3M19 3l2 3"/>'],
  ]],
];

let chipLock = false;
const CHIP_COOLDOWN_MS = 1500;
function renderChips() {
  const box = $('chips');
  if (!box) return;
  const i = Math.max(0, Math.min(SCENES.length - 1, Number(ui.scene) || 0));
  ui.scene = i;
  document.querySelectorAll('.scene-tab').forEach((el, k) => {
    el.classList.toggle('on', k === i);
    el.setAttribute('aria-selected', k === i ? 'true' : 'false');
  });
  box.innerHTML = '';
  for (const [q, bg, fg, icon, open] of SCENES[i][1]) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `<i style="background:${bg};color:${fg}"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></i>${esc(q)}`;
    b.addEventListener('click', async () => {
      if (open) { stOpen(open); return; }   // 学习/家庭：直接开面板，不走语音
      // 只开面板 + 实时画面，等摆好作业再点「拍作业」：以前一点就倒数 3 秒自拍，拍到的是人不是作业，
      // 接着转圈 20 多秒、按钮被遮罩挡住，owner「点拍摄没有反应」（2026-11-16 16:01 实拍判「无法判断」）
      if (SCENES[i][0] === '看作业') { hwSetLang(q === 'Check my homework' ? 'en' : q === '睇下我嘅作业' ? 'yue' : 'zh'); hwOpen(true, false); return; }
      // 触屏偶尔一次点按报 6-15 次 click（11-14 日志），还会连带点到相邻卡片：
      // 一张卡在发送/冷却期间，所有卡片都不再响应
      if (chipLock) return;
      chipLock = true;
      // 点了立即给反馈：卡片进 loading，避免用户以为没点中而重复点
      b.classList.add('sending');
      b.setAttribute('aria-busy', 'true');
      try {
        await post('/api/text', { text: q });
      } catch (e) {
        toast('这句话没发出去，再点一次', 'error');
      } finally {
        setTimeout(() => {
          chipLock = false;
          b.classList.remove('sending');
          b.removeAttribute('aria-busy');
        }, CHIP_COOLDOWN_MS);
      }
    });
    box.appendChild(b);
  }
}

/* ---- 看作业：内置摄像头拍照 → 网关看图 → 逐题卡片 + 粤语/英文朗读 ---- */
const HW = { lang: 'yue', data: null, busy: false, audio: null, tick: null, view: 'result', live: false };
const HW_COUNTDOWN = 3;   // 点「拍」或说「睇作业」后先倒数，给孩子把作业纸摆到镜头前

function hwEl(id) { return document.getElementById(id); }

function hwSetBusy(on, text) {
  if (HW.tick) { clearInterval(HW.tick); HW.tick = null; }
  HW.busy = on;
  const b = hwEl('hwBusy');
  if (b) b.classList.remove('cd');
  if (b) { b.hidden = !on; hwEl('hwBusyText').textContent = text || '在看…'; }
  const shoot = hwEl('hwShoot'), again = hwEl('hwAgain');
  if (shoot) shoot.disabled = on;
  if (again) again.disabled = on;
}

function hwRenderBoxes(items) {
  const box = hwEl('hwBoxes');
  if (!box) return;
  box.innerHTML = '';
  for (const it of items || []) {
    const b = it.box;
    if (!Array.isArray(b) || b.length !== 4) continue;
    const d = document.createElement('div');
    d.className = 'hw-box' + (it.ok === false ? '' : ' ok');
    d.style.left = (b[0] * 100) + '%';
    d.style.top = (b[1] * 100) + '%';
    d.style.width = (b[2] * 100) + '%';
    d.style.height = (b[3] * 100) + '%';
    box.appendChild(d);
  }
}

function hwRender(d, fresh = false) {   // fresh=刚拍出来的结果：收掉实时画面换成照片
  HW.data = d || null;
  hwSetView('result');
  const img = hwEl('hwImg'), empty = hwEl('hwEmpty'), head = hwEl('hwHead');
  const list = hwEl('hwItems'), boxes = hwEl('hwBoxes');
  const speak = hwEl('hwSpeak'), stop = hwEl('hwStop');
  if (!d) {
    if (img) { img.hidden = true; img.removeAttribute('src'); }
    if (empty) empty.hidden = false;
    if (head) head.innerHTML = '';
    if (boxes) boxes.innerHTML = '';
    if (list) list.innerHTML = '<div class="hw-tip">拍一张作业纸的照片，我会逐题告诉你哪里要再看一次，先给提示、不直接报答案。</div>';
    if (speak) speak.hidden = true;
    if (stop) stop.hidden = true;
    return;
  }
  const thumb = d.thumb || '';
  if (thumb && fresh) hwLiveOff();
  if (img && thumb) {
    img.src = thumb;
    img.hidden = HW.live;
    if (empty && !HW.live) empty.hidden = true;
    img.onload = () => hwRenderBoxes(d.items);
  }
  if (head) {
    const n = (d.items || []).length;
    const bad = (d.items || []).filter(i => i.ok === false).length;
    const fixed = (d.fixed || []).length;
    head.innerHTML = `<b>${esc(d.subject || '作业')}</b><span>${esc(d.grade_guess || '')}`
      + (d.readable === false ? ' · 看不清，请再拍一张' : ` · ${n} 题，${bad} 题要再看一次`) + '</span>'
      + (fixed ? `<span class="hw-fixed">🎉 改对了 ${fixed} 题</span>` : '');
  }
  if (list) {
    list.innerHTML = '';
    if (d.readable === false) {
      const t = document.createElement('div');
      t.className = 'hw-tip';
      t.textContent = (d.speech && (d.speech[HW.lang] || d.speech.zh)) || '这张看不清，请把作业纸放到摄像头前面再拍一张。';
      const again = document.createElement('button');
      again.className = 'pri hw-again';
      again.textContent = '📷 举起作业纸，再拍一张';
      again.addEventListener('click', () => hwCapture());
      t.appendChild(again);
      list.appendChild(t);
    }
    for (const it of d.items || []) {
      const el = document.createElement('div');
      el.className = 'hw-item ' + (it.ok === false ? 'bad' : it.ok === true ? 'good' : '');
      const mark = it.ok === false ? '✗' : it.ok === true ? '✓' : '·';
      // 先提示、后答案：错题只给提示；点「看答案」或第二次还错（retry）才露出正确答案和讲解
      const wasFixed = (d.fixed || []).some(no => String(no) === String(it.no));
      el.innerHTML = hwItemHtml(it, mark, it.retry === true, wasFixed);
      el.addEventListener('click', ev => {
        if (it.ok !== false) return;
        if (ev.target.closest('.reveal')) { el.innerHTML = hwItemHtml(it, mark, true, false); it._shown = true; return; }
        hwSpeakItem(it);
      });
      list.appendChild(el);
    }
    if (d.summary) {
      const s = document.createElement('div');
      s.className = 'hw-tip';
      s.textContent = d.summary;
      list.appendChild(s);
    }
  }
  if (speak) speak.hidden = !hwSpeechText(d);
  if (stop) stop.hidden = true;
}

function hwItemHtml(it, mark, show, fixed) {
  let html = `<div class="q"><em>第 ${esc(String(it.no ?? ''))} 题</em>${esc(it.question || '')}<span class="mark">${mark}</span>`
    + (fixed ? '<span class="hw-tag ok">改对了</span>' : it.retry ? '<span class="hw-tag">再错一次</span>' : '') + '</div>';
  const open = show || it._shown;
  if (it.child_answer) html += `<div class="a">写的：${esc(it.child_answer)}`
    + (it.ok === false && it.correct && open ? ` <s>✗</s> 应该是 <b>${esc(it.correct)}</b>` : '') + '</div>';
  if (it.hint) html += `<div class="hint">💡 ${esc(it.hint)}</div>`;
  if (it.ok === false) {
    if (open && it.explain) html += `<div class="explain">${esc(it.explain)}</div>`;
    else if (!open && (it.explain || it.correct)) html += '<button class="reveal">改过还不会？看答案</button>';
  }
  return html;
}

/* ---- 实时画面：面板开着、倒数时看得到镜头里有什么；拍的那一下客户端会自己停掉 ---- */
/* 实时画面闸门：上一路停掉后至少 LIVE_GAP_MS 才开下一路，停掉时取消还没开的那路。
   快速「停一路→开一路」（学习面板「这是什么」切到「朗读」150 ms 内）会让 WebKit 网页进程崩溃：
   新流一开，客户端就掐断旧流，WebKit 处理被掐断的 multipart 图片时崩（2026-11-16 回归测试二分定位；
   隔 3 秒切换不崩）。kiosk 页面崩了整屏白掉，看作业/这是什么都用不了。 */
const LIVE_GAP_MS = 900;
const LIVE = { stopAt: 0, timer: null };
function liveStart(img, onerror) {
  clearTimeout(LIVE.timer);
  const wait = Math.max(0, LIVE_GAP_MS - (Date.now() - LIVE.stopAt));
  LIVE.timer = setTimeout(() => {
    LIVE.timer = null;
    if (!img.isConnected) return;
    img.onerror = onerror || null;
    img.src = '/api/hw/live?t=' + Date.now();
  }, wait);
}
function liveStop(img) {
  clearTimeout(LIVE.timer); LIVE.timer = null;
  if (img && img.getAttribute('src')) { img.onerror = null; img.removeAttribute('src'); LIVE.stopAt = Date.now(); }
}

function hwLiveOn() {
  const v = hwEl('hwLive');
  if (!v || HW.live) return;
  HW.live = true;
  v.onload = null;
  if (typeof stLive === 'function' && ST.live) stLive(false);   // 同时只开一路
  liveStart(v, () => hwLiveOff(true));
  v.hidden = false;
  const tag = hwEl('hwLiveTag'); if (tag) tag.hidden = false;
  const e = hwEl('hwEmpty'); if (e) e.hidden = true;
  const img = hwEl('hwImg'); if (img) img.hidden = true;
  const bx = hwEl('hwBoxes'); if (bx) bx.hidden = true;
}

function hwLiveOff(failed) {
  const v = hwEl('hwLive');
  HW.live = false;
  if (v) { liveStop(v); v.hidden = true; }
  const tag = hwEl('hwLiveTag'); if (tag) tag.hidden = true;
  const img = hwEl('hwImg'), e = hwEl('hwEmpty'), bx = hwEl('hwBoxes');
  const has = img && img.getAttribute('src');
  if (img) img.hidden = !has;
  if (bx) bx.hidden = false;
  if (e) {
    e.hidden = !!has;
    const t = e.querySelector('span');
    if (t) t.textContent = failed ? '看不到实时画面，点一下再试（镜头盖拨开了吗？）' : '点一下看实时画面';
  }
}

/* ---- 错题本：网关把盘上 30 天的结果合并成错题清单 + 本周小结（不调模型） ---- */
function hwSetView(v) {
  HW.view = v;
  const b = hwEl('hwBook');
  if (b) b.textContent = v === 'book' ? '本次结果' : '错题本';
}

async function hwShowBook() {
  const head = hwEl('hwHead'), list = hwEl('hwItems');
  if (!list) return;
  hwSetView('book');
  list.innerHTML = '<div class="hw-tip">在翻错题本…</div>';
  let d;
  try {
    d = await (await fetch('/api/hw/book')).json();
  } catch (e) { d = { ok: false }; }
  if (HW.view !== 'book') return;
  if (!d.ok) { list.innerHTML = '<div class="hw-tip">错题本暂时打不开</div>'; return; }
  const w = d.week || {};
  if (head) head.innerHTML = `<b>错题本</b><span>还要练 ${d.open || 0} 题</span>`;
  list.innerHTML = '';
  const sum = document.createElement('div');
  sum.className = 'hw-week';
  sum.innerHTML = w.checks
    ? `<b>这 7 天</b>看了 ${w.checks} 次作业，${w.items} 题里做对 ${w.right} 题`
      + (w.accuracy != null ? `（${w.accuracy}%）` : '') + `，改对 ${w.fixed} 道错题`
    : '<b>这 7 天</b>还没看过作业';
  list.appendChild(sum);
  const ms = d.mistakes || [];
  if (!ms.length) {
    const t = document.createElement('div');
    t.className = 'hw-tip';
    t.textContent = '最近 30 天没有错题，继续保持！';
    list.appendChild(t);
  }
  for (const m of ms) {
    const el = document.createElement('div');
    el.className = 'hw-item ' + (m.fixed ? 'good' : 'bad');
    const when = (m.last || '').slice(5, 10);
    el.innerHTML = `<div class="q"><em>${esc(m.subject || '')} ${esc(when)}</em>${esc(m.question)}`
      + `<span class="mark">${m.fixed ? '✓' : '✗'}</span>`
      + (m.fixed ? '<span class="hw-tag ok">已改对</span>' : m.times > 1 ? `<span class="hw-tag">错了 ${m.times} 次</span>` : '')
      + '</div>'
      + (m.child_answer ? `<div class="a">写过：${esc(m.child_answer)}</div>` : '')
      + (m.hint ? `<div class="hint">💡 ${esc(m.hint)}</div>` : '');
    el.addEventListener('click', () => hwSpeakText([m.question, m.hint].filter(Boolean).join('。')));
    list.appendChild(el);
  }
}

function hwSpeechText(d) {
  if (!d) return '';
  const sp = d.speech || {};
  return (sp[HW.lang] || sp.zh || d.summary || '').trim();
}

function hwSpeakText(text) {
  if (!text) return;
  if (HW.audio) { HW.audio.pause(); HW.audio = null; }
  const url = '/api/hw/tts?lang=' + encodeURIComponent(HW.lang) + '&text=' + encodeURIComponent(text);
  const a = new Audio(url);
  HW.audio = a;
  const stop = hwEl('hwStop');
  if (stop) stop.hidden = false;
  a.addEventListener('ended', () => { if (HW.audio === a) HW.audio = null; if (stop) stop.hidden = true; });
  a.addEventListener('error', () => { if (stop) stop.hidden = true; });
  a.play().catch(() => toast('朗读没播出来', 'error'));
}

function hwSpeakItem(it) {
  // 没点「看答案」前只念题目和提示，不把讲解（含答案）念出来
  const parts = [it.question, it.hint, (it._shown || it.retry) ? it.explain : ''].filter(Boolean);
  if (parts.length) hwSpeakText(parts.join('。'));
}

function hwCountdown(n) {
  // 11-18/19 实拍多张只有房间和孩子的脸：说「放到镜头前」孩子不知道举纸。镜头在屏幕上方，举起来挡住脸正好
  hwSetBusy(true, '📄 把作业纸举起来，挡住你的脸… ' + n);
  const b = hwEl('hwBusy'); if (b) b.classList.add('cd');   // 倒数时半透明，看得到实时画面
  let left = n;
  HW.tick = setInterval(() => {
    left -= 1;
    if (left <= 0) { clearInterval(HW.tick); HW.tick = null; return; }
    const t = hwEl('hwBusyText');
    if (t) t.textContent = '📄 把作业纸举起来，挡住你的脸… ' + left;
  }, 1000);
}

// 客户端拍照各阶段的推送（点按和语音触发都会来）。语音触发时面板自动打开；
// 点按那条路的结果和朗读仍由 hwCapture 自己处理，这里只管进度和语音那条的结果。
function hwEvent(e) {
  if (e.mode && e.mode !== 'homework') { stCamEvent(e); return; }   // 这是什么 / 抄课文：学习面板自己管
  const voice = e.source === 'voice';
  if (voice) {
    const sheet = hwEl('hwSheet');
    if (sheet && !sheet.classList.contains('on')) hwOpen(true, false);
    if (e.language && e.language !== HW.lang) hwSetLang(e.language);
  }
  switch (e.phase) {
    case 'countdown': hwLiveOn(); hwCountdown(e.seconds || HW_COUNTDOWN); break;
    case 'shooting': hwLiveOff(); hwSetBusy(true, '在拍照…'); break;
    case 'analyzing': {
      // 模型平时 3-7 s，慢时 20 多秒：只转圈像卡死了，显示等了几秒
      hwSetBusy(true, '在看作业…');
      const t0 = Date.now(), el = hwEl('hwBusyText');
      HW.tick = setInterval(() => { if (el) el.textContent = `在看作业… ${Math.round((Date.now() - t0) / 1000)} 秒`; }, 1000);
      break;
    }
    case 'done': if (voice) { hwSetBusy(false); hwRender(e.data, true); hwStars(e.data); } break;   // 语音那条由网关念，这里不再朗读
    // 出错一律停转圈（点按那条 hwCapture 也会再收一次尾，重复无害）；提示只在语音那条弹，点按的由 hwCapture 弹
    case 'error': hwSetBusy(false); if (voice) toast(e.error || '没拍成', 'error'); break;
  }
}

/* 看作业也发小星星（2026-11-19）：改对一题 +1，整张全对 +2；同一张只发一次 */
const HW_STARRED = new Set();
function hwStars(d) {
  if (!d || d.readable === false || !d.id || HW_STARRED.has(d.id)) return;
  const items = d.items || [];
  const n = (d.fixed || []).length + (items.length && items.every(i => i.ok !== false) ? 2 : 0);
  if (!n) return;
  HW_STARRED.add(d.id);
  STARS.today += n; STARS.total += n; starRender();
  toast(`⭐ +${n} ${items.every(i => i.ok !== false) ? '全对，好叻！' : '改对咗，好叻！'}`);
  fetch('/api/stars/add', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stars: n, why: 'homework' }) }).catch(() => {});
}

async function hwCapture(extra) {
  if (HW.busy) { pageLog('note', 'hwCapture 跳过：HW.busy'); return; }
  extra = (extra && typeof extra === 'object' && !(extra instanceof Event)) ? extra : {};
  hwLiveOn();
  hwSetBusy(true, '准备拍照…');
  hwSpeakText({ yue: '将份功课举高，挡住块面', en: 'Hold your homework up in front of your face', zh: '把作业纸举起来，挡住你的脸' }[HW.lang] || '把作业纸举起来，挡住你的脸');
  const b0 = hwEl('hwBusy'); if (b0) b0.classList.add('cd');
  try {
    const r = await fetch('/api/hw/capture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: HW.lang, countdown: HW_COUNTDOWN, source: 'page', ...extra }),
    });
    const d = await r.json().catch(() => ({ ok: false, error: '网关没有回话' }));
    if (!d.ok) { toast(d.code === 'busy' ? '正在拍，等一下' : (d.error || '没拍成，再试一次'), 'error'); return; }
    hwRender(d, true);
    hwStars(d);
    const text = hwSpeechText(d);
    if (text) hwSpeakText(text);
  } catch (e) {
    toast('拍照失败，再试一次', 'error');
  } finally {
    hwSetBusy(false);
    if (HW.live && !(HW.data && HW.data.thumb)) hwLiveOff();
  }
}

function hwOpen(on, shoot = true) {
  const sheet = hwEl('hwSheet');
  if (!sheet) return;
  sheet.classList.toggle('on', !!on);
  if (!on) hwLiveOff();
  if (on) {
    if (!HW.data) hwLoadLatest();
    if (!shoot && !HW.busy) hwLiveOn();
    if (shoot) hwCapture();
  } else if (HW.audio) {
    HW.audio.pause(); HW.audio = null;
  }
}

async function hwLoadLatest() {
  try {
    const r = await fetch('/api/hw/latest');
    const d = await r.json();
    if (d.ok && d.homework) hwRender(d.homework);
  } catch (e) { /* 网关不通就保持空白 */ }
}

function hwSetLang(lang) {
  HW.lang = lang;
  document.querySelectorAll('.hw-lang').forEach(el => el.classList.toggle('on', el.dataset.lang === lang));
  if (HW.data) hwRender(HW.data);
}

for (const el of document.querySelectorAll('.hw-lang')) {
  el.addEventListener('click', () => hwSetLang(el.dataset.lang));
}
if (hwEl('hwShoot')) hwEl('hwShoot').addEventListener('click', hwCapture);
if (hwEl('hwAgain')) hwEl('hwAgain').addEventListener('click', hwCapture);
if (hwEl('hwClose')) hwEl('hwClose').addEventListener('click', () => hwOpen(false));
if (hwEl('hwPhoto')) hwEl('hwPhoto').addEventListener('click', () => { if (!HW.busy && !HW.live) hwLiveOn(); });
if (hwEl('hwBook')) hwEl('hwBook').addEventListener('click', () => {
  if (HW.view === 'book') hwRender(HW.data); else hwShowBook();
});
if (hwEl('hwSpeak')) hwEl('hwSpeak').addEventListener('click', () => hwSpeakText(hwSpeechText(HW.data)));
if (hwEl('hwStop')) hwEl('hwStop').addEventListener('click', () => {
  if (HW.audio) { HW.audio.pause(); HW.audio = null; }
  hwEl('hwStop').hidden = true;
});

/* ---- clock ---- */
function tick() {
  const now = new Date();
  const hm = pad(now.getHours()) + ':' + pad(now.getMinutes());
  $('time').textContent = hm;
  $('bigTime').textContent = hm;
  $('bigDate').textContent = `${now.getMonth() + 1}月${now.getDate()}日  星期${WEEK[now.getDay()]}`;
  const h = now.getHours();
  $('greet').textContent = h < 5 ? '夜深了' : h < 9 ? '早上好' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : h < 23 ? '晚上好' : '夜深了';
  $('ringTime').textContent = hm;
  tickAlarms();
}

/* ---- 首页天气：今天 / 明天，30 分钟刷新一次（客户端缓存 Open-Meteo，断网就整行隐藏） ---- */
const WX_ICON = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  'cloud-sun': '<path d="M8 3.5v1.2M3.6 8H2.4M4.8 4.8l.9.9M11.2 4.8l-.9.9"/><path d="M5.6 10.4A3 3 0 1 1 10.5 7"/><path d="M17.5 19H9a4 4 0 1 1 .9-7.9A5 5 0 0 1 19.5 13a3 3 0 0 1-2 6z"/>',
  cloud: '<path d="M17.5 19H9a5 5 0 1 1 1.2-9.9A6 6 0 0 1 21 12.5 3.5 3.5 0 0 1 17.5 19z"/>',
  rain: '<path d="M17.5 15H9a5 5 0 1 1 1.2-9.9A6 6 0 0 1 21 8.5 3.5 3.5 0 0 1 17.5 15z"/><path d="M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5"/>',
  snow: '<path d="M17.5 15H9a5 5 0 1 1 1.2-9.9A6 6 0 0 1 21 8.5 3.5 3.5 0 0 1 17.5 15z"/><path d="M9 19h.01M13 20h.01M17 19h.01"/>',
  storm: '<path d="M17.5 15H9a5 5 0 1 1 1.2-9.9A6 6 0 0 1 21 8.5 3.5 3.5 0 0 1 17.5 15z"/><path d="M13 14l-2 4h3l-2 4"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
};
function renderWeather(w) {
  const box = $('homeWeather');
  if (!box) return;
  if (!w || !w.days || !w.days.length) { box.hidden = true; return; }
  const svg = k => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round">${WX_ICON[k] || WX_ICON.cloud}</svg>`;
  const day = d => `<div class="wx-day">${svg(d.icon)}<span class="wx-label">${esc(d.label)}</span>` +
    `<b>${esc(d.text)}</b><span class="wx-t">${d.lo ?? '–'}–${d.hi ?? '–'}°</span>` +
    (d.rain != null && d.rain >= 30 ? `<span class="wx-rain">降水 ${d.rain}%</span>` : '') + '</div>';
  const now = w.now && w.now.temp != null ? `<div class="wx-now">${esc(w.city || '')} <b>${w.now.temp}°</b></div>` : '';
  box.innerHTML = now + w.days.map(day).join('');
  box.hidden = false;
}
async function loadWeather() {
  if (DEMO !== null) {
    return renderWeather({ city: '广州', now: { temp: 21, icon: 'cloud' }, days: [
      { label: '今天', text: '阴', icon: 'cloud', lo: 18, hi: 27, rain: 10 },
      { label: '明天', text: '小雨', icon: 'rain', lo: 17, hi: 24, rain: 60 }] });
  }
  try { renderWeather(await (await fetch('/api/weather')).json()); } catch (e) { /* 没网就不显示 */ }
}

/* ---- the orb's corona: 48 bars around the orb, one shape per state ----
   idle: short and still. connecting: 12 dashes, turned slowly by CSS. thinking: a comet orbiting (CSS).
   listening: the whole ring pushes outward with your voice, all bars together — loud is big, quiet barely moves.
   speaking: three lobes turning round the ring, swelling with the reply's volume.
   Only listening/speaking redraw every frame; any state change morphs the bars over 0.4 s, then the loop stops.
   All bars are drawn on one canvas: as 48 elements, restyling them 30 times a second kept
   the device's main thread at ~93% and the page at ~17 fps. */
const BARS = 48, R_IN = 110, BAR_W = 6, REST = 8, REACH = 46;   // px; REST + REACH stays inside the canvas
const corona = document.createElement('canvas');
const CSIZE = 330, DPR = Math.min(2, window.devicePixelRatio || 1);
corona.width = corona.height = CSIZE * DPR;
corona.style.width = corona.style.height = '100%';
$('corona').appendChild(corona);
const cx = corona.getContext('2d');
const ANG = Array.from({ length: BARS }, (_, i) => i / BARS * Math.PI * 2);
const COS = ANG.map(Math.cos), SIN = ANG.map(Math.sin);
// per bar: [length px, opacity]; what is on screen, where a morph starts, and where the state wants it
const cur = new Float32Array(BARS * 2), from = new Float32Array(BARS * 2), tgt = new Float32Array(BARS * 2);
let barFill = null, barFillState = '';
function fillFor(state) {
  // one radial gradient for all bars: inner end --c2, outer end --c1
  if (barFillState !== state) {
    const css = getComputedStyle(document.body);
    barFill = cx.createRadialGradient(0, 0, R_IN, 0, 0, R_IN + REST + REACH);
    barFill.addColorStop(0, css.getPropertyValue('--c2').trim());
    barFill.addColorStop(1, css.getPropertyValue('--c1').trim());
    barFillState = state;
  }
  return barFill;
}
// Bars of (nearly) the same opacity share one path and one fill: 48 separate fills cost the device's
// main thread ~20% of a core while speaking. The path takes each bar's transform as it is added.
const bucket = new Uint8Array(BARS);
function drawBars(bars) {
  const c = CSIZE * DPR / 2;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.clearRect(0, 0, corona.width, corona.height);
  cx.fillStyle = fillFor(document.body.dataset.state || 'idle');
  for (let i = 0; i < BARS; i++) bucket[i] = bars[i * 2] < .5 ? 0 : Math.max(1, Math.round(bars[i * 2 + 1] * 20));
  for (let q = 1; q <= 20; q++) {
    if (!bucket.includes(q)) continue;
    cx.beginPath();
    for (let i = 0; i < BARS; i++) {
      if (bucket[i] !== q) continue;
      cx.setTransform(COS[i] * DPR, SIN[i] * DPR, -SIN[i] * DPR, COS[i] * DPR, c, c);
      cx.roundRect(-BAR_W / 2, -R_IN - bars[i * 2], BAR_W, bars[i * 2], BAR_W / 2);
    }
    cx.setTransform(DPR, 0, 0, DPR, c, c);   // the radial gradient is centred on the orb
    cx.globalAlpha = q / 20;
    cx.fill();
  }
  cx.globalAlpha = 1;
}

// target shape of a state into out; v = sound level 0..1, p = phase (s), t = seconds in this state
function shapeOf(state, v, p, t, out) {
  for (let i = 0; i < BARS; i++) {
    const a = ANG[i], f = i / BARS;
    let len = REST, alpha = 1;
    if (state === 'thinking') { len = 6.6 + 28.5 * f * f; alpha = .1 + .9 * f ** 1.6; }
    else if (state === 'connecting') { len = i % 4 ? 4.2 : 16.5; alpha = i % 4 ? .35 : 1; }
    else if (state === 'listening') {
      // a short burst on waking says "I'm here", then the ring follows the voice as one
      const env = Math.max(v, .5 * Math.max(0, 1 - t / .6) ** 2);
      const grain = .84 + .16 * Math.sin(a * 5 + p * 3.1) * Math.sin(a * 3 - p * 2.3);
      len = REST - 1 + 1.2 * Math.sin(a * 4 + p * 1.5) + REACH * env * grain;
    } else if (state === 'speaking') {
      const lobe = .5 + .5 * Math.sin(a * 3 - p * 1.3);
      len = REST + 4 * lobe + REACH * v * (.3 + .7 * lobe);
      alpha = .6 + .4 * lobe;
    }
    out[i * 2] = len;
    out[i * 2 + 1] = alpha;
  }
}

// The mic level (RMS) in decibels, so a quiet voice visibly moves the corona. Measured on the device
// (2026-11-01, 9 listening turns): room noise -74..-80 dBFS with rare blips to -62, normal speech
// -60..-42 dBFS. The old linear scale (full at -23 dBFS) moved the corona 1–7% for that speech.
// Now noise stays 0, a quiet voice (-55) reaches ~30%, a normal one (-45) ~58%, a loud one (-30) 100%.
const MIC_FLOOR = -66, MIC_FULL = -30;   // dBFS
const micLevel = rms => Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-6) - MIC_FLOOR) / (MIC_FULL - MIC_FLOOR)));

const STILL = document.documentElement.classList.contains('still');
const level = { target: 0, value: 0, phase: 0, raf: 0, last: 0, state: '', since: 0, mix: 1 };
const isLive = s => s === 'listening' || s === 'speaking';
function setCorona(state) {
  if (state === level.state) return;
  // morph from what is on screen; a spinning corona is turned by CSS, so carry its angle into the bars
  const m = getComputedStyle($('corona')).transform.match(/matrix\(([^,]+),\s*([^,]+)/);
  const k = m ? Math.round(Math.atan2(+m[2], +m[1]) / (Math.PI * 2) * BARS) : 0;
  for (let i = 0; i < BARS; i++) {
    const j = ((i - k) % BARS + BARS) % BARS;
    from[i * 2] = cur[j * 2]; from[i * 2 + 1] = cur[j * 2 + 1];
  }
  level.state = state;
  level.since = performance.now();
  level.mix = level.last ? 0 : 1;   // the first paint just draws
  if (!isLive(state)) level.target = 0;
  if (STILL) {   // screenshots: one fairly loud, settled frame
    shapeOf(state, isLive(state) ? .7 : 0, 1.2, 9, cur);
    drawBars(cur);
    if (isLive(state)) drawLive(.7, 1.2);
    return;
  }
  if (!level.raf) {
    level.last = performance.now() - 34;
    level.raf = requestAnimationFrame(levelLoop);
  }
}
function levelLoop(now) {
  level.raf = requestAnimationFrame(levelLoop);
  if (now - level.last < 33) return;      // ~30 fps is plenty
  const dt = Math.min(.1, (now - level.last) / 1000);
  level.last = now;
  level.value += (level.target - level.value) * (level.target > level.value ? .55 : .2);
  level.phase += dt * 2.4;
  const live = isLive(level.state);
  shapeOf(level.state, level.value, level.phase, (now - level.since) / 1000, tgt);
  if (level.mix < 1) {
    level.mix = Math.min(1, level.mix + dt / .4);
    const e = 1 - (1 - level.mix) ** 3;
    for (let i = 0; i < tgt.length; i++) cur[i] = from[i] + (tgt[i] - from[i]) * e;
  } else cur.set(tgt);
  drawBars(cur);
  if (live || level.mix < 1) drawLive(level.value, level.phase);   // after live: let the level settle
  else {
    cancelAnimationFrame(level.raf);
    level.raf = 0;
    level.target = level.value = 0;
    $('corona').style.transform = $('core').style.transform = $('micRing').style.transform = $('mouth').style.transform = '';
  }
}
// The whole corona layer grows with the level too (compositor only, no repaint): with the longer bars,
// the tips go from r ≈ 117 px when quiet to ≈ 190 px when loud. Core, mouth, mic ring and the wave follow.
function drawLive(v, p) {
  $('corona').style.transform = `scale(${(1 + v * .16).toFixed(3)})`;
  $('core').style.transform = `scale(${(1 + v * .13).toFixed(3)})`;
  $('mouth').style.transform = `scaleY(${(.55 + v * 1.6).toFixed(3)})`;
  if (level.state === 'listening') $('micRing').style.transform = `scale(${(1 + v * .16).toFixed(3)})`;   // invisible otherwise
  const pending = $('pending');
  if (pending) pending.querySelectorAll('.wave b').forEach((b, i) => { b.style.transform = `scaleY(${(.18 + v * (.5 + .5 * Math.sin(p * 3 + i * 1.3))).toFixed(3)})`; });
}

/* ---- status: orb, title, hint, buttons ---- */
function modelName() {
  const cur = ui.models.current;
  return cur ? cur.label : '模型';
}
const shownState = () => (ui.ptt ? 'listening' : ui.status.state);

/* ---- 事件流：同一条事件重复到达只处理一次 ---- */
// 页面重连后服务端会把 snapshot 再发一遍，同一句回复、同一条汇报也可能重放。这里按事件
// 的身份去重：只认「同一件事」的重复（同一条消息 id、同一个闹钟的同一状态），
// 不认「同一类事件」，所以两句话内容相同也不会被吞掉。
const seenEvents = new Map();
function once(key, limit = 400) {
  if (seenEvents.has(key)) return false;
  seenEvents.set(key, 1);
  if (seenEvents.size > limit) {
    // 只丢最老的一半，够用又不让内存无限长
    const keys = [...seenEvents.keys()];
    for (const k of keys.slice(0, keys.length - Math.floor(limit / 2))) seenEvents.delete(k);
  }
  return true;
}

/* ---- 状态提示条：断连/麦克风关闭/夜间静音，用文字直接告知，不靠颜色猜 ---- */
// 后台活着但这次还没建立对话通道时，snapshot 里的 connected 是 false。这不是「后台没连上」，
// 点麦克风就会连（health 的 hub 字段说明网关是通的）。文案要区分这两种情况，否则用户会以为设备坏了。
function backendUp() { return !!(ui.update && ui.update.enabled !== undefined) || ui.status.hub === true; }

// 后台活着而这次还没连网关：每次快照后主动问一次 health 的 hub 字段（只读，不改状态），
// 免得提示条一直停在「没连上」这种看起来像故障的文案上。
let hubProbe = 0;
function probeHub() {
  if (DEMO || ui.status.connected || ui.status.hub === true) return;
  if (Date.now() - hubProbe < 15000) return;   // 15 秒内只问一次
  hubProbe = Date.now();
  fetch('/api/health').then(r => (r.ok ? r.json() : null)).then(h => {
    if (!h || typeof h.hub !== 'boolean') return;
    ui.status.hub = h.hub;
    renderStatus();
  }).catch(() => { /* 后台不通：保持原样，下次快照再问 */ });
}

function renderBanner(connected, sleeping, micOff) {
  const el = $('statusBanner');
  if (!el) return;
  // 夜间静音不能只靠服务端的 sleep.active：字段缺失或还没收到快照时，
  // 前端用 22:00-09:00 的本地时钟兜底，保证夜里总能提示到
  const now = new Date();
  const hour = now.getHours();
  const quiet = hour >= 22 || hour < 9;
  const s = ui.status.sleep || {};
  let serverQuiet = !!sleeping;
  if (!('active' in (ui.status.sleep || {})) && s.start && s.end) {
    const [sh, sm] = String(s.start).split(':').map(Number);
    const [eh, em] = String(s.end).split(':').map(Number);
    const cur = hour * 60 + now.getMinutes();
    const a = (sh || 0) * 60 + (sm || 0);
    const b = (eh || 0) * 60 + (em || 0);
    serverQuiet = a < b ? (cur >= a && cur < b) : (cur >= a || cur < b);
  }
  let text = '', tone = 'info';
  if (!connected && !micOff) {
    text = backendUp() ? '准备好了，叫我或点麦克风' : '还没连上后台，点麦克风会重新连';
    tone = backendUp() ? 'info' : 'warn';
  } else if (micOff) {
    text = '麦克风已关，拨开机身侧面开关才能说话';
    tone = 'warn';
  } else if (quiet || serverQuiet) {
    text = '夜间静音时段：只回文字，音乐和回答都不出声';
    tone = 'info';
  } else if (sleeping) {
    text = '睡眠时段，汇报不会自动念';
    tone = 'info';
  }
  el.textContent = text;
  el.dataset.tone = tone;
  el.classList.toggle('show', !!text);
}

function renderStatus() {
  const { state, connected } = ui.status;
  const shown = shownState();
  document.body.dataset.state = shown;
  const text = {
    idle: ['说<em>「小麦小麦」</em>', connected ? '对话还在，唤醒后可以接着聊' : '或者点麦克风；按住可以直接说'],
    connecting: ['正在连接…', '连上小智网关后就开始听'],
    listening: ui.ptt ? ['松开<em>发送</em>', '说完松开手指'] : ['我在听', '说完停一下，我就开始回答'],
    thinking: [`<em>${esc(modelName())}</em> 正在思考`, '复杂的问题可能要想一会儿'],
    speaking: ['正在回答', '喊「小麦小麦」或点打断就能停下'],
  }[shown] || ['', ''];
  if (ui.status.recognising && !ui.ptt) text.splice(0, 2, '正在识别', '你说完了，正在把话转成文字');
  const micOff = ui.status.mic === false;
  document.body.classList.toggle('mic-off', micOff);
  const reports = ui.status.reports || 0;
  const sleeping = !!(ui.status.sleep && ui.status.sleep.active);
  document.body.classList.toggle('has-reports', reports > 0);
  document.body.classList.toggle('sleeping', sleeping);
  $('reportText').textContent = reports > 1 ? `有 ${reports} 条待汇报` : '有一条待汇报';
  if (micOff && shown === 'idle') text.splice(0, 2, '麦克风已关', '拨开机身侧面的开关就能说话');
  else if (reports && shown === 'idle') text[1] = '有待汇报：点右上角收听，或叫一声「小麦小麦」';
  else if (sleeping && shown === 'idle' && !connected) text[1] = '睡眠时段：汇报不会自动念';
  $('title').innerHTML = text[0];
  $('hint').textContent = text[1];
  // recognising, thinking or speaking: the turn can be interrupted (the question is dropped if nothing was said yet)
  $('btnAbort').disabled = !connected || !(state === 'speaking' || state === 'thinking' || (ui.status.recognising && !ui.ptt));
  $('btnEnd').disabled = !connected;
  const link = $('link');
  link.classList.toggle('on', connected);
  link.querySelector('span').textContent = connected ? '对话中' : '待机';
  renderBanner(connected, sleeping, micOff);
  renderSide();
  renderPending();
  setCorona(shown);
  renderSettings();
  renderBright();
  renderScreenOff();
  renderVol();
  renderUpdate();
}

/* ---- models ---- */
const logoSrc = m => (m && m.logo ? `/static/logos/${m.logo}.svg` : '');

function renderModels() {
  const cur = ui.models.current;
  $('pillLogo').src = logoSrc(cur);
  $('pillLabel').textContent = cur ? cur.label : '选择模型';
  $('pillModel').textContent = cur ? (cur.model || cur.company || '') : '';
  const grid = $('grid');
  grid.textContent = '';
  for (const m of ui.models.options) {
    const on = cur && cur.entry === m.entry;
    const b = document.createElement('button');
    b.className = 'card' + (on ? ' on' : '');
    b.innerHTML = `<img class="tile" src="${esc(logoSrc(m))}" alt="">` + (on ? '<span class="badge">使用中</span>' : '') +
      `<span><b>${esc(m.label)}</b><small>${esc(m.model || '')}</small><small class="co">${esc(m.company || '')}</small></span>`;
    b.addEventListener('click', () => switchModel(m));
    grid.appendChild(b);
  }
  renderHead();
}

function openSheet(on) {
  $('sheet').classList.toggle('on', on);
}

// The page switches at once and the hub catches up; if it fails, back to what the client last said.
// While a switch is on its way, the client's events about the old model don't flip the page back.
const server = { models: null, thread: null };
const seenThreads = {};   // entry -> the client's messages for that model, shown at once when switching to it
let switching = null;

async function switchModel(m) {
  openSheet(false);
  if (ui.models.current && ui.models.current.entry === m.entry) return;
  if (DEMO) return demo.switchTo(m);
  switching = m.entry;
  ui.models = Object.assign({}, ui.models, { current: m });
  ui.thread = { entry: m.entry, messages: seenThreads[m.entry] || [] };
  renderModels(); renderThread(); renderStatus();
  let error = null;
  try {
    const r = await (await fetch('/api/model', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                 body: JSON.stringify({ kind: m.kind, vendor: m.vendor, entry: m.entry }) })).json();
    if (r.ok === false) error = r.error || '切换失败';
  } catch (e) {
    error = '切换失败：客户端没有响应';
  }
  if (switching !== m.entry) return;   // another switch since
  switching = null;
  if (server.models) ui.models = server.models;
  if (server.thread) ui.thread = server.thread;
  renderModels(); renderThread(); renderStatus();
  toast(error || `已切换到 ${m.label}`, error ? 'error' : '');
}

/* ---- settings: sleep hours ---- */
const sleepEdit = {};   // changes sent but not yet confirmed by a state event
let sleepTimer = null;
function sleepSetting() {
  return Object.assign({ enabled: false, start: '22:00', end: '07:00', active: false }, ui.status.sleep || {}, sleepEdit);
}
function renderSettings() {
  const s = sleepSetting();
  $('sleepSwitch').setAttribute('aria-checked', String(s.enabled));
  $('sleepTimes').classList.toggle('off', !s.enabled);
  $('sleepStart').textContent = s.start;
  $('sleepEnd').textContent = s.end;
  $('sleepNote').textContent = !s.enabled ? '睡眠时段已关闭：补报一到就念，音量和亮度照常'
    : s.active ? `现在是睡眠时段，到 ${s.end} 结束` : `每天 ${s.start} 到 ${s.end} 是睡眠时段，现在不在`;
}
function sendSleep(changes, delay) {
  Object.assign(sleepEdit, changes);
  renderSettings();
  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(async () => {
    const body = Object.assign({}, sleepEdit);
    if (DEMO) { ui.status.sleep = Object.assign(sleepSetting(), body); for (const k in body) delete sleepEdit[k]; return renderStatus(); }
    try {
      const r = await (await fetch('/api/sleep', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                   body: JSON.stringify(body) })).json();
      if (r.ok === false) toast(r.error || '没保存上', 'error');
    } catch (e) {
      toast('没保存上：客户端没有响应', 'error');
    }
    for (const k in body) if (sleepEdit[k] === body[k]) delete sleepEdit[k];
    renderSettings();
  }, delay);
}
function stepTime(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = ((h * 60 + m + minutes) % 1440 + 1440) % 1440;
  return pad(Math.floor(t / 60)) + ':' + pad(t % 60);
}
$('sleepSwitch').addEventListener('click', () => sendSleep({ enabled: !sleepSetting().enabled }, 0));
for (const b of document.querySelectorAll('.stepper button')) {
  b.addEventListener('click', () => sendSleep({ [b.dataset.k]: stepTime(sleepSetting()[b.dataset.k], Number(b.dataset.d)) }, 600));
}
/* ---- settings: screen brightness (the client hints the system's screen blanker) ---- */
let brightEdit = null;   // the slider's value while the finger is on it or the change is on its way
let brightTimer = null, brightSent = 0, brightDrag = false;
function brightSetting() {
  return Object.assign({ level: 100, dimmed: false }, ui.status.brightness || {},
                       brightEdit === null ? {} : { level: brightEdit, dimmed: false });
}
function renderBright() {
  const b = brightSetting();
  if (brightEdit === null) $('brightRange').value = b.level;
  $('brightRange').style.setProperty('--fill', b.level + '%');
  $('brightNum').textContent = b.level + '%';
  $('brightNote').textContent = b.dimmed ? '睡眠时段内屏幕调暗了；拖一下滑条，这次时段就按你调的亮度'
    : '熄屏再亮也保持这个亮度；也可以说「小麦小麦，屏幕亮一点」「调到最亮」';
}
async function sendBright(body) {
  if (DEMO) { ui.status.brightness = { level: body.level, dimmed: false }; return; }
  try {
    const r = await (await fetch('/api/brightness', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                       body: JSON.stringify(body) })).json();
    if (r.ok === false) toast(r.error || '没保存上', 'error');
  } catch (e) {
    toast('没保存上：客户端没有响应', 'error');
  }
}
// The slider follows the finger itself (pointer events, like the mic button) instead of relying on
// the browser's own range dragging under touch. While dragging: at most one change every 150 ms
// (the blanker looks every 200 ms); the last one on release.
function dragBright(e) {
  const r = $('brightRange').getBoundingClientRect(), thumb = 48;
  brightEdit = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left - thumb / 2) / (r.width - thumb))) * 100);
  $('brightRange').value = brightEdit;
  renderBright();
  clearTimeout(brightTimer);
  const send = () => { brightSent = Date.now(); sendBright({ level: brightEdit }); };
  if (Date.now() - brightSent > 150) send();
  else brightTimer = setTimeout(send, 150);
}
$('brightRange').addEventListener('pointerdown', e => {
  e.preventDefault();
  brightDrag = true;
  try { $('brightRange').setPointerCapture(e.pointerId); } catch (err) { /* keeps following without capture */ }
  dragBright(e);
});
$('brightRange').addEventListener('pointermove', e => {
  if (brightDrag) dragBright(e);
});
function dropBright() {
  if (!brightDrag) return;
  brightDrag = false;
  clearTimeout(brightTimer);
  const level = brightEdit;
  sendBright({ level }).then(() => { if (brightEdit === level) brightEdit = null; renderStatus(); });
}
$('brightRange').addEventListener('pointerup', dropBright);
$('brightRange').addEventListener('pointercancel', dropBright);

/* ---- settings: auto screen-off (the client hints the system's screen blanker) ---- */
const offEdit = {};   // a change on its way
function offSetting() {
  return Object.assign({ enabled: true, minutes: 5 }, ui.status.screen_off || {}, offEdit);
}
function renderScreenOff() {
  const s = offSetting();
  $('offSwitch').setAttribute('aria-checked', String(s.enabled));
  $('offMinutes').classList.toggle('off', !s.enabled);
  for (const b of $('offMinutes').children) b.classList.toggle('on', Number(b.dataset.m) === s.minutes);
  $('offNote').textContent = s.enabled ? `${s.minutes} 分钟没碰屏幕、也没在对话，就熄屏` : '屏幕一直亮着，不会自动熄屏';
}
async function sendScreenOff(changes) {
  Object.assign(offEdit, changes);
  renderScreenOff();
  if (DEMO) { ui.status.screen_off = offSetting(); for (const k in changes) delete offEdit[k]; return renderStatus(); }
  try {
    const r = await (await fetch('/api/screen-off', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                      body: JSON.stringify(changes) })).json();
    if (r.ok === false) toast(r.error || '没保存上', 'error');
  } catch (e) {
    toast('没保存上：客户端没有响应', 'error');
  }
  for (const k in changes) if (offEdit[k] === changes[k]) delete offEdit[k];
  renderScreenOff();
}
$('offSwitch').addEventListener('click', () => sendScreenOff({ enabled: !offSetting().enabled }));
for (const b of $('offMinutes').children) b.addEventListener('click', () => sendScreenOff({ minutes: Number(b.dataset.m) }));

/* ---- settings: volumes (the device's, which the keys and voice change too, and the alarms' own) ---- */
// Same finger-following slider as the brightness: at most one change every 150 ms while dragging, the
// last one on release; what the client says meanwhile doesn't move the thumb under the finger.
function slider(id, numId, get, send) {
  const el = $(id);
  let edit = null, timer = null, sent = 0, drag = false;
  function render() {
    const v = edit === null ? get() : edit;
    if (edit === null && v != null) el.value = v;
    el.style.setProperty('--fill', (v == null ? 0 : v) + '%');
    $(numId).textContent = v == null ? '' : v + '%';
  }
  function move(e) {
    const r = el.getBoundingClientRect(), thumb = 48;
    edit = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left - thumb / 2) / (r.width - thumb))) * 100);
    el.value = edit;
    render();
    clearTimeout(timer);
    const go = () => { sent = Date.now(); send(edit); };
    if (Date.now() - sent > 150) go();
    else timer = setTimeout(go, 150);
  }
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    drag = true;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* keeps following without capture */ }
    move(e);
  });
  el.addEventListener('pointermove', e => { if (drag) move(e); });
  function drop() {
    if (!drag) return;
    drag = false;
    clearTimeout(timer);
    const v = edit;
    Promise.resolve(send(v)).then(() => { if (edit === v) edit = null; render(); });
  }
  el.addEventListener('pointerup', drop);
  el.addEventListener('pointercancel', drop);
  return render;
}
async function postJson(path, body) {
  try {
    const r = await (await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                         body: JSON.stringify(body || {}) })).json();
    if (r.ok === false) toast(r.error || '没保存上', 'error');
    return r;
  } catch (e) {
    toast('没保存上：客户端没有响应', 'error');
    return { ok: false };
  }
}
const renderVol = slider('volRange', 'volNum', () => ui.status.volume,
  v => (DEMO ? (ui.status.volume = v) : postJson('/api/volume', { volume: v })));
const renderAlarmVol = slider('alarmVolRange', 'alarmVolNum', () => ui.alarms.volume,
  v => (DEMO ? (ui.alarms.volume = v) : postJson('/api/alarm-volume', { volume: v })));

/* ---- countdowns, alarms and reminders (alarms.py: the client keeps and rings them) ---- */
const KIND_ICON = { timer: '计时', alarm: '闹钟', reminder: '提醒' };
const now_s = () => Date.now() / 1000;
function hhmm(t) {
  const d = new Date(t * 1000);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function dayText(t) {
  const d = new Date(t * 1000), today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400000);
  return { '-1': '昨天', 0: '今天', 1: '明天', 2: '后天' }[days] || `${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()]}`;
}
function left(t) {
  const s = Math.max(0, Math.round(t - now_s()));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60);
}
function alarmRow(v) {
  if (v.kind === 'timer') {
    return [`<span data-left="${v.at}">${left(v.at)}</span>${v.label ? ' ' + esc(v.label) : ''}`,
            `倒计时，${hhmm(v.at)} 响${v.snoozed ? ' · 再睡中' : ''}`];
  }
  const sub = [dayText(v.at)];
  if (v.repeat) sub.push(esc(v.repeat));
  if (v.snoozed) sub.push('再睡中');
  if (v.kind === 'reminder') sub.push(v.spoken ? '到点念出来' : v.spoken === false ? '只响铃（没合成出语音）' : '正在合成语音');
  return [`${hhmm(v.at)}${v.label ? ' ' + esc(v.label) : ''}`, sub.join(' · ')];
}
function renderAlarms() {
  const a = ui.alarms;
  document.body.classList.toggle('alarms-paused', !a.synced);
  document.body.classList.toggle('ringing', !!a.ringing);
  document.body.classList.toggle('has-timer', a.items.some(v => v.kind === 'timer'));
  // home: the running countdowns and the next alarm or reminder
  const timers = a.items.filter(v => v.kind === 'timer').slice(0, 3);
  const next = a.items.find(v => v.kind !== 'timer');
  const chips = timers.map(v => `<div class="na timer">倒计时 <b data-left="${v.at}">${left(v.at)}</b>${v.label ? esc(v.label) : ''}</div>`);
  if (next) chips.push(`<div class="na">${KIND_ICON[next.kind]} <b>${dayText(next.at)} ${hhmm(next.at)}</b>${esc(next.label || '')}</div>`);
  if (!a.synced && a.items.length) chips.unshift('<div class="na paused">时间未同步，闹钟暂停</div>');
  $('nextAlarms').innerHTML = chips.join('');
  // settings: the list, the tones, the missed ones
  $('alarmCount').textContent = a.items.length ? `${a.items.length} 条` : '';
  $('alarmList').innerHTML = a.items.length ? a.items.map(v => {
    const [main, sub] = alarmRow(v);
    return `<div class="al ${v.kind}"><i>${KIND_ICON[v.kind]}</i><div class="al-text"><b>${main}</b><span>${sub}</span></div>` +
      `<button class="al-del" data-id="${v.id}">删除</button></div>`;
  }).join('') : '<div class="alarm-empty">还没有闹钟和提醒</div>';
  $('tones').innerHTML = Object.entries(a.tones || {}).map(([k, name]) =>
    `<button data-tone="${esc(k)}" class="${k === a.tone ? 'on' : ''}">${esc(name)}</button>`).join('');
  // home: the missed ones (newest first, at most 3 shown) until 知道了
  $('missedBox').hidden = !a.missed.length;
  $('missedList').innerHTML = a.missed.slice(0, 3).map(m =>
    `<div class="mh"><b>${dayText(m.at)} ${hhmm(m.at)}</b>${KIND_ICON[m.kind] || ''}${m.label ? ' · ' + esc(m.label) : ''}` +
    `<small>${m.why === 'off' ? '设备关着' : m.kind === 'reminder' ? '提醒了 3 分钟没人停' : '响了 10 分钟没人停'}</small></div>`).join('') +
    (a.missed.length > 3 ? `<div class="mh more">还有 ${a.missed.length - 3} 条</div>` : '');
  renderAlarmVol();
  renderRing();
  tickAlarms();
}
function renderRing() {
  const r = ui.alarms.ringing;
  if (!r) return;
  const items = r.items || [];
  $('ringKind').textContent = [...new Set(items.map(v => v.type))].join('、') || '闹钟';
  $('ringLabel').textContent = items.map(v => v.label).filter(Boolean).join('、');
  $('ringNote').textContent = (r.notes || []).join('；');
}
function tickAlarms() {
  for (const el of document.querySelectorAll('[data-left]')) el.textContent = left(Number(el.dataset.left));
  const timer = ui.alarms.items.find(v => v.kind === 'timer');
  $('timerText').textContent = timer ? left(timer.at) : '';
}
$('alarmList').addEventListener('click', e => {
  const b = e.target.closest('.al-del');
  if (!b) return;
  if (!b.classList.contains('armed')) {
    b.classList.add('armed');
    b.textContent = '确认删除';
    setTimeout(() => { b.classList.remove('armed'); b.textContent = '删除'; }, 4000);
    return;
  }
  if (DEMO) { ui.alarms.items = ui.alarms.items.filter(v => v.id !== Number(b.dataset.id)); return renderAlarms(); }
  postJson('/api/alarms/delete', { id: Number(b.dataset.id) }).then(r => { if (r.ok) toast('已删除'); });
});
$('tones').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (DEMO) { ui.alarms.tone = b.dataset.tone; return renderAlarms(); }
  postJson('/api/alarm-tone', { tone: b.dataset.tone }).then(() => postJson('/api/alarm-tone', { tone: b.dataset.tone, preview: true }));
});

/* ---- 智能家居（Home Assistant 设备卡片）
   插座/电源类只读：卡片只显示状态、不给按钮（owner 2026-11-05 硬门）。
   可写：media_player 开关与音量、light 开关、非电源类 switch。 ---- */
function deviceIcon(kind) {
  return {
    media: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    switch: '<path d="M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z"/><circle cx="9" cy="12" r="2.5"/>',
    sensor: '<path d="M12 3v2M12 19v2M3 12h2M19 12h2"/><circle cx="12" cy="12" r="4"/><path d="M12 12l3-3"/>',
    climate: '<path d="M12 3v13M9 19a3 3 0 0 0 6 0c0-2-3-4-3-6"/><circle cx="12" cy="16" r="3"/>',
  }[kind] || '<circle cx="12" cy="12" r="8"/>';
}

function deviceText(d) {
  if (d.kind === 'sensor') return d.value === null || d.value === undefined ? '—' : `${d.value}${d.unit || ''}`;
  if (d.state === 'unavailable') return '离线';
  if (d.state === 'unknown') return '未知';
  if (d.kind === 'media') return d.on ? '播放中' : '待机';
  return d.on ? '开' : '关';
}

/* ---- music (top-bar pill + player sheet) ---- */
// [2026-11-10] HomePod 通路已下线（面板不再有按钮）：只保留本机与电视
const MUSIC = { tv: 'media_player.bravia_xr_55x90j' };
// [2026-11-16] 第三个出声位置：客厅 Sony HT-Z9F 音响（hub soundbar_out 经 UPnP 推流）。它和本机一样是 hub 的播放会话：
// 有队列、有进度、能暂停/切歌，所以凡是「本机才有」的判断都用 hubTarget()；只有电视那条是只能放/停的远程通路。
const TARGET_NAME = { local: '本机', tv: '电视', soundbar: '音响' };
const hubTarget = t => t === 'local' || t === 'soundbar';
// volumeByTarget：每个通路各存各的音量。原来 MP.volume 是单一全局值，切到电视拉到
// 电视音量后再切回本机，滑杆显示的是上一个目标的值，一动就把错值写到新目标。
const MP = { target: 'local', queue: [], idx: -1,
             // 本机喇叭上在放的：source=voice 是语音点的（hub 推流），local 是面板自己的播放器
             source: 'local', paused: false, index: null, total: null, desc: '', elapsed: 0, elapsedAt: 0,
             volumeByTarget: { local: 55, tv: 30, soundbar: 20 }, out: 'local', outputSynced: false,
             playing: false, title: '', nowTitle: '', startedAt: 0, volTimer: null, pollFailed: false,
             // 非本机通路的真实状态（从后台查 HA 实体得到）：{state, playing, title, artist}
             remote: { state: '', playing: false, title: '', artist: '' } };
Object.defineProperty(MP, 'volume', {
  // 语音点的歌是网关推流到本机喇叭：滑杆就是设备音量（不是面板播放器自己的 ffplay 音量）
  get() {
    if (this.target === 'local' && this.source === 'voice' && ui.status && typeof ui.status.volume === 'number')
      return ui.status.volume;
    return this.volumeByTarget[this.target];
  },
  set(v) {
    const n = Math.max(0, Math.min(100, Number(v) || 0));
    if (this.target === 'local' && this.source === 'voice' && ui.status) ui.status.volume = n;
    else this.volumeByTarget[this.target] = n;
  },
});

function musicEntity(id) {
  return ((ui.devices && ui.devices.devices) || []).find(d => d.entity_id === id) || null;
}

async function musicApi(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    // 404/500 也要把后台的话带出来，不然前端只能报「音乐接口 404」
    let detail = '';
    try { const j = await r.json(); detail = j.error || j.message || ''; } catch (e) {}
    throw new Error(detail || ('音乐接口 ' + r.status));
  }
  const data = await r.json();
  // 业务失败（HTTP 200 但 ok:false）不能当成功
  return data;
}

function fmtSec(t) {
  t = Math.max(0, Math.round(Number(t) || 0));
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}

// 后台（/api/music/status 或 SSE 'music'）报的本机喇叭状态。语音点的歌也在这里：
// 原来面板只认自己的 ffplay，说「来点古典」放着歌，顶栏还写「放点音乐」，停止键也停不掉。
function applyMusicStatus(s) {
  if (!s) return;
  MP.source = s.source || 'local';
  MP.out = s.out || 'local';
  // 面板第一次拿到状态时，按 hub 记住的出声位置选中按钮（语音说过「用音响放」也会反映过来）
  if (!MP.outputSynced && s.output && MP.target !== 'tv') { MP.target = s.output; MP.outputSynced = true; }
  MP.playing = !!s.playing;
  MP.paused = !!s.paused;
  MP.index = s.index || null;
  MP.total = s.total || null;
  MP.desc = s.desc || '';
  MP.origin = s.origin || '';
  MP.elapsed = Number(s.elapsed) || 0;
  MP.elapsedAt = Date.now();
  if (MP.playing || MP.paused) {
    MP.title = s.title || MP.title;
    MP.nowTitle = s.title ? s.title + (s.artist ? ' — ' + s.artist : '') : MP.nowTitle;
  } else {
    MP.title = ''; MP.nowTitle = '';
  }
  if (MP.source === 'local' && s.path && MP.queue.length) {
    const i = MP.queue.findIndex(t => t.path === s.path);
    if (i >= 0 && i !== MP.idx) { MP.idx = i; renderQueue(); }
  }
  renderMusic();
}

async function refreshMusic() {
  if (DEMO) return;
  try { applyMusicStatus(await musicApi('/api/music/status')); } catch (e) { /* 后台没起来：保持原样 */ }
}

function renderMusic() {
  const tv = musicEntity(MUSIC.tv);
  const tvOn = !!(tv && tv.on);
  const pill = $('musicPill');
  if (!pill) return;

  const active = MP.playing || MP.paused;
  const localOn = MP.playing && hubTarget(MP.target);
  pill.classList.toggle('playing', localOn || tvOn || (MP.source === 'voice' && MP.playing));
  pill.classList.toggle('paused', MP.paused && !MP.playing);
  const count = MP.total > 1 ? ' ' + MP.index + '/' + MP.total : '';
  $('musicTitle').textContent = active ? (MP.title || '在放') : '放点音乐';
  $('musicSub').textContent = !active ? '随机播放'
    : (MP.paused ? '已暂停' : (MP.out === 'soundbar' ? '音响' : TARGET_NAME[MP.target])) +
      (MP.source === 'voice' ? ' · 语音点歌' : '') + count;

  // 音响选择状态
  for (const t of ['local', 'tv', 'soundbar']) {
    const el = $({ local: 'mtLocal', tv: 'mtTv', soundbar: 'mtSoundbar' }[t]);
    if (el) {
      el.classList.toggle('on', MP.target === t);
      el.setAttribute('aria-checked', MP.target === t ? 'true' : 'false');
    }
  }
  const ls = $('mtLocalState');
  if (ls) ls.textContent = MP.playing && MP.out !== 'soundbar' && MP.target === 'local' ? '在放' : '扬声器';
  const sb = $('mtSoundbarState');
  if (sb) sb.textContent = MP.out === 'soundbar' && MP.playing ? '在放' : 'HT-Z9F 外放';
  const ts = $('mtTvState');
  if (ts) {
    const tvLive = tvOn || (MP.target === 'tv' && MP.remote.playing);
    ts.textContent = !tv ? '没接上' : (tv.state === 'unavailable' ? '连不上' : (tvLive ? '开着' : '关着'));
  }

  // 非本机通路：面板标题/副标以 MP.remote 为准。原来只看 MP.playing，
  // 而 MP.playing 只在轮询回来时才更新，切到 HomePod 后要等 4 秒且第一次轮询
  // 失败就永远停在「现在没在放」——设备已经在出声，面板却说没放。
  const remoteLive = MP.target === 'tv' && MP.remote.playing;
  const nowTitle = MP.target === 'tv' ? (MP.remote.title || (remoteLive ? '在放' : ''))
                                     : (active ? (MP.nowTitle || MP.title || '在放') : '');
  const nowPlaying = MP.target === 'tv' ? remoteLive : active;
  const elapsed = MP.elapsed + (MP.playing ? (Date.now() - MP.elapsedAt) / 1000 : 0);

  $('musicNowTitle').textContent = nowPlaying ? (nowTitle || '在放') : '现在没在放';
  $('musicNowSub').textContent = nowPlaying && hubTarget(MP.target)
    ? [MP.paused ? '已暂停' : (MP.out === 'soundbar' ? '在 HT-Z9F 音响播放' : '在本机播放'),
       MP.source === 'voice' ? '语音点的' + (MP.desc && MP.desc !== '随机' ? MP.desc : '') + (MP.total > 1 ? '歌单' : '歌') : '',
       MP.origin === 'youtube' ? 'YouTube Music' : MP.origin === 'nas' ? 'NAS 曲库' : '',
       MP.total > 1 ? '第 ' + MP.index + '/' + MP.total + ' 首' : '',
       fmtSec(elapsed)].filter(Boolean).join(' · ')
    : nowPlaying
    ? ('在 ' + ({ local: 'SmartView 本机', tv: 'SONY 电视', soundbar: 'SONY HT-Z9F 音响' })[MP.target] + ' 播放' +
       (MP.target === 'tv' ? '（这条通路不提供进度）' : ''))
    : (hubTarget(MP.target) ? '点「随机播放」开始' + (MP.target === 'soundbar' ? '，从客厅音响出声' : '')
       : ('点「随机播放」开始' + (MP.remote.state === 'off' ? '（设备现在是待机/关机）'
          : MP.remote.state === 'unavailable' ? '（设备连不上）'
          : MP.remote.state === 'unknown' ? '（还没读到设备状态）' : '')));

  if ($('musicVolume')) $('musicVolume').value = String(MP.volume);
  if ($('musicVolumeText')) $('musicVolumeText').textContent = String(MP.volume);

  // 暂停/继续一个键；上一首/下一首只对本机喇叭（电视那条通路没有队列）
  if ($('musicPauseLocal')) $('musicPauseLocal').textContent = hubTarget(MP.target) && MP.paused ? '继续' : '暂停';
  for (const id of ['musicPrev', 'musicNext']) {
    const b = $(id);
    if (b) b.disabled = hubTarget(MP.target) ? !active && !MP.queue.length : MP.queue.length < 2;
  }

  const prog = document.querySelector('.music-progress');
  // 曲库索引没有时长，原来本机进度条按 240 秒假算：长曲永远到不了头，短曲早早满格。改成只报已放时长
  if (prog) prog.style.display = 'none';
}

function renderQueue() {
  const box = $('musicQueue');
  if (!box) return;
  if (!MP.queue.length) {
    box.innerHTML = '<div class="mq-empty">曲库还没读出来，点「随机播放」会边读边放；也可以搜歌名、歌手或专辑</div>';
    return;
  }
  const firstYt = MP.queue.findIndex(t => t.source === 'youtube');
  box.innerHTML = MP.queue.map((t, i) =>
    (i === firstYt ? '<div class="mq-divider">' + (firstYt ? '曲库之外 · YouTube Music' : '曲库里没有 · YouTube Music 上找到') + '</div>' : '') +
    '<button class="mq-item' + (i === MP.idx ? ' on' : '') + '" data-i="' + i + '" aria-current="' + (i === MP.idx ? 'true' : 'false') + '">' +
    '<b>' + escapeHtml(t.title || '未命名') + (t.source === 'youtube' ? '<span class="mq-src">YouTube</span>' : '') +
    '</b><span>' + escapeHtml(t.artist || '') +
    (t.album ? '<span class="mq-album">' + escapeHtml(t.album) + '</span>' : '') +
    (t.genre_dir ? '<span class="mq-genre">' + escapeHtml(t.genre_dir) + '</span>' : '') + '</button>').join('');
  box.querySelectorAll('.mq-item').forEach(el => {
    el.addEventListener('click', () => playTrack(Number(el.dataset.i)));
  });
}

// 曲库检索：/api/music/tracks 带 q 参数，服务端按歌名/歌手/专辑子串过滤。
// 原来面板只能「随机播放」20 首，18368 首曲库等于没法用。
//

async function searchMusic(q) {
  const box = $('musicQueue');
  if (box) box.innerHTML = '<div class="mq-empty">正在找「' + escapeHtml(q) + '」…</div>';
  try {
    const d = await musicApi('/api/music/tracks?limit=30&q=' + encodeURIComponent(q));
    MP.queue = d.tracks || [];
    MP.idx = -1;
    renderQueue();
    // 曲库之外再查 YouTube Music（网关的助手，搜一次 0.5-1 s，结果缓存一天），接在曲库结果后面
    const seq = (MP.searchSeq = (MP.searchSeq || 0) + 1);
    if (box && !MP.queue.length) box.innerHTML = '<div class="mq-empty">曲库里没有「' + escapeHtml(q) + '」，在 YouTube Music 上找…</div>';
    let yt = [];
    try { yt = (await musicApi('/api/music/ytm?q=' + encodeURIComponent(q))).tracks || []; } catch (e) { yt = []; }
    if (seq !== MP.searchSeq) return;          // 又搜了别的
    if (yt.length) {
      MP.queue = MP.queue.concat(yt.slice(0, 10));
      renderQueue();
    } else if (!MP.queue.length && box) {
      box.innerHTML = '<div class="mq-empty">曲库和 YouTube Music 都没找到「' + escapeHtml(q) + '」，换个词试试</div>';
    }
  } catch (e) {
    if (box) box.innerHTML = '<div class="mq-empty">曲库读不到：' + escapeHtml(e.message) + '</div>';
  }
}

// 风格筛选：按曲库索引里真实的顶层目录（genre_dir）在后台筛。原来是拉几批随机样本、按歌名关键词猜
// （「华语」=几个歌手名、「爵士」=久石让），筛出来常常不对、也常常是空的。
async function filterMusic(kind) {
  const box = $('musicQueue');
  if (box) box.innerHTML = '<div class="mq-empty">正在筛…</div>';
  try {
    const d = await musicApi('/api/music/random?count=40&genre=' + encodeURIComponent(kind));
    MP.queue = d.tracks || [];
    MP.idx = -1;
    if (MP.queue.length) renderQueue();
    else if (box) box.innerHTML = '<div class="mq-empty">这个风格没筛到，点「随机」试试</div>';
  } catch (e) {
    if (box) box.innerHTML = '<div class="mq-empty">筛不到：' + escapeHtml(e.message) + '</div>';
  }
}

async function shuffle() {
  try {
    const d = await musicApi('/api/music/random?count=20');
    MP.queue = d.tracks || [];
    MP.idx = -1;
    renderQueue();
    if (MP.queue.length) await playTrack(0);
  } catch (e) { toast('曲库读取失败'); }
}

async function playTrack(i) {
  const t = MP.queue[i];
  if (!t) return;
  MP.idx = i;
  MP.title = t.title + (t.artist ? ' — ' + t.artist : '');
  renderQueue();
  if (hubTarget(MP.target)) {
    const where = MP.target === 'soundbar' ? '音响' : '本机';
    try {
      const r = await musicApi('/api/music/play', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // 整张列表一起给后台：放完一首自动接下一首（原来只放点的那一首就停）
        body: JSON.stringify({ target: MP.target, title: t.title, volume: MP.volume, index: i,
                               queue: MP.queue.map(x => ({ title: x.title, artist: x.artist, album: x.album, path: x.path, source: x.source })) }),
      });
      if (r && r.ok === false) {
        toast(where + '没放成：' + (r.error || '后台没响应'), 'error');
        MP.playing = false;
        MP.startedAt = 0;
      } else {
        // 点下去要有回音：曲目名/歌手先写进面板，再让轮询去对真实状态
        MP.playing = true;
        MP.paused = false;
        MP.source = MP.target === 'soundbar' ? 'voice' : 'local';
        MP.out = MP.target === 'soundbar' ? 'soundbar' : 'local';
        MP.index = i + 1;
        MP.total = MP.queue.length;
        MP.elapsed = 0; MP.elapsedAt = Date.now();
        MP.startedAt = Date.now();
        MP.nowTitle = t.title + (t.artist ? ' — ' + t.artist : '');
        renderMusic();
        toast(MP.target === 'soundbar' ? '音响上开始放：' + t.title + '（音响要几秒才出声）' : '本机在放：' + t.title, 'info');
      }
    } catch (e) {
      toast(where + '播放失败' + (e && e.message ? '：' + e.message : ''), 'error');
      MP.playing = false;
      MP.startedAt = 0;
    }
  } else {
    // HomePod / 电视走结构化的 /api/music/play，不再把曲名拼成一句话丢给 LLM
    // （原来 musicAsk 走 /api/text，曲名会被当成指令，而且要多跑一轮模型）
    try {
      const r = await musicApi('/api/music/play', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: MP.target, title: t.title }),
      });
      if (r && r.ok === false) {
        toast('没放成：' + (r.error || r.message || '设备没响应'), 'error');
        MP.playing = false;
        MP.startedAt = 0;
      } else {
        MP.playing = true;
        MP.startedAt = Date.now();
      }
    } catch (e) {
      toast('没放成：连不上后台', 'error');
      MP.playing = false;
      MP.startedAt = 0;
    }
  }
  renderMusic();
}

async function stopMusic() {
  try {
    const r = await musicApi('/api/music/stop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: MP.target }),
    });
    if (r && r.ok === false) toast('没停成：' + (r.error || r.message || '设备没响应'), 'error');
  } catch (e) {
    toast('没停成：连不上后台', 'error');
  }
  MP.playing = false;
  MP.startedAt = 0;
  if ($('musicBar')) $('musicBar').style.width = '0%';
  renderMusic();
}

async function pollMusic() {
  if (document.hidden) return;   // 屏幕熄灭/页面在后台就别打后台了
  try {
    if (hubTarget(MP.target)) {
      // 曲名以后台为准：语音点的歌、面板自己的列表自动换到下一首，都靠它更新（音响上放的也在这里）
      applyMusicStatus(await musicApi('/api/music/status'));
      MP.pollFailed = false;
      return;
    } else {
      // 非本机通路：向后台查该通路的真实状态（HA 实体），不要只留一个空进度条
      const s = await musicApi('/api/music/status?target=' + MP.target);
      MP.remote = { state: s.state || '', playing: !!s.playing,
                    title: s.title || '', artist: s.artist || '' };
      // 面板显示的「在放」以设备实际状态为准，不以我们发过指令为准
      MP.playing = MP.remote.playing;
      if (MP.remote.playing) MP.title = MP.remote.title || MP.title;
      if ($('musicBar')) $('musicBar').style.width = '0%';   // 这两条通路拿不到进度
    }
    renderMusic();
  } catch (e) {
    // 后台没起来时不要每 4 秒刷屏：只在状态变化时提示一次
    if (!MP.pollFailed) {
      MP.pollFailed = true;
      toast('音乐状态读不到，后台可能没起来', 'warn');
    }
  }
}

function musicAsk(text) {
  // 语音通路：把话说给小麦
  if (DEMO) { toast('演示模式：' + text); return; }
  postJson('/api/text', { text });
}

if ($('musicPill')) {
  let pollTimer = null;
  const startPoll = () => {
    if (pollTimer) return;
    pollMusic();
    pollTimer = setInterval(pollMusic, 4000);
  };
  const stopPoll = () => {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  };

  $('musicPill').addEventListener('click', async () => {
    renderMusic();
    $('musicSheet').classList.add('on');
    startPoll();
    try {
      const d = await musicApi('/api/music/random?count=20');
      MP.queue = d.tracks || [];
      renderQueue();
    } catch (e) {
      toast('曲库没读出来：' + e.message, 'error');
      renderQueue();
    }
  });
  // 面板关了就停轮询，否则整页生命周期每 4 秒打一次后台
  $('musicClose').addEventListener('click', () => {
    $('musicSheet').classList.remove('on');
    stopPoll();
  });

  document.querySelectorAll('.music-target').forEach(el => {
    el.addEventListener('click', async () => {
      const want = el.dataset.target;
      const before = MP.target;
      MP.target = want;
      // 请求序号：快速连点不同通路时，先发的响应后到会把音量写到错的目标上
      const seq = (MP.targetSeq = (MP.targetSeq || 0) + 1);
      renderMusic();
      // 本机 ⇄ 音响：告诉后台出声位置（hub 记住，语音点歌也按它走），正在放的跟着搬过去
      if (hubTarget(want) && (want === 'soundbar' || before === 'soundbar' || MP.out === 'soundbar')) {
        try {
          const r = await musicApi('/api/music/output', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                          body: JSON.stringify({ target: want }) });
          if (r && r.message) toast(r.message, 'info');
          else if (r && r.ok === false) toast('没切过去：' + (r.error || '后台没响应'), 'error');
        } catch (e) { toast('没切过去：' + (e.message || '连不上后台'), 'error'); }
        setTimeout(refreshMusic, 800);
      }
      // 切到电视时立刻拉一次真实状态：只靠 4 秒轮询会让用户以为没投上
      if (want === 'tv') {
        MP.remote = { state: 'unknown', playing: false, title: '', artist: '' };
        try {
          const s = await musicApi('/api/music/status?target=' + want);
          if (seq !== MP.targetSeq) return;
          MP.remote = { state: s.state || '', playing: !!s.playing,
                        title: s.title || '', artist: s.artist || '' };
        } catch (e) { /* 读不到就保持 unknown，界面会明说还没读到 */ }
        renderMusic();
      }
      // 切目标时拉它当前音量做滑杆初值；读不到就用这个目标自己的默认值，
      // 不要沿用上一个目标的音量（否则一动滑杆就把错值写出去）
      try {
        const v = await musicApi('/api/music/target_volume?target=' + want);
        if (seq !== MP.targetSeq) return;   // 期间又切了，丢掉过期响应
        if (typeof v.volume === 'number') {
          MP.volume = v.volume;
          renderMusic();
        }
      } catch (err) {
        if (seq !== MP.targetSeq) return;
        toast('读不到' + TARGET_NAME[want] +
              '的当前音量，滑杆用默认值', 'warn');
        renderMusic();
      }
    });
  });

  $('musicShuffle').addEventListener('click', shuffle);
  // 曲库检索：回车或点搜索都走 /api/music/tracks?q=
  if ($('musicQuery')) {
    const go = () => {
      const q = ($('musicQuery').value || '').trim();
      if (!q) return shuffle();   // 空词等于随机
      searchMusic(q);
    };
    $('musicSearchBtn').addEventListener('click', go);
    $('musicQuery').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    // 触屏上点输入框必须真的把焦点给进去并弹键盘：kiosk 里 body 关了 user-select，
    // 加上面板是覆盖层，默认点按只会「看着像点了」而没聚焦。
    $('musicQuery').addEventListener('click', () => $('musicQuery').focus());
    $('musicQuery').addEventListener('touchstart', () => { setTimeout(() => $('musicQuery').focus(), 0); }, { passive: true });
  }
  document.querySelectorAll('.mq-chip').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.filter;
      document.querySelectorAll('.mq-chip').forEach(x => x.classList.toggle('on', x === el));
      if (k === 'random') return shuffle();
      filterMusic(k);
    });
  });
  $('musicStopLocal').addEventListener('click', stopMusic);
  // 少儿：电视上放 Alphablocks / Numberblocks（网关挑最近没放过的一集，放完自动接下一集）
  document.querySelectorAll('.kid-btn').forEach(el => {
    el.addEventListener('click', async () => {
      if (el.classList.contains('busy')) return;
      if (DEMO) { toast('演示模式：电视上放 ' + el.dataset.channel); return; }
      el.classList.add('busy');
      toast('正在打开电视…', 'info');
      try {
        const r = await musicApi('/api/music/kids', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: el.dataset.channel }),
        });
        toast(r && r.ok ? (r.message || '电视上开始放了') : '没放成：' + ((r && (r.error || r.message)) || '电视没响应'),
              r && r.ok ? 'info' : 'error');
      } catch (e) {
        toast('没放成：' + (e.message || '连不上后台'), 'error');
      } finally {
        el.classList.remove('busy');
      }
    });
  });
  // 本机喇叭上的控制（语音点的歌和面板自己的列表都走 /api/music/control，后台分给 hub 或本机播放器）
  async function musicControl(action) {
    if (DEMO) { toast('演示模式：' + action); return; }
    try {
      const r = await musicApi('/api/music/control', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (r && r.ok === false) toast(r.error || '没成功', 'warn');
    } catch (e) {
      toast(e.message || '连不上后台', 'error');
    }
    setTimeout(refreshMusic, 600);
  }
  // 暂停和停止分开：暂停记住位置，「继续」从那里接着放（原来两个键都是停止）
  $('musicPauseLocal').addEventListener('click', async () => {
    if (MP.target === 'tv') {
      // 电视那条通路没有独立的 pause 语义，明确告知而不是静默当暂停
      toast('这条通路只能停止，暂停请用电视自己的遥控', 'info');
      return stopMusic();
    }
    await musicControl(MP.paused ? 'resume' : 'pause');
  });
  const skipTo = step => {
    if (hubTarget(MP.target) && (MP.playing || MP.paused)) return musicControl(step > 0 ? 'next' : 'prev');
    if (MP.queue.length) return playTrack(((MP.idx < 0 ? 0 : MP.idx + step) + MP.queue.length) % MP.queue.length);
  };
  if ($('musicPrev')) $('musicPrev').addEventListener('click', () => skipTo(-1));
  if ($('musicNext')) $('musicNext').addEventListener('click', () => skipTo(1));
  $('musicVolume').addEventListener('input', (e) => {
    MP.volume = Number(e.target.value);
    $('musicVolumeText').textContent = String(MP.volume);
    // 电视音量是步进逼近（每次 volume_up/down 改 2 格），拖动时每像素都发会把电视打爆，
    // 所以先只更新界面，停手 350ms 后才真下发
    clearTimeout(MP.volTimer);
    MP.volTimer = setTimeout(() => setVolume(MP.volume), 350);
  });
  $('musicVolume').addEventListener('change', (e) => {
    clearTimeout(MP.volTimer);
    setVolume(Number(e.target.value));
  });

  // 面板首次打开才启动轮询；页面隐藏时 pollMusic 自己会跳过
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if ($('musicSheet') && $('musicSheet').classList.contains('on')) startPoll();
  });
}

function renderDevices() {
  const box = $('deviceList');
  if (!box) return;
  const list = (ui.devices && ui.devices.devices) || [];
  const err = ui.devices && ui.devices.error;
  $('deviceCount').textContent = err ? '' : (list.length ? `${list.length} 个` : '');
  $('deviceWarn').hidden = !err;
  $('deviceWarn').textContent = err || '';
  if (!list.length) { box.innerHTML = err ? '' : '<div class="alarm-empty">还没有智能设备，先在家庭里接上米家或 Home Assistant</div>'; return; }
  // 按房间分组，没房间的排最后
  const groups = new Map();
  for (const d of list) {
    const k = d.room || '其他';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  box.innerHTML = [...groups.entries()].map(([room, items]) =>
    `<div class="dev-room">${esc(room)}</div>` + items.map(d => {
      const ro = d.readonly || d.state === 'unavailable';
      const cls = ['dev', d.on ? 'on' : '', ro ? 'ro' : ''].filter(Boolean).join(' ');
      const btn = ro
        ? `<span class="dev-ro">${d.readonly ? '只读' : '离线'}</span>`
        : `<button class="switch dev-sw" role="switch" aria-checked="${d.on}" aria-label="${esc(d.name)}" data-entity="${esc(d.entity_id)}" data-action="${d.on ? 'turn_off' : 'turn_on'}"><i></i></button>`;
      return `<div class="${cls}" data-entity="${esc(d.entity_id)}">` +
        `<i class="dev-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${deviceIcon(d.kind)}</svg></i>` +
        `<div class="dev-text"><b>${esc(d.name)}</b><span>${esc(deviceText(d))}</span></div>` + btn + '</div>';
    }).join('')).join('');
}

$('deviceList').addEventListener('click', e => {
  const b = e.target.closest('.dev-sw');
  if (!b) return;
  const entity = b.dataset.entity;
  const action = b.dataset.action;
  if (DEMO) {
    const d = (ui.devices.devices || []).find(v => v.entity_id === entity);
    if (d) { d.on = action === 'turn_on'; d.state = d.on ? 'on' : 'off'; }
    return renderDevices();
  }
  // 乐观切换，失败回退
  const d = (ui.devices.devices || []).find(v => v.entity_id === entity);
  const was = d ? d.on : false;
  if (d) { d.on = action === 'turn_on'; d.state = d.on ? 'on' : 'off'; }
  renderDevices();
  postJson('/api/device/set', { entity_id: entity, action }).then(r => {
    if (!r.ok) {
      if (d) { d.on = was; d.state = was ? 'on' : 'off'; }
      renderDevices();
    }
  });
});
$('missedClear').addEventListener('click', () => (DEMO ? handlers.alarms(Object.assign({}, ui.alarms, { missed: [] }))
                                                       : postJson('/api/alarms/missed/clear')));
$('ringStop').addEventListener('click', () => post('/api/alarms/stop'));
$('ringSnooze').addEventListener('click', () => {
  if (DEMO) return post('/api/alarms/snooze');
  postJson('/api/alarms/snooze').then(r => { if (r.ok) toast('好的，10 分钟后再叫你'); });   // postJson shows the error
});

/* ---- settings: software update (update.py: the root updater installs, the page only asks) ---- */
const UPD_STAGE = { preparing: '正在准备', downloading: '正在下载', installing: '正在安装',
                    testing: '正在重启并自检', rolling_back: '自检没通过，正在退回' };
let updArmed = 0;   // first tap on 更新 arms it, a second one within 5 s installs
const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
function ago(t) {
  const m = Math.max(0, Math.round((Date.now() / 1000 - t) / 60));
  return m < 2 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`;
}
function renderUpdate() {
  const u = ui.update || {}, job = u.job || {}, avail = u.available;
  const busy = job.state in UPD_STAGE;
  const recent = !!job.time && Date.now() / 1000 - job.time < 86400;
  const failed = !busy && recent && (job.state === 'failed' || job.state === 'rolled_back');
  const cur = ui.version ? `当前版本 ${ui.version}` : '';
  let title = '软件更新', text, bad = false, label = '', notes = [];
  if (!u.enabled) text = (cur ? cur + '。' : '') + '这台设备还没装更新服务';
  else if (busy) {
    title = `正在更新到 ${job.version}`;
    const pct = job.state === 'downloading' && job.progress != null ? ` ${Math.round(job.progress * 100)}%` : '';
    text = `${UPD_STAGE[job.state]}${pct}。语音助手会暂停一会儿，请不要断电`;
  } else if (avail) {
    title = `有新版本 ${avail.version}`;
    text = failed ? job.message + '。可以再试一次' : `${cur}，下载约 ${mb(avail.size)}`;
    bad = failed;
    notes = avail.notes || [];
    label = Date.now() - updArmed < 5000 ? '确认更新' : '更新';
  } else {
    text = recent && job.state === 'done' ? `${job.message}，已是最新`
      : failed ? job.message
      : u.check_error ? `${cur}。${u.check_error}` : `${cur}，已是最新` + (u.checked ? `（${ago(u.checked)}检查过）` : '');
    bad = failed || (!!u.check_error && !(recent && job.state === 'done'));
    label = '检查更新';
  }
  $('upd').classList.toggle('new', !!avail && !busy);
  $('gearDot').classList.toggle('on', !!avail && !busy);
  $('updTitle').textContent = title;
  $('updSub').textContent = text;
  $('updSub').classList.toggle('bad', !!bad);   // toggle(x, undefined) would flip it
  $('updNotes').innerHTML = notes.map(n => `<li>${esc(n)}</li>`).join('');
  const btn = $('updBtn');
  btn.hidden = !label;
  btn.textContent = label;
  btn.disabled = !!avail && ui.status.state !== 'idle';   // not in the middle of a conversation
  $('updBar').hidden = !busy;
  $('updBar').classList.toggle('busy', busy && job.state !== 'downloading');
  $('updFill').style.transform = job.state === 'downloading' ? `scaleX(${job.progress || 0})` : '';
}
function updateFinished(job) {
  // once per install, also when the page reloaded because the client restarted with the new version
  if (!job || !(job.state === 'done' || job.state === 'rolled_back' || job.state === 'failed')) return;
  if (Date.now() / 1000 - job.time > 300) return;
  try { if (localStorage.getItem('updShown') === String(job.time)) return; localStorage.setItem('updShown', String(job.time)); } catch (e) { /* no storage */ }
  toast(job.message, job.state === 'done' ? '' : 'error');
}
$('updBtn').addEventListener('click', async () => {
  const avail = (ui.update || {}).available;
  if (!avail) {
    if (DEMO) return toast('正在检查更新…');
    const r = await (await post('/api/update/check'))?.json?.();
    return toast(r && r.ok ? '正在检查更新…' : '这台设备还没装更新服务', r && r.ok ? '' : 'error');
  }
  if (Date.now() - updArmed > 5000) {
    updArmed = Date.now();
    renderUpdate();
    setTimeout(renderUpdate, 5100);
    return toast('更新时语音助手会停一会儿（约 1 分钟），再点一下「确认更新」开始');
  }
  updArmed = 0;
  if (DEMO) return toast('演示模式不会真的安装');
  const r = await (await post('/api/update/install', { version: avail.version }))?.json?.();
  if (!r || !r.ok) toast((r && r.error) || '没能开始更新', 'error');
});
if (DEMO !== null) {
  // ?demo&upd=new|busy|failed: preview the update card (opens the settings sheet)
  const kind = new URLSearchParams(location.search).get('upd');
  const avail = { version: '0.2.0', size: 9.4 * 1048576, notes: ['聊天页的光球加了表情', '修好了睡眠时段跨午夜时不生效'] };
  const now = Date.now() / 1000;
  ui.version = '0.1.0';
  ui.update = { enabled: true, checked: now - 3600, available: kind ? avail : null,
                job: kind === 'busy' ? { state: 'downloading', version: '0.2.0', progress: .42, time: now }
                   : kind === 'failed' ? { state: 'rolled_back', version: '0.2.0', time: now,
                                           message: '0.2.0 自检没通过（新版本连不上小智网关），已退回 0.1.0' } : null };
  if (kind) $('settings').classList.add('on');
}

/* ---- settings: chat history (kept on the hub; clearing also clears the hub's copy) ---- */
let clearArmed = 0, memArmed = 0;   // first tap arms a button, a second one within 5 s clears
function renderClear() {
  $('clearBtn').textContent = Date.now() - clearArmed < 5000 ? '确认清除' : '清除';
  $('clearBtn').classList.toggle('armed', Date.now() - clearArmed < 5000);
  $('clearMemBtn').textContent = Date.now() - memArmed < 5000 ? '确认只清除记忆' : '只清除记忆、保留记录';
  $('clearMemBtn').classList.toggle('armed', Date.now() - memArmed < 5000);
}
function agentNote(r) {
  // Claude Code and Grok Bot keep their own context: clearing here doesn't touch it
  return (r.agents || []).length ? `${r.agents.join('和')}自己那边的对话没有动` : '';
}
$('clearBtn').addEventListener('click', async () => {
  if (Date.now() - clearArmed > 5000) {
    clearArmed = Date.now();
    renderClear();
    setTimeout(renderClear, 5100);
    return toast('清除后所有模型的聊天记录都会删掉，再点一下「确认清除」');
  }
  clearArmed = 0;
  renderClear();
  if (DEMO !== null) { handlers.thread({ entry: ui.thread.entry, messages: [] }); return toast('聊天记录已清除'); }
  const r = await (await post('/api/history/clear', {}))?.json?.();
  if (!r || !r.ok) return toast((r && r.error) || '没能清除', 'error');
  const note = agentNote(r);
  toast('聊天记录已清除' + (note ? '。' + note : ''));
});
$('clearMemBtn').addEventListener('click', async () => {
  if (Date.now() - memArmed > 5000) {
    memArmed = Date.now();
    renderClear();
    setTimeout(renderClear, 5100);
    return toast('模型会忘掉以前聊过的，聊天记录留着；再点一下「确认只清除记忆」');
  }
  memArmed = 0;
  renderClear();
  if (DEMO !== null) return toast('记忆已清除，聊天记录还在');
  const r = await (await post('/api/history/clear', { memory_only: true }))?.json?.();
  toast(r && r.ok ? '记忆已清除，聊天记录还在' : (r && r.error) || '没能清除', r && r.ok ? '' : 'error');
});
renderClear();

// The device's address, read each time the sheet opens (it can change with the WiFi)
async function renderIp() {
  let ip = DEMO !== null ? '192.168.1.23' : null;
  if (DEMO === null) {
    try { ip = (await (await fetch('/api/network')).json()).ip; } catch (e) { ip = null; }
  }
  $('ipNum').textContent = ip || '未联网';
  $('ipSub').textContent = ip ? `在同一网络的电脑上打开 http://${ip}:16688/admin 进网关后台` : '连上 WiFi 后这里显示设备的地址';
}
$('btnSettings').addEventListener('click', () => { $('settings').classList.add('on'); renderIp(); });

// 关机: halts the system (it stays dark with the power cable in), so unplugging can't damage it
let powerArmed = 0;
function renderPower() {
  $('powerBtn').textContent = Date.now() - powerArmed < 5000 ? '确认关机' : '关机';
  $('powerBtn').classList.toggle('armed', Date.now() - powerArmed < 5000);
}
$('powerBtn').addEventListener('click', async () => {
  if (Date.now() - powerArmed > 5000) {
    powerArmed = Date.now();
    renderPower();
    setTimeout(renderPower, 5100);
    return toast('关机后要拔掉电源，等 30 秒再插上才会开机，再点一下「确认关机」');
  }
  powerArmed = 0;
  renderPower();
  if (DEMO !== null) return toast('演示模式不会真的关机');
  const r = await (await post('/api/power-off', {}))?.json?.();
  if (!r || !r.ok) toast((r && r.error) || '没能关机', 'error');
});
$('settingsClose').addEventListener('click', () => {
  $('settings').classList.remove('on');
  if (!DEMO) postJson('/api/alarm-tone', { stop: true });   // a tone being tried stops with the settings
});
$('reportPill').addEventListener('click', () => { post('/api/reports/play'); toast('马上念给你听'); });

/* ---- right side: welcome screen or conversation ---- */
// The welcome screen (clock) when idle with nothing going on: no messages yet, or the conversation
// is over (the hub closed the connection). The hub keeps the history, so the thread is rarely empty;
// it comes back with the chat page on the next wake. While the connection lasts (~2 minutes) the
// chat page stays. A new conversation shows the chat (and its "listening" bubble) from the wake on.
function welcomeShown(messages, state, connected) {
  return ['idle', 'connecting'].includes(state) && (!messages || !connected);
}
function renderSide() {
  document.body.classList.toggle('fresh', welcomeShown(ui.thread.messages.length, shownState(), !!ui.status.connected));
}

function entryModel(entry) {
  return ui.models.options.find(o => o.entry === entry) || ui.models.current;
}

function renderHead() {
  const m = entryModel(ui.thread.entry);
  $('headLogo').src = logoSrc(m);
  $('headTitle').textContent = m ? `与 ${m.label} 的对话` : '对话';
  const n = ui.thread.messages.length;
  $('headMeta').textContent = n ? `${n} 条消息 · ${ui.status.connected ? '对话中' : '记录已保存'}` : '新对话';
}

function fmtTime(t) {
  const d = new Date(t * 1000);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// A reply grows sentence by sentence; the text just shows as it is (no per-sentence highlight)
function fillMsg(el, m) {
  const html = esc(m.text) + (m.interrupted ? '<span class="cut">已打断</span>' : '') + `<span class="ts">${fmtTime(m.time)}</span>`;
  if (m.role === 'bot') el.querySelector('.body').innerHTML = html;
  else el.innerHTML = html;
}

function msgEl(m) {
  const el = document.createElement('div');
  el.className = 'msg ' + m.role;
  el.dataset.id = m.id;
  if (m.role === 'bot') {
    el.innerHTML = `<img class="tile" src="${esc(logoSrc(entryModel(m.entry)))}" alt=""><div class="body"></div>`;
  }
  fillMsg(el, m);
  return el;
}

function scrollDown() {
  const box = $('messages');
  box.scrollTop = box.scrollHeight;
}

function renderThread() {
  const box = $('messages');
  box.textContent = '';
  for (const m of ui.thread.messages) {
    const el = msgEl(m);
    el.style.animation = 'none';
    box.appendChild(el);
  }
  markLive();
  renderHead();
  renderSide();
  renderPending();
  scrollDown();
}

function upsertMessage(m) {
  if (m.entry !== ui.thread.entry) return;
  const i = ui.thread.messages.findIndex(x => x.id === m.id);
  const box = $('messages');
  if (i >= 0) {
    ui.thread.messages[i] = m;
    const el = box.querySelector(`[data-id="${m.id}"]`);
    if (el) fillMsg(el, m);
  } else {
    ui.thread.messages.push(m);
    box.insertBefore(msgEl(m), $('pending'));
  }
  markLive();
  renderHead();
  renderSide();
  scrollDown();
}

function markLive() {
  // the reply being spoken right now: its logo gets a ring
  const box = $('messages');
  box.querySelectorAll('.live').forEach(el => el.classList.remove('live'));
  const last = ui.thread.messages[ui.thread.messages.length - 1];
  if (ui.status.state === 'speaking' && last && last.role === 'bot') {
    const el = box.querySelector(`[data-id="${last.id}"]`);
    if (el) el.classList.add('live');
  }
}

// Placeholder at the end of the conversation while the user talks or the model thinks
function renderPending() {
  const shown = shownState();
  // recognising: the user stopped and the hub is turning it into text (it can take a few seconds)
  const kind = ui.status.recognising && !ui.ptt ? 'user recog' : shown === 'listening' ? (ui.ptt ? 'user ptt' : 'user') :
    shown === 'thinking' ? 'bot' : '';
  let el = $('pending');
  if (el && el.dataset.kind === kind) return;
  if (el) el.remove();
  if (!kind) return;
  el = document.createElement('div');
  el.id = 'pending';
  el.dataset.kind = kind;
  el.className = 'msg pending ' + kind;
  if (kind.startsWith('user')) {
    el.innerHTML = `<span class="wave">${'<b></b>'.repeat(5)}</span>${kind === 'user recog' ? '正在识别…' : ui.ptt ? '说完松开' : '正在听…'}`;
  } else {
    el.innerHTML = `<img class="tile" src="${esc(logoSrc(entryModel(ui.thread.entry)))}" alt="">` +
      `<div class="body"><span class="dots"><i></i><i></i><i></i></span><span class="label">正在思考</span></div>`;
  }
  $('messages').appendChild(el);
  scrollDown();
}

/* ---- 音量下发：失败要让人看得见，不能默默吞掉 ---- */
// 同一个目标连着发同一个音量只算一次：电视是步进逼近，每多一次就多按几次遥控，
// 手指在滑杆上抖动不该把电视打爆。进行中的那个请求也记下来，重复点直接复用它的结果。
const volSending = {};
async function setVolume(v) {
  const want = Math.max(0, Math.min(100, Number(v) || 0));
  const target = MP.target;
  MP.volume = want;
  $('musicVolumeText').textContent = String(want);
  const key = target + ':' + want;
  if (volSending[key]) return volSending[key];
  const job = (async () => {
    try {
      const r = await musicApi('/api/music/volume', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, volume: want }),
      });
      if (r && r.ok === false) {
        toast('音量没改成：' + (r.error || '设备没响应'), 'error');
        return;
      }
      // 电视走步进逼近，界面用写入值乐观更新（固件回读不准，不能拿回读覆盖）
      if (r && typeof r.steps === 'number' && r.steps > 0) {
        showVolume(want);
      }
    } catch (err) {
      toast('音量没改成：连不上后台', 'error');
    } finally {
      delete volSending[key];
    }
  })();
  volSending[key] = job;
  return job;
}

/* ---- overlays ---- */
let toastTimer = null;
function toast(text, kind) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast on' + (kind === 'error' ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast' + (kind === 'error' ? ' error' : ''); }, kind === 'error' ? 4500 : 2500);
}

let hudTimer = null;
function showVolume(v) {
  $('hudFill').style.transform = `scaleX(${Math.max(0, Math.min(100, v)) / 100})`;
  $('hudNum').textContent = v;
  $('hud').classList.add('on');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => $('hud').classList.remove('on'), 1600);
}

/* ---- events from the client ---- */
const handlers = {
  snapshot(s) {
    if (ui.build && s.build && s.build !== ui.build) return location.reload();   // client restarted (deployed)
    ui.build = s.build;
    ui.status = s.status; ui.models = server.models = s.models; ui.thread = server.thread = s.thread;
    switching = null;
    for (const k in seenThreads) delete seenThreads[k];
    seenThreads[s.thread.entry] = s.thread.messages;
    seenEvents.clear();   // 新的一次连接：旧连接里记下的「已处理」不能再拦新事件
    if (s.update) { ui.version = s.version; ui.update = s.update; }   // the demo's snapshots have none
    if (s.alarms) ui.alarms = s.alarms;
    if (s.devices) ui.devices = s.devices;
    renderModels(); renderThread(); renderStatus(); renderAlarms(); renderDevices();
    refreshMusic();
    updateFinished((s.update || {}).job);
    probeHub();
  },
  power(p) {
    $('powerOff').classList.toggle('on', p.state === 'off');
  },
  update(u) {
    ui.update = u;
    renderUpdate();
    updateFinished(u.job);
  },
  state(s) {
    ui.status = s; renderStatus(); markLive(); renderHead();
  },
  model(m) {
    server.models = m;
    if (switching && (!m.current || m.current.entry !== switching)) return;
    ui.models = m; renderModels(); renderStatus();
  },
  thread(t) {
    server.thread = t;
    if (t.reset) { for (const k in seenThreads) delete seenThreads[k]; seenEvents.clear(); }   // cleared, or the hub's history loaded
    seenThreads[t.entry] = t.messages;
    if (switching && t.entry !== switching) return;
    ui.thread = t; renderThread();
  },
  message: m => upsertMessage(m),
  homework: e => hwEvent(e),
  family: f => famApply(f),
  say: x => { speakText(x.text, x.language); toast(x.text); },
  card: c => cardShow(c),
  study: x => stOpen(x.mode, x),
  study_answer: d => studyVoice(d),
  music: m => { if (hubTarget(MP.target)) applyMusicStatus(m); },
  toast: t => toast(t.text, t.kind),
  volume(v) {
    // a ring's own volume (keys while it rings) is shown, but isn't the device volume
    // 本机只有一个音量（2026-11-16）：设备音量变了，音乐面板「本机」的滑杆跟着走
    if (!v.ring) { ui.status.volume = v.volume; if (MP.target === 'local') MP.volume = v.volume; renderVol(); renderMusic(); }
    if (v.source !== 'page') showVolume(v.volume);
  },
  alarms(a) {
    ui.alarms = a; renderAlarms();
  },
  devices(d) {
    ui.devices = d; renderDevices(); renderMusic();
  },
  level(l) {
    level.target = ui.status.state === 'speaking' ? Math.min(1, l.out * 6) : micLevel(l.mic);
  },
};

// 每条事件的身份：能唯一指认「这件事」的字段才算。同一件事重放（重连、服务端重发）
// 只处理一次；拿不到身份的事件一律照常处理，宁可多处理也不吞掉真的新事件。
function eventKey(name, d) {
  const j = o => JSON.stringify(o);
  switch (name) {
    case 'message': return d && d.id ? 'message:' + d.id + ':' + j(d) : null;
    case 'thread': return d && d.reset ? 'thread:reset' : null;      // 只去重「清空」这种一次性事件
    case 'alarms': return d && d.ringing ? 'ringing:' + j(d.ringing) : null;
    case 'devices': case 'model': case 'volume': case 'update': case 'power': case 'snapshot':
      return name + ':' + j(d);                                      // 整份状态：重复到达就是没变
    case 'toast': return 'toast:' + j(d);
    default: return null;                                            // state / level：每次都要刷新
  }
}

function connectEvents() {
  const es = new EventSource('/events');
  for (const [name, fn] of Object.entries(handlers)) {
    es.addEventListener(name, e => {
      const d = JSON.parse(e.data);
      const key = eventKey(name, d);
      if (key && !once(key)) return;
      fn(d);
    });
  }
}

/* ---- buttons ---- */
function post(path, body) {
  if (DEMO) return demo.action(path, body);
  const opts = { method: 'POST' };
  if (body) Object.assign(opts, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return fetch(path, opts).catch(() => toast('客户端没有响应', 'error'));
}

// Mic: a tap wakes (or interrupts a reply and listens); holding it is push-to-talk
let holdTimer = null;
function pttStart() {
  ui.ptt = true;
  $('btnMic').classList.add('hold');
  renderStatus();
}
function pttEnd() {
  ui.ptt = false;
  $('btnMic').classList.remove('hold');
  renderStatus();
}
$('btnMic').addEventListener('pointerdown', e => {
  e.preventDefault();
  holdTimer = setTimeout(() => {
    holdTimer = null;
    pttStart();
    post('/api/ptt/start');
  }, 350);
});
function release() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
    post('/api/wake');
  } else if (ui.ptt) {
    pttEnd();
    post('/api/ptt/stop');
  }
  // 幂等：两个事件都会来，清干净后重复调用什么都不做
}
$('btnMic').addEventListener('pointerup', release);
$('btnMic').addEventListener('pointercancel', release);
// 原来 pointerleave 只在 ui.ptt 为真时才 release：短按（<350ms）滑出按钮时 ui.ptt 还是 false，
// holdTimer 不会被取消，350ms 后照样触发 pttStart，麦克风进录音且没有对应的 stop → 卡在 listening。
// 所以滑出必须无条件 release，并补 pointerout（部分浏览器滑出只发这个）。
$('btnMic').addEventListener('pointerleave', release);
$('btnMic').addEventListener('pointerout', release);
// 指针在按钮外抬起也要收尾（手指按下后移到别处松手）
document.addEventListener('pointerup', () => { if (holdTimer || ui.ptt) release(); });
// 键盘可达：kiosk 场景用不了触摸时，空格/回车也能说话
$('btnMic').addEventListener('keydown', e => {
  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
    e.preventDefault();
    if (!holdTimer && !ui.ptt) {
      holdTimer = setTimeout(() => { holdTimer = null; pttStart(); post('/api/ptt/start'); }, 350);
    }
  }
});
$('btnMic').addEventListener('keyup', e => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); release(); }
});
$('btnAbort').addEventListener('click', () => post('/api/abort'));
$('btnEnd').addEventListener('click', () => { post('/api/end'); toast('对话已结束，聊天记录已保存'); });
$('modelPill').addEventListener('click', () => openSheet(true));
$('sheetClose').addEventListener('click', () => openSheet(false));
document.addEventListener('contextmenu', e => e.preventDefault());

for (const [name] of SCENES) {
  const t = document.createElement('button');
  t.className = 'scene-tab';
  t.type = 'button';
  t.textContent = name;
  t.setAttribute('role', 'tab');
  t.addEventListener('click', () => {
    ui.scene = SCENES.findIndex(s => s[0] === name);
    ui.scenePicked = Date.now();
    renderChips();
    // 「看作业」这一栏不是话术：点标签就把面板打开并拍一张（摄像头是设备内置的，不用手机扫码）
    if (name === '看作业') hwOpen(true, false);   // 同上：先看实时画面，摆好再点「拍作业」
  });
  $('sceneTabs').appendChild(t);
}

// 按时段默认场景：21:00-06:00 是「夜间」（晚安/调暗/定闹钟），其余「日常」。
// 用户自己点过标签的 10 分钟内不跟着时间改，免得刚选的组被换走。
const SCENE_NIGHT = SCENES.findIndex(s => s[0] === '夜间');
function sceneForNow(d = new Date()) {
  const h = d.getHours();
  return (h >= 21 || h < 6) && SCENE_NIGHT >= 0 ? SCENE_NIGHT : 0;
}
function followClock() {
  if (DEMO !== null) return;                       // ?demo=<scene> 预览由 demo 自己切
  if (ui.scenePicked && Date.now() - ui.scenePicked < 10 * 60e3) return;
  const want = sceneForNow();
  if (want !== ui.scene) { ui.scene = want; renderChips(); }
}
ui.scene = DEMO === null ? sceneForNow() : 0;
renderChips();
setInterval(followClock, 60e3);

/* ---- demo: fake client for previewing the page on a desktop browser ---- */
const demo = DEMO === null ? null : (() => {
  const M = (label, model, logo, company, vendor) => ({ kind: 'llm', vendor, label, model, logo, company, entry: 'llm:' + vendor });
  const options = [
    M('Claude', 'claude-sonnet-4-5', 'claude-color', 'Anthropic', 'claude'),
    M('DeepSeek', 'deepseek-chat', 'deepseek-color', 'DeepSeek', 'deepseek'),
    M('通义千问', 'qwen-max', 'qwen-color', '阿里通义', 'qwen'),
    M('豆包', 'doubao-1.5-pro', 'doubao-color', '字节豆包', 'doubao'),
    M('Gemini', 'gemini-2.5-flash', 'gemini-color', 'Google', 'gemini'),
    M('Kimi', 'kimi-k2', 'kimi-color', '月之暗面', 'kimi'),
    M('GPT', 'gpt-4.1', 'openai', 'OpenAI', 'openai'),
    M('智谱 GLM', 'glm-4.6', 'zhipu-color', '智谱', 'glm'),
  ];
  let seq = 0, bot = null, timer = null, stopped = false;
  const threads = {};
  const entry = () => ui.models.current.entry;
  const now = () => Date.now() / 1000;
  const state = (s, connected = true) => handlers.state({ state: s, connected, uploading: s === 'listening' });
  const say = (role, text) => {
    const m = { id: ++seq, role, text, time: now(), entry: entry() };
    (threads[m.entry] = threads[m.entry] || []).push(m);
    handlers.message({ ...m });
    return m;
  };
  const sentence = text => {
    if (!bot) { state('speaking'); bot = say('bot', text); return; }
    bot.text += text;
    handlers.message({ ...bot });
  };
  const done = (cut) => {
    if (bot && cut) { bot.interrupted = true; handlers.message({ ...bot }); }
    bot = null;
  };

  // fake microphone / speaker levels: syllable-like bursts
  setInterval(() => {
    const t = performance.now() / 1000;
    const v = Math.max(0, Math.abs(Math.sin(t * 6.3)) * (.55 + .45 * Math.sin(t * 1.7)) + (Math.random() - .5) * .25);
    handlers.level({ mic: v * .07, out: v * .17 });
  }, 100);

  const tones = { coffee: '咖啡时光', morning: '晨曦', bright: '元气早晨', hop: '阳光小跳跃', marimba: '清晨木琴' };
  const devicesDemo = () => ({
    homes: ['家'], error: null,
    devices: [
      { entity_id: 'media_player.ht_z9f', name: 'SONY 音响', room: '客厅', kind: 'media', state: 'off', on: false, readonly: false, unit: '', value: null },
      { entity_id: 'sensor.temp', name: '温湿度计', room: '客厅', kind: 'sensor', state: '30', on: false, readonly: true, unit: '°C', value: '30' },
      { entity_id: 'sensor.hum', name: '湿度', room: '客厅', kind: 'sensor', state: '75.4', on: false, readonly: true, unit: '%', value: '75.4' },
      { entity_id: 'switch.chuangmi_plug', name: 'NAS 插座', room: '客厅', kind: 'switch', state: 'on', on: true, readonly: true, unit: '', value: null },
      { entity_id: 'light.desk', name: '书桌灯', room: '书房', kind: 'light', state: 'off', on: false, readonly: false, unit: '', value: null },
    ],
  });
  const alarmsDemo = () => ({
    synced: true, volume: 70, tone: 'coffee', tones, ringing: null,
    items: [
      { id: 3, kind: 'timer', type: '倒计时', label: '煮鸡蛋', at: now() + 271, repeat: '', snoozed: false },
      { id: 1, kind: 'alarm', type: '闹钟', label: '起床', at: now() + 9 * 3600, repeat: '每个工作日（周一到周五）', snoozed: false },
      { id: 2, kind: 'reminder', type: '提醒', label: '晾衣服', at: now() + 26 * 3600, repeat: '', snoozed: false, spoken: true },
    ],
    missed: [{ kind: 'reminder', label: '吃药', at: now() - 3 * 3600, why: 'unanswered', noted: now() - 3 * 3600 },
             { kind: 'alarm', label: '起床', at: now() - 20 * 3600, why: 'off', noted: now() - 20 * 3600 }],
  });
  const steps = [
    ['idle', 4000, () => {
      handlers.snapshot({ status: { state: 'idle', connected: false, uploading: false, volume: 60 }, alarms: alarmsDemo(),
                          devices: devicesDemo(),
                          models: { current: options[0], options }, thread: { entry: options[0].entry, messages: [] } });
    }],
    ['settings', 3000, () => $('settings').classList.add('on')],
    [null, 300, () => $('settings').classList.remove('on')],
    ['ring', 4000, () => handlers.alarms(Object.assign(alarmsDemo(), {
      ringing: { items: [alarmsDemo().items[1]], notes: [], started: now() } }))],
    [null, 300, () => handlers.alarms(alarmsDemo())],
    ['connecting', 1600, () => state('connecting', false)],
    ['listening', 3200, () => state('listening')],
    [null, 500, () => say('user', '明天北京天气怎么样？适合去爬山吗？')],
    ['thinking', 2600, () => state('thinking')],
    [null, 1700, () => sentence('明天北京晴转多云，气温 9 到 19 度，')],
    [null, 1700, () => sentence('北风二三级，空气质量良。')],
    ['speaking', 2200, () => sentence('这样的天气很适合去爬山，香山的红叶正是最好看的时候。')],
    [null, 2400, () => sentence('早晚温差比较大，记得带一件薄外套。')],
    [null, 2600, () => { done(); state('listening'); }],
    [null, 500, () => say('user', '那推荐一条人少一点的路线吧')],
    [null, 2000, () => state('thinking')],
    [null, 1800, () => sentence('可以试试从北京植物园进山，走樱桃沟到鬼笑石，')],
    ['chat', 2400, () => sentence('人比东门少很多，沿途还有溪水和水杉林。')],
    ['cut', 1400, () => { done(true); state('idle'); }],
    ['models', 3200, () => openSheet(true)],
    [null, 600, () => switchTo(options[1])],
    ['volume', 2400, () => showVolume(60)],
    ['ptt', 2600, () => { pttStart(); state('listening'); }],
    [null, 400, () => { pttEnd(); say('user', '用一句话介绍一下你自己'); state('thinking'); }],
    [null, 1800, () => sentence('我是小麦，住在这块屏幕里的语音助手，有问题随时叫我。')],
    [null, 3200, () => { done(); state('idle'); }],
    [null, 3000, () => { state('idle', false); toast('对话已结束，聊天记录已保存'); }],
  ];

  function switchTo(m) {
    openSheet(false);
    handlers.model({ current: m, options });
    handlers.thread({ entry: m.entry, messages: (threads[m.entry] || []).slice() });
    toast(`已切换到 ${m.label}`);
  }

  function run(i, jump) {
    if (stopped) return;
    const [name, wait, fn] = steps[i % steps.length];
    if (i % steps.length === 0) { seq = 0; for (const k in threads) delete threads[k]; }
    fn();
    if (jump && name === jump) return;          // ?demo=<scene>: stop on that scene
    if (jump) return run(i + 1, jump);
    timer = setTimeout(() => run(i + 1), wait);
  }

  // tapping around stops the script and lets the buttons do something plausible
  function action(path, body) {
    stopped = true;
    clearTimeout(timer);
    const answer = q => {
      say('user', q);
      state('thinking');
      timer = setTimeout(() => {
        sentence('这是演示模式，');
        timer = setTimeout(() => { sentence('真正的回答要连上客户端才有哦。'); timer = setTimeout(() => { done(); state('idle'); }, 2600); }, 1500);
      }, 1600);
    };
    if (path === '/api/wake') state('listening');
    else if (path === '/api/ptt/start') state('listening');
    else if (path === '/api/ptt/stop') answer('（按住说话的内容）');
    else if (path === '/api/text') answer(body.text);
    else if (path === '/api/abort') { done(true); state('idle'); }
    else if (path === '/api/end') { done(); state('idle', false); }
    else if (path.startsWith('/api/alarms/')) handlers.alarms(Object.assign({}, ui.alarms, { ringing: null }));
    return Promise.resolve();
  }

  return { start: () => run(0, DEMO || null), action, switchTo };
})();

tick();
setInterval(tick, 1000);
loadWeather();
setInterval(loadWeather, 30 * 60 * 1000);
renderStatus();
renderThread();
if (demo) demo.start();
else connectEvents();

/* ======== 学习 · 家庭（2026-11-15）：口算闪卡、听写、这是什么、朗读检查、作息清单、屏幕卡片、留言、电视限时 ======== */
function speakText(text, lang) {
  if (!text) return;
  if (HW.audio) { HW.audio.pause(); HW.audio = null; }
  const a = new Audio('/api/hw/tts?lang=' + encodeURIComponent(lang || 'yue') + '&text=' + encodeURIComponent(text));
  HW.audio = a;
  a.play().catch(() => {});
  return a;
}
const isLatin = s => /^[\x00-\x7f\s]+$/.test(String(s || ''));
const stEl = id => document.getElementById(id);
const ST = { mode: 'flash', lang: 'en', flash: null, dict: null, read: null, ident: null, live: false };

function stOpen(mode, opts) {
  opts = opts || {};
  const sheet = stEl('stSheet');
  if (!sheet) return;
  if (mode === 'book') { hwOpen(true, false); hwShowBook(); return; }
  // 已经在做同一种题（模型一句话里常连调两三次 study_open，11-18 20:50 / 11-19 08:19 每次都把题重开）：不重开
  const running = (mode === 'flash' && ST.flash && ST.flash.q) || (mode === 'timo' && TIMO.q);
  const sameLevel = () => !opts.level || (mode === 'flash' ? opts.level === ST.flash.level : opts.level === TIMO.level);
  if (sheet.classList.contains('on') && ST.mode === mode && running && sameLevel()) return;
  if (opts.language) ST.lang = opts.language;
  if (mode === 'timo' || mode === 'flash') ST.lang = 'en';   // owner 2026-11-19：出题默认英文交互
  stLangPills();
  sheet.classList.add('on');
  stTab(mode || ST.mode, opts);
  // 语音打开的：不用再点「开始」，小麦那句说完就念第一题
  if (opts.autostart && mode === 'flash') flashStart(ST.flashLevel || 'add20');
  if (opts.autostart && mode === 'timo') timoStart(TIMO.level || 'k2', opts);
}
function stClose() {
  const sheet = stEl('stSheet');
  if (sheet) sheet.classList.remove('on');
  quizCancel();
  if (ST.flash) ST.flash.q = null;
  TIMO.q = null;
  studyPush();
  stLive(false);
  if (ST.flash && ST.flash.tick) clearInterval(ST.flash.tick);
  if (ST.read && ST.read.recording) fetch('/api/rec/stop', { method: 'POST' }).catch(() => {});
}
/* 语言按钮跟着 ST.lang 走：以前只有点击时才高亮，切到奥数自动改英文时按钮还停在粤语 */
function stLangPills() {
  document.querySelectorAll('.st-lang').forEach(x => x.classList.toggle('on', x.dataset.lang === ST.lang));
}
function stTab(mode, opts) {
  ST.mode = mode;
  if (mode === 'timo' || mode === 'flash') ST.lang = 'en';   // owner 2026-11-19：出题默认英文交互
  if (ST.flash && ST.flash.tick) clearInterval(ST.flash.tick);
  if (ST.flash) ST.flash.q = null;
  TIMO.q = null;
  quizCancel();
  stLangPills();
  document.querySelectorAll('.st-tab').forEach(t => t.classList.toggle('on', t.dataset.mode === mode));
  stLive(false);
  const body = stEl('stBody');
  body.innerHTML = '';
  ({ flash: flashView, dictation: dictView, identify: identView, read: readView, routine: routineView, timo: timoView }[mode] || flashView)(body, opts || {});
}

/* -- 摄像头小窗（这是什么 / 拍课文） -- */
function stLive(on) {
  const v = stEl('stLive');
  ST.live = !!on;
  if (!v) return;
  if (on) { if (HW.live) hwLiveOff(); liveStart(v); v.hidden = false; }
  else { liveStop(v); v.hidden = true; }
}
function camBox(label) {
  return `<div class="st-cam"><img id="stLive" alt="实时画面" hidden><img id="stShot" alt="" hidden>
    <div class="st-cam-msg" id="stCamMsg">${esc(label)}</div></div>`;
}
async function stShoot(mode, extra) {
  const msg = stEl('stCamMsg');
  stLive(true);
  if (msg) msg.textContent = '准备…';
  try {
    const r = await fetch('/api/hw/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: ST.lang, countdown: 3, source: 'page', mode, ...(extra || {}) }) });
    const d = await r.json().catch(() => ({ ok: false, error: '网关没有回话' }));
    if (!d.ok) { toast(d.code === 'lens_closed' ? '镜头盖没打开' : (d.error || '没拍成'), 'error'); if (msg) msg.textContent = '再试一次'; return null; }
    return d;
  } catch (e) { toast('拍照失败', 'error'); return null; }
  finally { stLive(false); }
}
function stCamEvent(e) {
  const msg = stEl('stCamMsg');
  if (e.source === 'voice' && e.mode === 'identify') {
    const sheet = stEl('stSheet');
    if (!sheet.classList.contains('on') || ST.mode !== 'identify') stOpen('identify', { language: e.language });
  }
  if (e.phase === 'countdown') { stLive(true); if (msg) msg.textContent = '放到镜头前… ' + (e.seconds || 3); }
  if (e.phase === 'shooting') { stLive(false); if (msg) msg.textContent = '在拍照…'; }
  if (e.phase === 'analyzing') { if (msg) msg.textContent = e.mode === 'ocr' ? '在抄课文…' : '在认…'; }
  if (e.phase === 'error' && msg) msg.textContent = e.error || '没拍成';
  if (e.phase === 'done' && e.source === 'voice' && e.mode === 'identify') identShow(e.data, false);
}

/* -- 做题语音闭环 + 小星星（2026-11-19）--
 * smartview 实际对话（11-18 20:23–20:58）：小麦说「我读题，你直接说答案」，可闪卡从来不念题、要点「开始」才出题，
 * 孩子说的答案（「5个5」「2468」）全进了大模型，模型答「我不知道题目是什么」；孩子问「我对了几道题」模型也看不到。
 * 现在：念题（默认英文）→ 念完不响铃开麦（/api/study/listen）→ hub studyFastPath 认出答案/「再读一次」/「提示」/「跳过」
 * → 事件 study_answer 回到这里判题。页面把做题现场推给 /api/study/state，hub 用它答「几颗星、对了几道」。
 * 鼓励：答对 +1 星（奥数第一次就对 +2），连对 3 题再奖 1 颗，全对一轮奖 3 颗；答错先鼓励，奥数给一次再想的机会。
 */
const QV = { token: 0, streak: 0, roundStars: 0, mute: false };
const STARS = { total: 0, today: 0 };
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const pickOne = a => a[Math.floor(Math.random() * a.length)];
const CHEER = {
  en: ['Great job!', 'Awesome!', 'You got it!', 'Super!', 'Brilliant!', 'Well done!', 'Fantastic!'],
  yue: ['好叻！', '啱晒！', '劲呀！', '好犀利！', '做得好！'],
  zh: ['真棒！', '答对了！', '好厉害！', '太好了！', '做得好！'],
};
const TRY_AGAIN = { en: ['Good try! Think again.', 'Almost! Have another go.', 'Nice try! One more time.'],
                    yue: ['差少少！再谂下。', '唔紧要，再试一次。'], zh: ['差一点！再想想。', '没关系，再试一次。'] };
const KIND_WRONG = { en: ['Nice try!', 'Good effort!', 'That was a tricky one!'], yue: ['唔紧要！', '好努力喇！'], zh: ['没关系！', '很努力了！'] };
const STREAK = { en: n => `${n} in a row! Bonus star!`, yue: n => `连续啱${n}题！加多粒星！`, zh: n => `连对${n}题！奖励一颗星！` };

/* 等小麦自己那句说完 → 收起等答案的麦克风 → 念 → 念完（listen 时）开麦等答案。返回念完的 Promise */
async function quizSay(text, lang, listen) {
  const token = ++QV.token;
  await sleepMs(150);
  for (let i = 0; i < 60 && ui.status && (ui.status.state === 'speaking' || ui.status.state === 'thinking'); i++) await sleepMs(200);
  if (token !== QV.token) return;
  await fetch('/api/study/quiet', { method: 'POST' }).catch(() => {});
  const openMic = () => { if (listen && token === QV.token) fetch('/api/study/listen', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seconds: 14 }) }).catch(() => {}); };
  if (!text || (QV.mute && listen)) { openMic(); return; }
  const a = speakText(text, lang);
  if (!a) { openMic(); return; }
  await new Promise(res => {
    const t = setTimeout(res, 12000);
    const done = () => { clearTimeout(t); res(); };
    a.addEventListener('ended', done, { once: true });
    a.addEventListener('error', done, { once: true });
    a.addEventListener('pause', done, { once: true });
  });
  openMic();
}
function quizCancel() {
  QV.token += 1;
  if (HW.audio) { HW.audio.pause(); HW.audio = null; }
  fetch('/api/study/quiet', { method: 'POST' }).catch(() => {});
}
function studyPush() {
  const open = stEl('stSheet') && stEl('stSheet').classList.contains('on');
  let d = { active: false };
  const f = ST.flash;
  if (open && ST.mode === 'flash' && f && f.q && f.n <= f.total)
    d = { active: true, mode: 'flash', level: f.level, n: f.n, total: f.total, right: f.right, streak: QV.streak,
          ans: 'num', lang: ST.lang, question: f.q[0] };
  else if (open && ST.mode === 'timo' && TIMO.q)
    d = { active: true, mode: 'timo', level: TIMO.level, n: TIMO.n + 1, total: TIMO.total, right: TIMO.right, streak: QV.streak,
          ans: TIMO.q.ans || 'num', opts: TIMO.q.opts || null, lang: ST.lang, question: timoText(TIMO.q) };
  fetch('/api/study/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).catch(() => {});
}

/* 星星：页面上立刻加、飘一颗星，同时记到设备（family.json），主屏横幅也显示今天的星星 */
function starRender() {
  let el = stEl('stStars');
  const bar = document.querySelector('#stSheet .st-bar-r');
  if (!el && bar) { bar.insertAdjacentHTML('afterbegin', '<div class="st-stars" id="stStars"></div>'); el = stEl('stStars'); }
  if (el) el.innerHTML = `⭐ <b>${STARS.today}</b><span>${ST.lang === 'en' ? 'today' : '今天'} · ${STARS.total}</span>`;
}
function starFly(n, label) {
  const sheet = stEl('stSheet'); if (!sheet) return;
  const x = document.createElement('div');
  x.className = 'star-fly';
  x.innerHTML = `${'⭐'.repeat(Math.min(n, 3))} +${n}${label ? `<em>${esc(label)}</em>` : ''}`;
  sheet.appendChild(x);
  setTimeout(() => x.remove(), 1600);
  const el = stEl('stStars'); if (el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
}
function starGain(n, label) {
  if (!n) return;
  QV.roundStars += n; STARS.today += n; STARS.total += n;
  starRender(); starFly(n, label);
  fetch('/api/stars/add', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stars: n, why: label || '', streak: QV.streak }) })
    .then(r => r.json()).then(d => { if (d.ok && d.stars) { STARS.total = d.stars.total; STARS.today = d.stars.today; starRender(); } }).catch(() => {});
}
/* 答对：+base 星；每连对 3 题再奖 1 颗。返回要念的鼓励话 */
function quizRight(base) {
  QV.streak += 1;
  starGain(base);
  let say = pickOne(CHEER[ST.lang] || CHEER.en);
  if (QV.streak % 3 === 0) { setTimeout(() => starGain(1, STREAK[ST.lang](QV.streak)), 700); say += ' ' + STREAK[ST.lang](QV.streak); }
  return say;
}
function quizRoundEnd(mode, level, right, total, sec) {
  const perfect = right === total && total > 0;
  if (perfect) setTimeout(() => starGain(3, ST.lang === 'en' ? 'Perfect round!' : '全对奖励'), 900);
  const s = QV.roundStars + (perfect ? 3 : 0);
  fetch('/api/stars/add', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stars: 0, round: { mode, level, right, total, seconds: sec, stars: s } }) }).catch(() => {});
  const half = right * 2 >= total;
  return {
    en: perfect ? `Perfect! All ${total} right! You earned ${s} stars!`
        : half ? `Well done! ${right} out of ${total}. You earned ${s} stars!`
        : `Good effort! ${right} out of ${total}, and ${s} stars. Practice makes you stronger!`,
    yue: perfect ? `全部啱晒！攞咗${s}粒星，好叻！` : `啱咗${right}题，攞咗${s}粒星！错嘅入咗错题本，下次再练`,
    zh: perfect ? `全对了！得了${s}颗星，真棒！` : `对了${right}题，得了${s}颗星！错的放进错题本，下次再练`,
  }[ST.lang] || '';
}
/* hub 认出来的口头回答：{cmd: repeat|hint|skip|stop|mute, value?: 数字, text} */
function studyVoice(d) {
  if (!stEl('stSheet') || !stEl('stSheet').classList.contains('on')) return;
  const cmd = d.cmd;
  if (cmd === 'mute') { QV.mute = true; toast(ST.lang === 'en' ? 'OK, I will stop reading. Look at the screen' : '好，不念题了，看屏幕'); }
  if (cmd === 'unmute') QV.mute = false;
  if (cmd === 'stop') { quizCancel(); stClose(); return; }
  if (ST.mode === 'flash') {
    const f = ST.flash;
    if (!f || !f.q) { if (cmd === 'start' || d.value == null) flashStart(ST.flashLevel || 'add20'); return; }
    if (f.locked) return;
    if (cmd === 'repeat' || cmd === 'mute' || cmd === 'unmute') return flashSay();
    if (cmd === 'skip') { f.input = '—'; return flashCheck(true); }
    if (d.value != null) { f.input = String(d.value); stEl('flA').textContent = f.input; flashCheck(); }
  } else if (ST.mode === 'timo') {
    const q = TIMO.q;
    if (!q) { if (cmd === 'start' || d.value == null) timoStart(TIMO.level || 'k2', {}); return; }
    if (TIMO.locked) return;
    if (cmd === 'repeat' || cmd === 'mute' || cmd === 'unmute') return timoSay();
    if (cmd === 'hint') return timoHint();
    if (cmd === 'skip') return timoAnswer('__skip__', '—');
    if (q.ans === 'choice') {
      const t = timoNorm(d.text);
      const letter = (String(d.text || '').trim().match(/^[a-dA-D]$/) || [])[0];
      let hit = letter ? q.opts[letter.toUpperCase().charCodeAt(0) - 65] : null;
      if (!hit) hit = q.opts.find(o => timoNorm(o) && t.includes(timoNorm(o)));
      if (!hit && d.value != null) hit = q.opts.find(o => timoNorm(o) === String(d.value));
      if (hit) timoAnswer(hit, hit);
      else quizSay(ST.lang === 'en' ? 'Which one? Say one of the choices on the screen.' : '选哪个？说屏幕上的一个', ST.lang, true);
      return;
    }
    if (d.value != null) timoAnswer(String(d.value), String(d.value));
  }
}

/* -- 口算闪卡 -- */
const FLASH_LEVELS = { add20: '20 以内加减', add100: '100 以内加减', times: '乘法表', mixed: '混合' };
const FLASH_LEVELS_EN = { add20: 'Up to 20', add100: 'Up to 100', times: 'Times tables', mixed: 'Mixed' };
const flEN = () => ST.lang === 'en';
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function flashQuestion(level) {
  const lv = level === 'mixed' ? ['add20', 'add100', 'times'][rnd(0, 2)] : level;
  if (lv === 'times') { const a = rnd(2, 9), b = rnd(1, 9); return Math.random() < 0.75 ? [`${a} × ${b}`, a * b] : [`${a * b} ÷ ${a}`, b]; }
  const max = lv === 'add100' ? 100 : 20;
  const a = rnd(1, max - 1);
  if (Math.random() < 0.5) { const b = rnd(1, max - a); return [`${a} + ${b}`, a + b]; }
  const b = rnd(1, a); return [`${a} − ${b}`, a - b];
}
function flashSpeech(expr, lang) {
  const ops = lang === 'en' ? { '+': 'plus', '−': 'minus', '×': 'times', '÷': 'divided by' } : { '+': '加', '−': '减', '×': '乘', '÷': '除以' };
  const s = expr.replace(/[+−×÷]/g, m => ' ' + ops[m] + ' ').replace(/\s+/g, ' ').trim();
  return lang === 'en' ? `What is ${s}?` : lang === 'yue' ? `${s}，等于几多？` : `${s}，等于多少？`;
}
function flashView(body, opts) {
  const level = FLASH_LEVELS[opts.level] ? opts.level : (ST.flashLevel || 'add20');
  ST.flashLevel = level;
  const names = flEN() ? FLASH_LEVELS_EN : FLASH_LEVELS;
  body.innerHTML = `<div class="st-row">${Object.entries(names).map(([k, v]) =>
      `<button class="st-pill${k === level ? ' on' : ''}" data-lv="${k}">${v}</button>`).join('')}</div>
    <div class="flash"><div class="flash-q" id="flQ">${flEN() ? 'Ready?' : '准备好就开始'}</div><div class="flash-a" id="flA"></div>
      <div class="flash-meta" id="flMeta">${flEN() ? '10 questions. Say the answer or tap it' : '10 题一轮，说答案或者点数字'}</div>
      <div class="pad">${[1,2,3,4,5,6,7,8,9,'⌫',0,'✓'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>
      <div class="st-row"><button class="pri st-go" id="flGo">${flEN() ? 'Start' : '开始'}</button>
        <button id="flSay" hidden>${flEN() ? '🔊 Again' : '🔊 再念'}</button></div></div>`;
  body.querySelectorAll('[data-lv]').forEach(b => b.addEventListener('click', () => flashView(body, { level: b.dataset.lv })));
  body.querySelectorAll('.pad button').forEach(b => b.addEventListener('click', () => flashKey(b.dataset.k)));
  stEl('flGo').addEventListener('click', () => flashStart(level));
  stEl('flSay').addEventListener('click', flashSay);
  starRender();
}
function flashStart(level) {
  if (ST.flash && ST.flash.tick) clearInterval(ST.flash.tick);
  ST.flash = { level, n: 0, total: 10, right: 0, wrong: [], input: '', started: Date.now(), q: null };
  ST.flash.tick = setInterval(flashMeta, 500);
  QV.streak = 0; QV.roundStars = 0;
  stEl('flGo').hidden = true;
  if (stEl('flSay')) stEl('flSay').hidden = false;
  flashNext();
}
function flashSay() {
  const f = ST.flash; if (!f || !f.q) return;
  quizSay(flashSpeech(f.q[0], ST.lang), ST.lang, true);
}
function flashNext() {
  const f = ST.flash;
  if (f.n >= f.total) return flashEnd();
  f.q = flashQuestion(f.level); f.input = ''; f.n += 1;
  stEl('flQ').textContent = f.q[0] + ' = ?';
  stEl('flA').textContent = ''; stEl('flA').className = 'flash-a';
  flashMeta();
  studyPush();
  flashSay();
}
function flashMeta() {
  const f = ST.flash; if (!f) return;
  const sec = Math.round((Date.now() - f.started) / 1000);
  const m = stEl('flMeta'); if (!m) return;
  m.textContent = flEN() ? `Question ${f.n}/${f.total} · ${f.right} right · ${sec} s${QV.streak >= 2 ? ` · 🔥 ${QV.streak}` : ''}`
                         : `第 ${f.n}/${f.total} 题 · 答对 ${f.right} · ${sec} 秒${QV.streak >= 2 ? ` · 🔥 连对 ${QV.streak}` : ''}`;
}
function flashKey(k) {
  const f = ST.flash; if (!f || !f.q || f.locked) return;
  if (k === '⌫') f.input = f.input.slice(0, -1);
  else if (k === '✓') { if (f.input) flashCheck(); return; }
  else if (f.input.length < 4) f.input += k;
  stEl('flA').textContent = f.input;
}
async function flashCheck(skipped) {
  const f = ST.flash, ok = !skipped && Number(f.input) === f.q[1], a = stEl('flA');
  f.locked = true;
  let say;
  if (ok) { f.right += 1; a.className = 'flash-a good'; a.textContent = f.input + ' ✓'; say = quizRight(1); }
  else { QV.streak = 0;
         f.wrong.push({ question: f.q[0] + ' =', child_answer: skipped ? '' : f.input, correct: String(f.q[1]), ok: false });
         a.className = 'flash-a bad'; a.textContent = `${skipped ? '' : f.input + ' ✗  '}= ${f.q[1]}`;
         const expr = flashSpeech(f.q[0], ST.lang).replace(/^What is |[，,]?(等于几多|等于多少)？$|\?$/g, '');
         say = pickOne(KIND_WRONG[ST.lang] || KIND_WRONG.en) + (ST.lang === 'en' ? ` ${expr} is ${f.q[1]}.` : ` ${expr}等于${f.q[1]}。`); }
  flashMeta(); studyPush();
  const q = f.q;
  await quizSay(say, ST.lang, false);
  if (ST.flash !== f || f.q !== q) return;
  f.locked = false; flashNext();
}
function flashEnd() {
  const f = ST.flash; clearInterval(f.tick);
  const sec = Math.round((Date.now() - f.started) / 1000);
  f.q = null;
  stEl('flQ').textContent = flEN() ? `${f.right} / ${f.total} right · ${sec} s` : `答对 ${f.right} / ${f.total}，用了 ${sec} 秒`;
  stEl('flA').textContent = f.right === f.total ? (flEN() ? 'All correct! ⭐⭐⭐' : '全对！⭐⭐⭐')
                          : (flEN() ? 'Missed ones went into your mistake book' : '错的题已放进错题本');
  stEl('flA').className = 'flash-a';
  const go = stEl('flGo'); go.hidden = false; go.textContent = flEN() ? 'Play again' : '再来一轮';
  if (stEl('flSay')) stEl('flSay').hidden = true;
  studyPush();
  quizSay(quizRoundEnd('flash', f.level, f.right, f.total, sec), ST.lang, false);
  if (f.wrong.length) fetch('/api/hw/record', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: '口算', source: 'flash', items: f.wrong.map((w, i) => ({ no: i + 1, ...w })) }) }).catch(() => {});
}

/* -- 听写 -- */
const DICT_SAMPLE = { yue: ['太阳', '朋友', '学校', '苹果', '老师'], zh: ['太阳', '朋友', '学校', '苹果', '老师'],
                      en: ['apple', 'friend', 'school', 'teacher', 'happy'] };
async function dictFromBook() {
  try {
    const d = await (await fetch('/api/hw/book')).json();
    return (d.mistakes || []).filter(m => !m.fixed && m.correct && String(m.correct).length <= 12 && !/^[\d\s+\-×÷=.]+$/.test(m.correct))
      .map(m => m.correct).slice(0, 10);
  } catch (e) { return []; }
}
function dictView(body, opts) {
  const words = (opts.words && opts.words.length) ? opts.words : (ST.dict && ST.dict.words) || DICT_SAMPLE[ST.lang];
  ST.dict = { words, i: -1 };
  body.innerHTML = `<div class="st-row"><button class="st-pill" id="dcBook">用错题本的词</button>
      <button class="st-pill" id="dcSample">示例词</button><span class="st-note">也可以说「帮我听写：苹果、香蕉……」</span></div>
    <div class="dict"><div class="dict-n" id="dcN">共 ${words.length} 个词</div>
      <div class="dict-w" id="dcW">准备好纸笔</div>
      <div class="st-row center"><button class="pri st-go" id="dcNext">开始</button><button id="dcAgain" hidden>再念一次</button></div>
      <div class="st-row center"><button id="dcShoot" hidden>写完了，拍照批改</button></div></div>`;
  stEl('dcNext').addEventListener('click', dictNext);
  stEl('dcAgain').addEventListener('click', dictSay);
  stEl('dcShoot').addEventListener('click', () => { stClose(); hwOpen(true, false); hwCapture({ expected: ST.dict.words }); });
  stEl('dcBook').addEventListener('click', async () => { const w = await dictFromBook();
    if (!w.length) return toast('错题本里没有可以听写的词');
    dictView(body, { words: w }); });
  stEl('dcSample').addEventListener('click', () => dictView(body, { words: DICT_SAMPLE[ST.lang] }));
}
function dictSay() {
  const d = ST.dict, w = d.words[d.i];
  if (w == null) return;
  speakText(w, isLatin(w) ? 'en' : ST.lang);
  setTimeout(() => speakText(w, isLatin(w) ? 'en' : ST.lang), 3500);   // 念两遍
}
function dictNext() {
  const d = ST.dict;
  d.i += 1;
  const n = stEl('dcN'), w = stEl('dcW'), next = stEl('dcNext');
  stEl('dcAgain').hidden = false;
  if (d.i >= d.words.length) {
    n.textContent = '听写完了'; w.textContent = '检查一下，再拍照批改';
    next.hidden = true; stEl('dcAgain').hidden = true; stEl('dcShoot').hidden = false;
    speakText({ yue: '写完喇，检查下再影相', en: 'All done. Check your work, then take a photo', zh: '写完了，检查一下再拍照' }[ST.lang], ST.lang);
    return;
  }
  n.textContent = `第 ${d.i + 1} / ${d.words.length} 个`;
  w.textContent = '🔊 ' + '＿'.repeat(Math.min(6, String(d.words[d.i]).length));
  next.textContent = d.i + 1 === d.words.length ? '写完了' : '下一个';
  dictSay();
}

/* -- 这是什么 -- */
function identView(body) {
  body.innerHTML = `<div class="st-split">${camBox('拿一样东西到镜头前')}<div class="st-side" id="idOut">
      <div class="st-note">拿一样东西到镜头前，点「认一认」，我会讲粤语、普通话、英文点叫。</div></div></div>
    <div class="st-row"><button class="pri" id="idGo">认一认</button></div>`;
  stLive(true);
  stEl('idGo').addEventListener('click', async () => { const d = await stShoot('identify'); if (d) identShow(d, true); });
}
function identShow(d, speak) {
  const out = stEl('idOut');
  if (!out) return;
  const shot = stEl('stShot');
  if (shot && d.thumb) { shot.src = d.thumb; shot.hidden = false; }
  if (d.sure === false) { out.innerHTML = `<div class="st-note">${esc((d.speech || {}).zh || '没看清，拿近一点再试')}</div>`; return; }
  const row = (label, word, sub, lang) => `<div class="id-row" data-say="${esc(word)}" data-lang="${lang}"><em>${label}</em>
      <b>${esc(word || '')}</b><span>${esc(sub || '')}</span><i>🔊</i></div>`;
  out.innerHTML = row('粤语', d.yue, d.jyutping, 'yue') + row('普通话', d.zh, d.pinyin, 'zh') + row('English', d.en, '', 'en')
    + (d.en_sentence ? `<div class="id-sent" data-say="${esc(d.en_sentence)}" data-lang="en">🔊 ${esc(d.en_sentence)}</div>` : '')
    + (d.fact ? `<div class="st-note">💡 ${esc(d.fact)}</div>` : '');
  out.querySelectorAll('[data-say]').forEach(el => el.addEventListener('click', () => speakText(el.dataset.say, el.dataset.lang)));
  if (speak) speakText((d.speech || {})[ST.lang] || d.zh, ST.lang);
}

/* -- 朗读检查 -- */
function readView(body) {
  ST.read = ST.read || { text: '' };
  body.innerHTML = `<div class="st-split">${camBox('把课文放到镜头前')}<div class="st-side">
      <div class="read-text" id="rdText">${ST.read.text ? esc(ST.read.text) : '<span class="st-note">先拍下要读的课文</span>'}</div>
      <div class="st-note" id="rdScore"></div></div></div>
    <div class="st-row"><button id="rdShoot">拍课文</button><button class="pri" id="rdGo" ${ST.read.text ? '' : 'disabled'}>开始读</button></div>`;
  stLive(true);
  stEl('rdShoot').addEventListener('click', async () => {
    const d = await stShoot('ocr');
    if (!d) return;
    ST.read.text = (d.text || '').trim();
    stEl('rdText').textContent = ST.read.text || '没抄到字，放正一点再拍';
    stEl('rdGo').disabled = !ST.read.text;
    stLive(true);
  });
  stEl('rdGo').addEventListener('click', readToggle);
}
async function readToggle() {
  const go = stEl('rdGo'), r = ST.read;
  if (!r.recording) {
    stLive(false);
    await fetch('/api/rec/start', { method: 'POST' });
    r.recording = true; go.textContent = '读完了'; go.classList.add('rec');
    stEl('rdScore').textContent = '在听… 读完点「读完了」';
    return;
  }
  r.recording = false; go.textContent = '在听写…'; go.disabled = true; go.classList.remove('rec');
  let d = {};
  try { d = await (await fetch('/api/rec/stop', { method: 'POST' })).json(); } catch (e) {}
  go.disabled = false; go.textContent = '再读一次';
  readCompare(r.text, d.text || '');
}
function readCompare(ref, heard) {
  // 中文按字、英文按词对齐（最长公共子序列），读漏的标红
  const latin = isLatin(ref);
  const tok = s => latin ? (s.toLowerCase().match(/[a-z0-9']+/g) || []) : Array.from(s.replace(/[^一-鿿0-9a-zA-Z]/g, ''));
  const refRaw = latin ? (ref.match(/[A-Za-z0-9']+|[^A-Za-z0-9']+/g) || []) : Array.from(ref);
  const a = tok(ref), b = tok(heard);
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hit = new Array(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { hit[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  let k = 0, html = '';
  for (const piece of refRaw) {
    const isTok = latin ? /^[A-Za-z0-9']+$/.test(piece) : /[一-鿿0-9a-zA-Z]/.test(piece);
    if (isTok) { html += `<span class="${hit[k] ? 'rd-ok' : 'rd-miss'}">${esc(piece)}</span>`; k++; }
    else html += esc(piece);
  }
  stEl('rdText').innerHTML = html;
  const pct = n ? Math.round(hit.filter(Boolean).length * 100 / n) : 0;
  stEl('rdScore').textContent = heard ? `读对 ${pct}%，红色是读漏或读错的` : '没听到声音，靠近一点再读';
  if (heard) speakText({ yue: pct >= 90 ? '读得好好！' : '红色嗰啲再读多次', en: pct >= 90 ? 'Great reading!' : 'Try the red words again',
                         zh: pct >= 90 ? '读得很好！' : '红色的再读一遍' }[ST.lang], ST.lang);
}

/* -- TIMO 奥数练习（2026-11-19）--
 * 题库在 timo_bank.js（S 盘 timo-papers 的 K2/幼稚园组与小一 P1 卷改写）。
 * 默认英文交互（owner 2026-11-19）：题面、提示、讲解、对错反馈都用英文走 /api/hw/tts（en 声音）；
 * 答题用数字键盘或选项。错题照旧进错题本（/api/hw/record），和口算闪卡同一条路。
 */
const TIMO = { level: 'k2', n: 0, total: 8, right: 0, wrong: [], input: '', q: null, list: null, started: 0, hintUsed: 0 };
/* 奥数面板固定英文：页面文案也走英文，切粤语/普通话按钮时同样生效 */
function timoUI() { return ST.lang === 'en'; }
const T_UI = {
  en: { start: 'Start', again: 'Repeat the question', hint: 'Hint', ready: 'Tap Start and I will read the question',
        meta: '8 questions. Listen first, then answer', done: 'Done', right: 'correct', used: 'seconds', allRight: 'All correct, well done!',
        inBook: 'The ones you missed went into your mistake book', retry: 'Try another round', loading: 'Question bank not loaded (timo_bank.js)',
        sec: 'topic' },
  yue: { start: '开始', again: '再听一次', hint: '提示', ready: '按「开始」听我读题',
         meta: '一次 8 题，先听题再答', done: '做完啦', right: '答对', used: '秒', allRight: '全对，好叻！',
         inBook: '错的题已经放进错题本', retry: '再来一轮', loading: '题库没载入（timo_bank.js）', sec: '题型' },
  zh: { start: '开始', again: '再听一次', hint: '提示', ready: '按「开始」听我读题',
        meta: '一次 8 题，先听题再答', done: '做完啦', right: '答对', used: '秒', allRight: '全对，真棒！',
        inBook: '错的题已经放进错题本', retry: '再来一轮', loading: '题库没载入（timo_bank.js）', sec: '题型' },
};
function timoT() { return T_UI[ST.lang] || T_UI.en; }
function timoBank() { return window.TIMO || null; }
function timoView(body, opts) {
  const B = timoBank(), t = timoT();
  if (!B) { body.innerHTML = `<div class="st-note">${t.loading}</div>`; return; }
  const level = opts.level && B.LEVELS.some(l => l.id === opts.level) ? opts.level : (TIMO.level || 'k2');  TIMO.level = level;
  const note = (B.LEVELS.find(l => l.id === level) || {}).note || '';
  body.innerHTML = `<div class="st-row">${B.LEVELS.map(l =>
      `<button class="st-pill${l.id === level ? ' on' : ''}" data-lv="${l.id}">${esc(l.name)}</button>`).join('')}
      <span class="st-note">${esc(note)}</span></div>
    <div class="timo"><div class="timo-q" id="tqQ">${esc(t.ready)}</div>
      <div class="timo-a" id="tqA"></div>
      <div class="timo-meta" id="tqMeta">${esc(t.meta)}</div>
      <div id="tqPad"></div>
      <div class="st-row"><button class="pri st-go" id="tqGo">${esc(t.start)}</button>
        <button id="tqSay" hidden>${esc(t.again)}</button><button id="tqHint" hidden>${esc(t.hint)}</button></div></div>`;
  body.querySelectorAll('[data-lv]').forEach(b => b.addEventListener('click', () => timoView(body, { level: b.dataset.lv })));
  stEl('tqGo').addEventListener('click', () => timoStart(level, opts));
  stEl('tqSay').addEventListener('click', timoSay);
  stEl('tqHint').addEventListener('click', timoHint);
}
function timoStart(level, opts) {
  const B = timoBank();
  const n = Number(opts && opts.count) || 8;
  TIMO.list = B.pick(level, n);
  TIMO.n = 0; TIMO.right = 0; TIMO.wrong = []; TIMO.input = ''; TIMO.hintUsed = 0;
  QV.streak = 0; QV.roundStars = 0;
  TIMO.total = TIMO.list.length; TIMO.started = Date.now();
  stEl('tqGo').hidden = true;
  stEl('tqSay').hidden = false; stEl('tqHint').hidden = false;
  timoNext();
}
function timoText(q) {
  return ST.lang === 'en' ? q.qe : ST.lang === 'yue' ? q.qy : q.q;
}
function timoSay() {
  const q = TIMO.q; if (!q) return;
  const opts = q.ans === 'choice' && q.opts ? (ST.lang === 'en' ? ' Is it ' + q.opts.join(', or ') + '?' : ' 选：' + q.opts.join('，')) : '';
  quizSay(timoText(q) + opts, ST.lang, true);
}
function timoHint() {
  const q = TIMO.q; if (!q) return;
  TIMO.hintUsed += 1;
  const t = ST.lang === 'en' ? q.hinte : ST.lang === 'yue' ? q.hinty : q.hint;
  const note = stEl('tqA');
  if (note) { note.textContent = '💡 ' + t; note.className = 'timo-a'; }
  quizSay(t, ST.lang, true);
}
function timoNext() {
  const q = TIMO.list[TIMO.n];
  if (!q) return timoEnd();
  TIMO.q = q; TIMO.input = ""; TIMO.locked = false; TIMO.hintUsed = 0; TIMO.tries = 0;
  const n = stEl('tqQ'), a = stEl('tqA'), pad = stEl('tqPad');
  // owner 2026-11-19「出题的时候，题目在屏幕也要有」：题面整句显示，不只念；题号和题型放到下面一行
  n.textContent = timoText(q);
  a.className = 'timo-a'; a.textContent = '';
  stEl('tqMeta').textContent = timoUI()
    ? `Question ${TIMO.n + 1} / ${TIMO.total} · say or tap your answer · ⭐ ${QV.roundStars}`
    : `第 ${TIMO.n + 1} / ${TIMO.total} 题（${q.sec}）· 说答案或点 · ⭐ ${QV.roundStars}`;
  pad.innerHTML = q.ans === 'choice'
    ? `<div class="timo-opts">${q.opts.map((o, i) => `<button data-o="${i}">${esc(o)}</button>`).join('')}</div>`
    : `<div class="pad">${[1,2,3,4,5,6,7,8,9,'⌫',0,'✓'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>`;
  if (q.ans === 'choice') {
    pad.querySelectorAll('[data-o]').forEach(b => b.addEventListener('click', () => timoAnswer(q.opts[Number(b.dataset.o)], b.textContent)));
  } else {
    pad.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => timoKey(b.dataset.k)));
  }
  studyPush();
  setTimeout(timoSay, 250);
}
function timoKey(k) {
  const q = TIMO.q; if (!q || TIMO.locked) return;
  if (k === '⌫') TIMO.input = TIMO.input.slice(0, -1);
  else if (k === '✓') { if (TIMO.input) timoAnswer(TIMO.input, TIMO.input); return; }
  else if (TIMO.input.length < 6) TIMO.input += k;
  stEl('tqA').textContent = TIMO.input;
  stEl('tqA').className = 'timo-a';
}
function timoNorm(s) { return String(s == null ? "" : s).replace(/[\s,，、。.元蚊$]/g, "").toLowerCase(); }
async function timoAnswer(given, shown) {
  const q = TIMO.q; if (!q || TIMO.locked) return;
  TIMO.locked = true;
  const skipped = given === '__skip__';
  const ok = !skipped && timoNorm(given) === timoNorm(q.a);
  const a = stEl('tqA');
  const exp = ST.lang === 'en' ? q.expe : (q.exp || q.expe);
  let say;
  if (ok) {
    TIMO.right += 1;
    a.className = 'timo-a good';
    a.textContent = `${shown} ✓  ${exp}`;
    say = quizRight(TIMO.tries || TIMO.hintUsed ? 1 : 2) + ' ' + exp;   // 自己第一次就对 2 颗，提示/再想之后对 1 颗
  } else if (!skipped && !TIMO.tries) {
    // 第一次错：先鼓励，给提示，再想一次（不揭答案）
    TIMO.tries = 1; QV.streak = 0;
    const hint = ST.lang === 'en' ? q.hinte : ST.lang === 'yue' ? q.hinty : q.hint;
    a.className = 'timo-a bad';
    a.textContent = `${shown} ✗  💡 ${hint}`;
    TIMO.locked = false; TIMO.input = '';
    studyPush();
    quizSay(pickOne(TRY_AGAIN[ST.lang] || TRY_AGAIN.en) + ' ' + hint, ST.lang, true);
    return;
  } else {
    QV.streak = 0;
    TIMO.wrong.push({ question: timoText(q), child_answer: skipped ? '' : String(given), correct: String(q.a), ok: false });
    a.className = 'timo-a bad';
    const reveal = { yue: '答案系', en: 'The answer is', zh: '答案是' }[ST.lang];
    a.textContent = `${skipped ? '' : shown + ' ✗  '}${reveal} ${q.a}. ${exp}`;
    say = pickOne(KIND_WRONG[ST.lang] || KIND_WRONG.en) + ' ' + reveal + ' ' + q.a + '. ' + exp;
  }
  TIMO.n += 1;
  studyPush();
  await quizSay(say, ST.lang, false);
  if (TIMO.q !== q) return;
  await sleepMs(600);
  if (TIMO.q === q) timoNext();
}
function timoEnd() {
  const sec = Math.round((Date.now() - TIMO.started) / 1000), t = timoT();
  TIMO.q = null;
  stEl('tqQ').textContent = timoUI()
    ? `${t.done}: ${TIMO.right} / ${TIMO.total} ${t.right}, ${sec} ${t.used}`
    : `${t.done}：${t.right} ${TIMO.right} / ${TIMO.total}，用了 ${sec} ${t.used}`;
  stEl('tqA').className = 'timo-a';
  stEl('tqA').textContent = TIMO.right === TIMO.total ? t.allRight : t.inBook;
  stEl('tqPad').innerHTML = '';
  stEl('tqSay').hidden = true; stEl('tqHint').hidden = true;
  const go = stEl('tqGo'); go.hidden = false; go.textContent = t.retry;
  studyPush();
  quizSay(quizRoundEnd('timo', TIMO.level, TIMO.right, TIMO.total, sec), ST.lang, false);
  if (TIMO.wrong.length) fetch('/api/hw/record', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: '奥数', source: 'timo', items: TIMO.wrong.map((w, i) => ({ no: i + 1, ...w })) }) }).catch(() => {});
}

/* -- 作息清单 -- */
const FAM = { state: null };
function routineView(body, opts) {
  const r = (FAM.state && FAM.state.routine) || {};
  const col = (key, title) => {
    const x = r[key] || { items: [], done: [] };
    const done = new Set(x.done || []);
    return `<div class="rt-col"><h3>${title} <span>${done.size}/${x.items.length}</span></h3>${x.items.map((it, i) =>
      `<button class="rt-item${done.has(i) ? ' on' : ''}" data-list="${key}" data-i="${i}">${done.has(i) ? '✓' : '○'} ${esc(it)}</button>`).join('')
      || '<div class="st-note">还没有，可以说「早上清单：刷牙、吃早餐」</div>'}</div>`;
  };
  body.innerHTML = `<div class="rt">${col('morning', '早上')}${col('evening', '晚上')}</div>
    <div class="st-note">改清单直接说，例如「晚上清单加冲凉」。每天自动清零。</div>`;
  body.querySelectorAll('.rt-item').forEach(b => b.addEventListener('click', async () => {
    const on = !b.classList.contains('on');
    await fetch('/api/routine/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: b.dataset.list, index: Number(b.dataset.i), done: on }) });
  }));
}

/* -- 家庭状态：留言横幅、电视限时 -- */
function famApply(f) {
  FAM.state = f;
  const bar = stEl('famBar');
  if (bar) {
    const n = (f.notes || [])[0];
    const tv = f.tv;
    let html = '';
    if (f.stars) { STARS.total = f.stars.total || 0; STARS.today = f.stars.today || 0; starRender(); }
    if (f.stars && f.stars.today > 0) html += `<div class="fam-chip stars">⭐ 今天 <b>${f.stars.today}</b> 颗 · 共 ${f.stars.total}</div>`;
    if (tv) html += `<div class="fam-chip tv">📺 电视还剩 <b id="famTvLeft">${Math.ceil(tv.left / 60)}</b> 分钟<button data-act="tvcancel">取消</button></div>`;
    if (n) html += `<div class="fam-chip note">📝 ${n.from ? esc(n.from) + '：' : ''}${esc(n.text)}
        <button data-act="say" data-id="${n.id}">🔊</button><button data-act="done" data-id="${n.id}">知道了</button>
        ${f.notes.length > 1 ? `<span>还有 ${f.notes.length - 1} 条</span>` : ''}</div>`;
    bar.innerHTML = html;
    bar.hidden = !html;
    FAM.tvEnd = tv ? Date.now() + tv.left * 1000 : null;
  }
  if (ST.mode === 'routine' && stEl('stSheet').classList.contains('on')) routineView(stEl('stBody'));
}
setInterval(() => { const el = stEl('famTvLeft'); if (el && FAM.tvEnd) el.textContent = Math.max(0, Math.ceil((FAM.tvEnd - Date.now()) / 60000)); }, 15000);
if (stEl('famBar')) stEl('famBar').addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b) return;
  const n = (FAM.state.notes || []).find(x => x.id === b.dataset.id);
  if (b.dataset.act === 'say' && n) speakText(n.text, n.language);
  if (b.dataset.act === 'done') await fetch('/api/notes/done', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.id }) });
  if (b.dataset.act === 'tvcancel') await fetch('/api/tv-timer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cancel: true }) });
});
fetch('/api/family').then(r => r.json()).then(f => { if (f.ok) famApply(f); }).catch(() => {});

/* -- 屏幕卡片 -- */
let cardTimer = null;
function cardShow(c) {
  const box = stEl('cardBox');
  if (!box) return;
  if (c.close) { box.classList.remove('on'); return; }
  const words = c.kind === 'words';
  stEl('cardTitle').textContent = c.title || '';
  const list = stEl('cardItems');
  list.className = 'card-items ' + (c.kind || 'list');
  list.innerHTML = (c.items || []).map((it, i) => `<li data-say="${esc(it)}">${c.kind === 'steps' ? `<em>${i + 1}</em>` : ''}${esc(it)}${words ? ' <i>🔊</i>' : ''}</li>`).join('');
  if (words) list.querySelectorAll('li').forEach(li => li.addEventListener('click', () => {
    const w = li.dataset.say.split(/[ —:：-]/)[0]; speakText(w, isLatin(w) ? 'en' : (c.language || 'yue')); }));
  box.classList.add('on');
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => box.classList.remove('on'), 180000);
}
if (stEl('cardClose')) stEl('cardClose').addEventListener('click', () => stEl('cardBox').classList.remove('on'));

document.querySelectorAll('.st-tab').forEach(t => t.addEventListener('click', () => stTab(t.dataset.mode)));
if (stEl('stClose')) stEl('stClose').addEventListener('click', stClose);
document.querySelectorAll('.st-lang').forEach(b => b.addEventListener('click', () => {
  ST.lang = b.dataset.lang; document.querySelectorAll('.st-lang').forEach(x => x.classList.toggle('on', x === b)); }));
