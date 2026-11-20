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
/* 手快的小孩一秒点十几下：以前 touchstart 和 click 各发一条 HTTP，客户端 python 被点到 55% CPU、
   队列越积越多，反而更像点不动（2026-11-19 18:07 一秒 13 次 ⌫）。同一按钮 300 ms 内只记一条。 */
let tapLogId = '', tapLogAt = 0;
for (const type of ['touchstart', 'click']) {
  document.addEventListener(type, e => {
    const b = e.target && e.target.closest && e.target.closest('#hwSheet button, #stSheet button');
    if (!b) return;
    const id = `${type}|${b.id || (b.textContent || '').trim().slice(0, 12)}`, now = Date.now();
    if (id === tapLogId && now - tapLogAt < 300) return;
    tapLogId = id; tapLogAt = now;
    pageLog('tap', `${type} ${b.id || ''} 「${(b.textContent || '').trim().slice(0, 12)}」 hidden=${b.hidden} disabled=${b.disabled}`);
  }, { capture: true, passive: true });
}
/* 卡顿探针：主线程被堵住 800 ms 以上记一条（kiosk 没有控制台，只能落进 journal）。
   setInterval 在阻塞时会漂移，正好当判据；每 500 ms 一次的开销可以忽略。 */
(() => {
  let last = Date.now(), lastLog = 0, big = [];
  setInterval(() => {
    const now = Date.now(), gap = now - last;
    last = now;
    const where = (document.querySelector('.sheet.on') || {}).id || 'home';
    if (gap > 800 && now - lastLog > 3000) {
      lastLog = now;
      pageLog('jank', `main thread stalled ${gap} ms (${where})`);
    }
    // 兜底：2 分钟里 3 次 >5 s 的卡顿 = 页面已经坏了（11-19 19:20 卡到 35 s，只能靠转屏重启才恢复）。
    // 只在没开面板时重载，不把孩子做到一半的题清掉；面板一收起就会走到这里
    if (gap > 5000) big.push(now);
    big = big.filter(t => now - t < 120000);
    if (big.length >= 3 && where === 'home' && !location.search.includes('demo')) {
      pageLog('jank', `reload: ${big.length} stalls >5 s in 2 min`);
      big = [];
      setTimeout(() => location.reload(), 300);
    }
  }, 500);
})();

// 孩子在点屏幕：告诉客户端（每 3 s 最多一次），小麦就不会在后台提醒「没说话 / 我先休息啦」（owner 2026-11-19）
let lastTouchPost = 0, lastTouch = 0;
const touchedRecently = (ms = 10000) => Date.now() - lastTouch < ms;   // 孩子刚点过屏幕：不出声催「讲答案」
document.addEventListener('pointerdown', () => {
  const now = Date.now();
  lastTouch = now;
  if (now - lastTouchPost < 3000) return;
  lastTouchPost = now;
  fetch('/api/study/touch', { method: 'POST' }).catch(() => {});
}, { capture: true, passive: true });

/* 念完/打断的 Audio 一定要拆掉（2026-11-19 19:20 学习板 30 s 点不动的根因）：
   WebKitGTK 每个 new Audio 是一条 GStreamer 管线（source/typefind/mpegaudioparse/aqueue… 5 个以上线程），
   只 pause() 不放 src，管线一直挂在 PAUSED，主线程还要替它们处理总线消息。孩子讲解中点 Next 就漏一条：
   渲染进程 2 h 涨到 632 线程，主线程卡顿从 0.8 s 一路涨到 35 s。pause + 去掉 src + load() 才会真正拆管线。 */
function audioDrop(a) {
  if (!a) return;
  try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) { /* 已经拆了 */ }
}

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
    // 不带城市：hub 提示词要求直接调 get_weather 不传 location，用 hub 配置里的默认地点
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
    ['出几道算术题', '#5ee0ff24', '#8ff0ff', '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h3M9.5 7.5v3M13 9h3M8 15h3M13 14h3M13 16h3"/>', 'flash'],
    ['Give me some math questions', '#9b7bff2b', '#c8b4ff', '<path d="M5 12h14M12 5v14"/>', 'flash'],
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
      if (open) { stOpen(open, open === 'flash' ? { auto: true, level: 'mixed', ...(isLatin(q) ? { language: 'en' } : {}) } : undefined); return; }   // 学习/家庭：直接开面板；算术题直接开始念题
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
const HW = { lang: 'en', data: null,   // owner 2026-11-19：学习默认英文交互（看作业也是），语言按钮可临时切
            busy: false, audio: null, tick: null, view: 'result', live: false };
const HW_COUNTDOWN = 5;   // 点「拍」或说「睇作业」后先倒数（3→5 s，11-19 12:14 连拍 4 张都只有头没纸：来不及举）

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
      + (d.readable === false ? (HW.lang === 'en' ? " · Can't see it — try another photo" : ' · 看不清，请再拍一张')
         : (HW.lang === 'en' ? ` · ${n} questions, ${bad} to look at again` : ` · ${n} 题，${bad} 题要再看一次`)) + '</span>'
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
  quietMic();
  if (HW.audio) { audioDrop(HW.audio); HW.audio = null; }
  const url = '/api/hw/tts?lang=' + encodeURIComponent(HW.lang) + '&text=' + encodeURIComponent(text);
  const a = new Audio(url);
  HW.audio = a;
  const stop = hwEl('hwStop');
  if (stop) stop.hidden = false;
  const fin = () => { if (HW.audio === a) HW.audio = null; if (stop) stop.hidden = true; audioDrop(a); };
  a.addEventListener('ended', fin, { once: true });
  a.addEventListener('error', fin, { once: true });
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
  const before = STARS.total;
  STARS.today += n; STARS.total += n; starRender();
  const hit = STAR_GOALS.filter(g => before < g && STARS.total >= g).pop();
  if (hit) setTimeout(() => starMilestone(hit), 800);
  const allOk = items.every(i => i.ok !== false);
  toast(`⭐ +${n} ` + ({ en: allOk ? 'All correct, well done!' : 'You fixed it, great job!', yue: allOk ? '全对，好叻！' : '改对咗，好叻！',
                         zh: allOk ? '全对，真棒！' : '改对了，真棒！' }[HW.lang] || 'Well done!'));
  fetch('/api/stars/add', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stars: n, why: 'homework' }) }).catch(() => {});
}

/* 镜头前有没有纸（2026-11-19：12:14 连拍 4 张只有头）：从实时画面取中间一块，数「亮、颜色淡」的像素占比。
   白纸举在脸前时中间大片发白；只有脸/房间时很少。取不到画面（还没出帧、出错）返回 null，不拦。 */
const PAPER_FRAC = 0.30;
function hwPaperScore() {
  const v = hwEl('hwLive');
  if (!v || v.hidden || !v.naturalWidth) return null;
  try {
    const c = HW.paperCanvas || (HW.paperCanvas = document.createElement('canvas'));
    c.width = 64; c.height = 48;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(v, 0, 0, 64, 48);
    const px = g.getImageData(16, 12, 32, 24).data;     // 中间一半
    let white = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], gg = px[i + 1], b = px[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      n += 1;
      if (mx > 120 && (mx - mn) / mx < 0.35) white += 1;   // 亮且颜色淡（实时画面白平衡没校正，偏绿也算进）
    }
    return white / n;
  } catch (e) { return null; }
}
const HW_SAY = {
  hold: { yue: '将份功课举高，挡住块面', en: 'Hold your homework up in front of your face', zh: '把作业纸举起来，挡住你的脸' },
  more: { yue: '我未见到纸，举高啲', en: "I can't see the paper yet. Hold it up close", zh: '还没看到作业纸，举高一点' },
};
/* 页面自己倒数（5 s）。纸张分数只记日志、不拦：实测白沙发/白墙也有 0.6，像素规则分不清纸和房间（18 张样本只有 1 张真有作业），
   积累样本后再定阈值。真正的「没看到作业」交给看图结果：readable=false 时自动提醒并重拍一次（hwCapture） */
async function hwCountdownGate() {
  const show = t => { const el = hwEl('hwBusyText'); if (el) el.textContent = t; };
  const lbl = { yue: '📄 举起份功课… ', en: '📄 Hold your homework up… ', zh: '📄 把作业纸举起来… ' }[HW.lang] || '📄 ';
  hwSetBusy(true, lbl + HW_COUNTDOWN);
  const b0 = hwEl('hwBusy'); if (b0) b0.classList.add('cd');
  for (let k = HW_COUNTDOWN; k > 0; k--) { show(lbl + k); await sleepMs(1000); }
  const sc = hwPaperScore();
  pageLog('note', `看作业纸张分数 ${sc === null ? 'n/a' : sc.toFixed(2)}`);
}
async function hwCapture(extra) {
  if (HW.busy) {   // 11-20 09:27 一秒连点 3 次「再拍一张」都没反应：给个看得见的回应
    pageLog('note', 'hwCapture 跳过：HW.busy');
    if (Date.now() - (HW.busyToast || 0) > 1500) { HW.busyToast = Date.now(); toast({ yue: '睇紧，等一阵', en: 'Still looking — one moment', zh: '正在看，等一下' }[HW.lang] || '正在看，等一下'); }
    return;
  }
  extra = (extra && typeof extra === 'object' && !(extra instanceof Event)) ? extra : {};
  hwLiveOn();
  hwSetBusy(true, '准备拍照…');
  hwSpeakText(HW_SAY.hold[HW.lang] || HW_SAY.hold.en);
  try {
    await hwCountdownGate();
    const r = await fetch('/api/hw/capture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: HW.lang, countdown: 0, source: 'page', ...extra }),
    });
    const d = await r.json().catch(() => ({ ok: false, error: '网关没有回话' }));
    if (!d.ok) { toast(d.code === 'busy' ? '正在拍，等一下' : (d.error || '没拍成，再试一次'), 'error'); return; }
    hwRender(d, true);
    hwStars(d);
    if (d.readable === false && !extra.retry) {
      // 没看到作业：不等孩子找「再拍一张」，直接提醒并自动重拍一次（11-19 12:14 连拍 4 张只有头）
      hwSetBusy(false);
      hwSpeakText(HW_SAY.more[HW.lang] || HW_SAY.more.en);
      await sleepMs(2500);
      if (hwEl('hwSheet') && hwEl('hwSheet').classList.contains('on')) return await hwCapture({ ...extra, retry: true });   // await：外层 finally 要等重拍完再收实时画面
      return;
    }
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
    audioDrop(HW.audio); HW.audio = null;
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
// 看作业的语言按钮一开始就按 HW.lang 亮（默认英文，以前写死亮粤语）
document.querySelectorAll('#hwSheet .hw-lang').forEach(el => el.classList.toggle('on', el.dataset.lang === HW.lang));
if (hwEl('hwShoot')) hwEl('hwShoot').addEventListener('click', hwCapture);
if (hwEl('hwAgain')) hwEl('hwAgain').addEventListener('click', hwCapture);
if (hwEl('hwClose')) hwEl('hwClose').addEventListener('click', () => hwOpen(false));
if (hwEl('hwPhoto')) hwEl('hwPhoto').addEventListener('click', () => { if (!HW.busy && !HW.live) hwLiveOn(); });
if (hwEl('hwBook')) hwEl('hwBook').addEventListener('click', () => {
  if (HW.view === 'book') hwRender(HW.data); else hwShowBook();
});
if (hwEl('hwSpeak')) hwEl('hwSpeak').addEventListener('click', () => hwSpeakText(hwSpeechText(HW.data)));
if (hwEl('hwStop')) hwEl('hwStop').addEventListener('click', () => {
  if (HW.audio) { audioDrop(HW.audio); HW.audio = null; }
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
  // 默认只显示今天/明天（首页不挤），点一下展开整周：hub 提示词里也是 7 天，问「第3天/周几」屏幕和回答能对上
  box.innerHTML = now + w.days.slice(0, WX_OPEN ? w.days.length : 2).map(day).join('') +
    (w.days.length > 2 ? `<button class="wx-more" id="wxMore">${WX_OPEN ? '收起' : '7 天预报'}</button>` : '');
  const more = $('wxMore');
  if (more) more.onclick = (e) => { e.stopPropagation(); WX_OPEN = !WX_OPEN; renderWeather(w); };
  box.hidden = false;
}
let WX_OPEN = false;   // 展开整周只在本次会话里记住；页面重载后回到两行
async function loadWeather() {
  if (DEMO !== null) {
    return renderWeather({ city: '', now: { temp: 21, icon: 'cloud' }, days: [
      { label: '今天', text: '阴', icon: 'cloud', lo: 18, hi: 27, rain: 10 },
      { label: '明天', text: '小雨', icon: 'rain', lo: 17, hi: 24, rain: 60 },
      { label: '11月22日 周日', text: '晴', icon: 'sun', lo: 18, hi: 26, rain: 0 },
      { label: '11月23日 周一', text: '多云', icon: 'cloud-sun', lo: 17, hi: 25, rain: 10 },
      { label: '11月24日 周二', text: '阵雨', icon: 'rain', lo: 16, hi: 23, rain: 55 },
      { label: '11月25日 周三', text: '阴', icon: 'cloud', lo: 15, hi: 22, rain: 20 },
      { label: '11月26日 周四', text: '晴', icon: 'sun', lo: 15, hi: 24, rain: 0 }] });
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
/* 面板一打开就是 position:fixed 全屏（TIMO/闪卡/作业/音乐/设置/卡片），圆环仍在后面跑：
   msm8953 上主线程 ~100% + 合成器 ~110%，点键就排队，孩子感觉「点 next 死机」（2026-11-19 实测）。
   盖住就停 CSS 动画和 canvas，收起时补一帧。 */
const covered = () => document.body.classList.contains('sheet-on');
function syncCovered() {
  const on = !!document.querySelector('.sheet.on');
  if (on === covered()) return;
  document.body.classList.toggle('sheet-on', on);
  if (!on && !document.hidden) setCorona(shownState());
}
for (const id of ['stSheet', 'hwSheet', 'musicSheet', 'sheet', 'settings']) {
  const el = $(id);
  if (el) new MutationObserver(syncCovered).observe(el, { attributes: true, attributeFilter: ['class'] });
}
function setCorona(state) {
  if (covered()) { level.state = state; return; }   // 面板盖着：不画，收起时 syncCovered 补一帧
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
  if (covered() || document.hidden) { level.raf = 0; level.target = level.value = 0; return; }
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
const UPD_FAMILY = DEMO === null;   // 家庭定制版（2026-11-19）：设置页不提示/不安装官方 Release；演示页照旧
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
  } else if (avail && UPD_FAMILY) {
    // 家庭定制版：官方包会覆盖学习面板/TIMO/小星星，不在这里装（web.py update_install 同样拒绝）
    title = '软件更新';
    text = `${cur}（家庭定制版）。官方 ${avail.version} 的修复已由维护者合并，不需要在这里更新`;
    label = '';
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
  const nag = !!avail && !busy && !UPD_FAMILY;
  $('upd').classList.toggle('new', nag);
  $('gearDot').classList.toggle('on', nag);
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
    if (s.screen) handlers.screen(s.screen);
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
  study: x => stOpen(x.mode, { ...x, level: x.level || (x.mode === 'flash' ? 'mixed' : undefined),   // 语音没说哪种 = 混合闯关
                                  auto: x.autostart || x.mode === 'flash' || (x.mode === 'dictation' && (x.words || []).length > 0) }),
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
  // 屏幕被熄屏程序调暗时暂停所有 CSS 动画（kiosk 用 CPU 渲染，光球的无限动画没人看也要吃 1~3 个核）；
  // 用 paused 而不是 none：亮屏时从原处接着动，不会跳一下
  screen(s) {
    document.documentElement.classList.toggle('asleep', s.on === false);
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
/* 页面自己念的话（HTML Audio）不进回声消除参考：对话麦克风开着就会把它当成孩子说话
   （11-19 12:15:18「Please take a new photo of your homework」被识别后又触发一次看作业）。念之前先收起正在听的麦。 */
const quietMic = () => fetch('/api/study/quiet', { method: 'POST' }).catch(() => {});
function speakText(text, lang) {
  if (!text) return;
  noteSaid(text);
  quietMic();
  if (HW.audio) { audioDrop(HW.audio); HW.audio = null; }
  const a = new Audio('/api/hw/tts?lang=' + encodeURIComponent(lang || 'yue') + '&text=' + encodeURIComponent(text));
  HW.audio = a;
  // 念完也拆管线；放在下一拍，让 quizSay 等 ended 的监听先跑完
  const fin = () => setTimeout(() => { if (HW.audio === a) HW.audio = null; audioDrop(a); }, 0);
  a.addEventListener('ended', fin, { once: true });
  a.addEventListener('error', fin, { once: true });
  a.play().catch(() => {});
  return a;
}
const isLatin = s => /^[\x00-\x7f\s]+$/.test(String(s || ''));
const stEl = id => document.getElementById(id);
const ST = { mode: 'flash', lang: 'en', flash: null, dict: null, read: null, ident: null, live: false };

const STUDY_EN = ['flash', 'timo', 'dictation', 'read', 'identify'];   // 学习类标签（清单不算）一律英文开
function stOpen(mode, opts) {
  opts = opts || {};
  const sheet = stEl('stSheet');
  if (!sheet) return;
  if (mode === 'book') { hwOpen(true, false); hwShowBook(); return; }
  // owner 2026-11-19「默认奥数就是 TIMO 的幼儿园和小一的，面板上也是」：闪卡的 olympiad 档改走 TIMO
  if (mode === 'flash' && opts.level === 'olympiad') { mode = 'timo'; opts = { ...opts, level: '' }; }
  // 已经在做同一种题（模型一句话里常连调两三次 study_open，11-18 20:50 / 11-19 08:19 每次都把题重开）：不重开
  const running = (mode === 'flash' && ST.flash && ST.flash.q) || (mode === 'timo' && TIMO.q);
  const sameLevel = () => !opts.level || (mode === 'flash' ? opts.level === ST.flash.level : opts.level === TIMO.level);
  if (sheet.classList.contains('on') && ST.mode === mode && running && sameLevel()) return;
  if (opts.language) ST.lang = opts.language;
  if (STUDY_EN.includes(mode)) ST.lang = 'en';   // owner 2026-11-19：TIMO 与所有学习默认英文交互（语言按钮可临时切）
  stLangPills();
  sheet.classList.add('on');
  stTab(mode || ST.mode, opts);
  // 语音打开的：不用再点「开始」，小麦那句说完就念第一题
  if ((opts.autostart || opts.auto) && mode === 'timo') timoStart(TIMO.level || 'k2', opts);   // 闪卡由 flashView(opts.auto) 自己开始
}
function stClose() {
  const sheet = stEl('stSheet');
  if (sheet) sheet.classList.remove('on');
  quizCancel();
  if (ST.flash) ST.flash.q = null;
  timoReset();
  studyPush();
  stLive(false);
  if (ST.flash) flashStop();
  listenCancel(); ST.rtGen = (ST.rtGen || 0) + 1; if (ST.dict) ST.dict.gen = (ST.dict.gen || 0) + 1;
  if (ST.read && ST.read.recording) fetch('/api/rec/stop', { method: 'POST' }).catch(() => {});
}
/* 语言按钮跟着 ST.lang 走：以前只有点击时才高亮，切到奥数自动改英文时按钮还停在粤语 */
function stLangPills() {
  document.querySelectorAll('.st-lang').forEach(x => x.classList.toggle('on', x.dataset.lang === ST.lang));
}
function stTab(mode, opts) {
  if (ST.flash && mode !== 'flash') flashStop();
  if (mode !== ST.mode) { listenCancel(); ST.rtGen = (ST.rtGen || 0) + 1; if (ST.dict) ST.dict.gen = (ST.dict.gen || 0) + 1; }
  ST.mode = mode;
  if (STUDY_EN.includes(mode)) ST.lang = 'en';   // owner 2026-11-19：TIMO 与所有学习默认英文交互
  if (ST.flash && ST.flash.tick) clearInterval(ST.flash.tick);
  if (ST.flash) ST.flash.q = null;
  timoReset();
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
  await sleepMs(120);
  // 原来是 60×200 ms = 12 s：等小麦退出 speaking/thinking。状态一旦卡住（TTS 收尾事件丢了），
  // 每道题点 Next 后都要干等 12 s——孩子只会觉得「点不动、死机」（2026-11-19）。最多等 2 s。
  const until = Date.now() + 2000;
  while (Date.now() < until && ui.status && (ui.status.state === 'speaking' || ui.status.state === 'thinking')) await sleepMs(120);
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
  if (HW.audio) { audioDrop(HW.audio); HW.audio = null; }
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
    d = { active: true, mode: 'timo', level: TIMO.level, n: Math.min(TIMO.n + 1, TIMO.total), total: TIMO.total, right: TIMO.right, streak: QV.streak,
          ans: TIMO.q.ans || 'num', opts: TIMO.q.opts || null, lang: ST.lang, question: timoText(TIMO.q),
          // 说答案（study_answer 转回页面）要能判题：答案+题型一起推，hub 只做「把话原样转回」
          kind: TIMO.q.ans || 'num', sec: TIMO.q.sec || '', reveal: !!TIMO.locked };
  fetch('/api/study/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).catch(() => {});
}

/* 星星：页面上立刻加、飘一颗星，同时记到设备（family.json），主屏横幅也显示今天的星星 */
/* 星星里程碑（2026-11-19：一天就攒了 273 颗，星星要有奔头）：总数到 50/100/200/300/500/1000… 大庆祝 + 念一句；
   星星胶囊下面一条进度条，写着下一个目标 */
const STAR_GOALS = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000];
const nextGoal = t => STAR_GOALS.find(g => g > t) || (Math.floor(t / 1000) + 1) * 1000;
const prevGoal = t => [0, ...STAR_GOALS].filter(g => g <= t).pop() || 0;
function starRender() {
  let el = stEl('stStars');
  const bar = document.querySelector('#stSheet .st-bar-r');
  if (!el && bar) { bar.insertAdjacentHTML('afterbegin', '<div class="st-stars" id="stStars"></div>'); el = stEl('stStars'); }
  const g = nextGoal(STARS.total), g0 = prevGoal(STARS.total), pct = Math.round(100 * (STARS.total - g0) / Math.max(1, g - g0));
  if (el) el.innerHTML = `⭐ <b>${STARS.today}</b><span>${STARS.total}/${g}🏆</span>`
    + `<i class="st-goal"><em style="width:${pct}%"></em></i>`;
}
function starMilestone(goal) {
  const box = document.createElement('div');
  box.className = 'star-milestone';
  box.innerHTML = `<b>🏆 ${goal}</b><span>${ST.lang === 'en' || HW.lang === 'en' ? `${goal} stars! You're a superstar!` : `${goal} 颗星！你是小明星！`}</span>`;
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4200);
  try { sfx('combo'); setTimeout(() => sfx('combo'), 300); } catch (e) {}
  QV.milestone = goal;                               // 一轮结束时念出来（现在念会打断题目）
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
/* 只刷会的题（owner 2026-11-20「防止只做会的题」）：同一档连续两轮一次全对 = 这档熟了。
   熟了的档星星减半（攒两颗给一颗）、没有全对奖励，升档的按钮一直在；挑战题照给满星。 */
const MASTER_LV = { timo: ['k2'], flash: ['add20', 'add100', 'times', 'div', 'chain'] };
const masterKey = (mode, level) => `mastery:${mode}:${level}`;
function isMastered(mode, level) {
  return (MASTER_LV[mode] || []).includes(level) && (Number(localStorage.getItem(masterKey(mode, level))) || 0) >= 2;
}
function noteMastery(mode, level, perfect) {
  if (!(MASTER_LV[mode] || []).includes(level)) return;
  const k = masterKey(mode, level);
  localStorage.setItem(k, perfect ? (Number(localStorage.getItem(k)) || 0) + 1 : 0);
}
function easyRoundStart(mode, level) {
  QV.easy = isMastered(mode, level); QV.easyAcc = 0;
  if (QV.easy) toast(tr({ yue: '呢档你好熟喇：星星减半，升一档攞满星！', zh: '这档你已经很熟了：星星减半，升一档拿满星！',
                          en: 'You know this level well: half stars here. Go up a level for full stars!' }));
}
function starGain(n, label, full) {
  if (!n) return;
  if (QV.easy && !full) {                 // 熟档：两颗折一颗
    QV.easyAcc = (QV.easyAcc || 0) + n;
    n = Math.floor(QV.easyAcc / 2); QV.easyAcc -= n * 2;
    if (!n) return;
  }
  const before = STARS.total;
  QV.roundStars += n; STARS.today += n; STARS.total += n;
  const hit = STAR_GOALS.filter(g => before < g && STARS.total >= g).pop();
  if (hit) setTimeout(() => starMilestone(hit), 1200);
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
  const ms = QV.milestone; QV.milestone = null;
  const msSay = ms ? { en: ` And you reached ${ms} stars! Superstar!`, yue: ` 仲有，你够 ${ms} 粒星喇！`, zh: ` 而且你攒够 ${ms} 颗星啦！` } : null;
  const bonus = perfect && !QV.easy ? 3 : 0;     // 熟档全对不再给奖励星
  if (bonus) setTimeout(() => starGain(3, ST.lang === 'en' ? 'Perfect round!' : '全对奖励'), 900);
  noteMastery(mode, level, perfect);              // timo 传进来的 right 就是「一次答对」
  const s = QV.roundStars + bonus;
  fetch('/api/stars/add', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stars: 0, round: { mode, level, right, total, seconds: sec, stars: s } }) }).catch(() => {});
  const half = right * 2 >= total;
  return {
    en: perfect ? `Perfect! All ${total} right! You earned ${s} stars!`
        : half ? `Well done! ${right} out of ${total}. You earned ${s} stars!`
        : `Good effort! ${right} out of ${total}, and ${s} stars. Practice makes you stronger!`,
    yue: perfect ? `全部啱晒！攞咗${s}粒星，好叻！` : `啱咗${right}题，攞咗${s}粒星！错嘅入咗错题本，下次再练`,
    zh: perfect ? `全对了！得了${s}颗星，真棒！` : `对了${right}题，得了${s}颗星！错的放进错题本，下次再练`,
  }[ST.lang] + (msSay ? msSay[ST.lang] || msSay.en : '') || '';
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
    if (!f || !f.q) { if (cmd === 'start' || d.value == null) flashStart(ST.flashLevel || 'mixed'); return; }
    if (f.locked) return;
    listenCancel();
    if (cmd === 'repeat' || cmd === 'mute' || cmd === 'unmute') return flashAsk();
    if (cmd === 'skip' || cmd === 'hint') { f.input = ''; return flashCheck(true); }
    if (d.value != null) { f.input = String(d.value); stEl('flA').textContent = f.input; flashCheck(true); }
  } else if (ST.mode === 'timo') {
    const q = TIMO.q;
    if (!q) { if (cmd === 'start' || d.value == null) timoStart(TIMO.level || 'k2', {}); return; }
    if (TIMO.locked) return;
    if (cmd === 'repeat' || cmd === 'mute' || cmd === 'unmute') return timoSay();
    if (cmd === 'hint') return timoHint();
    if (cmd === 'skip') return timoSkipAsk();
    if (q.ans === 'choice') {
      const t = timoNorm(d.text);
      const letter = (String(d.text || '').trim().match(/^[a-dA-D]$/) || [])[0];
      let hit = letter ? q.opts[letter.toUpperCase().charCodeAt(0) - 65] : null;
      if (!hit) hit = q.opts.find(o => timoNorm(o) && t.includes(timoNorm(o)));
      if (!hit && d.value != null) hit = q.opts.find(o => timoNorm(o) === String(d.value));
      if (hit) timoAnswer(hit, hit);
      else timoAsk(false, ST.lang === 'en' ? 'Which one? Say one of the choices on the screen.' : '选哪个？说屏幕上的一个');
      return;
    }
    if (d.value != null) timoAnswer(String(d.value), String(d.value));
  }
}

/* -- 口算闪卡（2026-11-17 起可以用嘴答：念题 → 孩子讲答案 → 本地判，不经大模型；键盘照样能用） -- */
// 奥数 = TIMO K2/P1（owner 2026-11-19）：「一年级奥数」档去掉，在「TIMO 奥数」标签里做；混合闯关每 3 题插的奥数也取 TIMO 题库
const FLASH_LEVELS = { mixed: '混合闯关', add20: '20 以内加减', add100: '100 以内加减', times: '乘法表', div: '除法',
                       chain: '口诀接龙', upper: '高年级', review: '错题重考' };
const FLASH_LEVELS_EN = { mixed: 'Challenge', add20: 'Up to 20', add100: 'Up to 100', times: 'Times tables', div: 'Division',
                          chain: 'Times chant', upper: 'Upper grades', review: 'Retry mistakes' };
const flEN = () => ST.lang === 'en';
/* 混合闯关的奥数题：优先用反背题模板现场生成（K2 数字题），不够才回退原卷题库（第 1 关 K2，往上 P1） */
function timoFlashPick(f) {
  const B = window.TIMO; if (!B) return null;
  const lv = f && f.tier >= 2 ? 'p1' : 'k2';
  const numOnly = q => q && q.ans !== 'choice' && /^-?\d+(\.\d+)?$/.test(String(q.a));
  let pool = B.GEN && B.GEN.length
    ? B.GEN.filter(g => g.lv === lv).map(g => g.make(Math.random)).filter(numOnly)
    : [];
  if (!pool.length) pool = B.BANK.filter(q => q.lv === lv).filter(numOnly);
  if (!pool.length) return null;
  const q = pool[rnd(0, pool.length - 1)];
  const text = ST.lang === 'en' ? q.qe : ST.lang === 'yue' ? q.qy : q.q;
  return [text, Number(q.a), null, true, 'timo:' + (q.src || '')];
}
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const CN_DIGIT = '零一二三四五六七八九';
/* 题库（2026-11-17）：全部按模板现出，答案是算出来的（整数或小数），语音判题才稳。
   q = [屏幕上的题, 答案, 念出来的话（没有就按屏幕念）, 是否应用题（屏幕不加「= ?」，用小字）] */
const pick = a => a[rnd(0, a.length - 1)];
const fmt = x => String(Math.round(x * 1000) / 1000);
const tr = o => o[ST.lang] || o.zh;
const CNN = n => n <= 10 ? (n === 10 ? '十' : CN_DIGIT[n]) : String(n);
const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const EN_ORD_DEN = { 2: 'half', 3: 'third', 4: 'quarter', 5: 'fifth', 6: 'sixth', 8: 'eighth', 10: 'tenth' };
const enOrd = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
const W = (zh, yue, en, a) => [tr({ zh, yue, en }), a, null, true];          // 应用题：屏幕和念的一样
const S = (screen, a, zh, yue, en) => [screen, a, tr({ zh, yue, en }), false]; // 算式：屏幕是算式，念的另写
const gcd = (a, b) => b ? gcd(b, a % b) : a;

const GEN = {
  add20() { const a = rnd(1, 19); if (Math.random() < .5) { const b = rnd(1, 20 - a); return [`${a} + ${b}`, a + b]; } const b = rnd(1, a); return [`${a} − ${b}`, a - b]; },
  add10gap() { const a = rnd(1, 9), b = rnd(1, 10 - a); return S(`${a} + □ = ${a + b}`, b, `${a}加几等于${a + b}？`, `${a}加幾多等於${a + b}？`, `${a} plus what makes ${a + b}?`); },
  add100() { const a = rnd(10, 99); if (Math.random() < .5) { const b = rnd(1, 100 - a); return [`${a} + ${b}`, a + b]; } const b = rnd(1, a); return [`${a} − ${b}`, a - b]; },
  times() { const a = rnd(2, 9), b = rnd(1, 9); return [`${a} × ${b}`, a * b]; },
  div() { const b = rnd(2, 9), q = rnd(1, 9); return [`${b * q} ÷ ${b}`, q]; },
  mul21() { const a = rnd(12, 99), b = rnd(2, 9); return [`${a} × ${b}`, a * b]; },
  div31() { const b = rnd(2, 9), q = rnd(12, 120); return [`${b * q} ÷ ${b}`, q]; },
  mul22() { const a = rnd(11, 39), b = rnd(11, 29); return [`${a} × ${b}`, a * b]; },
  mixedOps() {
    const a = rnd(2, 30), b = rnd(2, 9), c = rnd(2, 9);
    if (Math.random() < .5) return S(`${a} + ${b} × ${c}`, a + b * c, `${a}加${b}乘${c}等于几？`, `${a}加${b}乘${c}係幾多？`, `What is ${a} plus ${b} times ${c}?`);
    return S(`(${a} + ${b}) × ${c}`, (a + b) * c, `${a}加${b}的和，再乘${c}，等于几？`, `${a}加${b}嘅和，再乘${c}，係幾多？`, `Add ${a} and ${b}, then times ${c}. What do you get?`);
  },
  perim() { const l = rnd(3, 15), w = rnd(2, l); return W(`长方形长 ${l} 厘米，宽 ${w} 厘米，周长是多少厘米？`, `長方形長 ${l} 厘米，闊 ${w} 厘米，周長係幾多厘米？`, `A rectangle is ${l} cm long and ${w} cm wide. What is its perimeter in cm?`, 2 * (l + w)); },
  time() { const h = rnd(1, 3), m = pick([10, 15, 20, 30, 45]); return W(`${h} 小时 ${m} 分钟是多少分钟？`, `${h} 個鐘 ${m} 分鐘係幾多分鐘？`, `How many minutes are ${h} hours and ${m} minutes?`, 60 * h + m); },
  decAdd() {
    let a = rnd(1, 60), b = rnd(1, 60); if (Math.random() < .5) return [`${fmt(a / 10)} + ${fmt(b / 10)}`, (a + b) / 10];
    if (b > a) [a, b] = [b, a]; return [`${fmt(a / 10)} − ${fmt(b / 10)}`, (a - b) / 10];
  },
  decMul() { const a = pick([0.5, 0.2, 0.25, 1.5, 0.4, 2.5]), b = rnd(2, 12); return [`${a} × ${b}`, Math.round(a * b * 100) / 100]; },
  equation() {
    const x = rnd(2, 30), k = rnd(2, 40);
    if (Math.random() < .5) return S(`□ + ${k} = ${x + k}`, x, `一个数加${k}等于${x + k}，这个数是多少？`, `一個數加${k}等於${x + k}，呢個數係幾多？`, `A number plus ${k} is ${x + k}. What is the number?`);
    const m = rnd(2, 9), y = rnd(2, 12);
    return S(`${m} × □ = ${m * y}`, y, `${m}乘一个数等于${m * y}，这个数是多少？`, `${m}乘一個數等於${m * y}，呢個數係幾多？`, `${m} times a number is ${m * y}. What is the number?`);
  },
  lcmGcd() {
    const [a, b] = pick([[4, 6], [6, 8], [3, 4], [4, 10], [6, 9], [8, 12], [5, 6], [9, 12], [10, 15], [12, 18]]);
    if (Math.random() < .5) return W(`${a} 和 ${b} 的最小公倍数是多少？`, `${a} 同 ${b} 嘅最小公倍數係幾多？`, `What is the least common multiple of ${a} and ${b}?`, a * b / gcd(a, b));
    return W(`${a} 和 ${b} 的最大公因数是多少？`, `${a} 同 ${b} 嘅最大公因數係幾多？`, `What is the greatest common factor of ${a} and ${b}?`, gcd(a, b));
  },
  triangle() { const b = 2 * rnd(2, 10), h = rnd(3, 12); return W(`三角形底 ${b} 厘米，高 ${h} 厘米，面积是多少平方厘米？`, `三角形底 ${b} 厘米，高 ${h} 厘米，面積係幾多平方厘米？`, `A triangle has base ${b} cm and height ${h} cm. What is its area in square cm?`, b * h / 2); },
  average() { const m = rnd(10, 90), d1 = rnd(1, 9), d2 = rnd(1, 9), n = [m - d1, m + d2, m + d1 - d2]; return W(`${n.join('、')} 的平均数是多少？`, `${n.join('、')} 嘅平均數係幾多？`, `What is the average of ${n[0]}, ${n[1]} and ${n[2]}?`, m); },
  fraction() {
    const den = pick([2, 3, 4, 5, 6, 8, 10]), base = den * rnd(2, 12);
    let num = rnd(1, den - 1); while (gcd(num, den) !== 1) num = rnd(1, den - 1);   // 最简分数
    const cn = `${CNN(den)}分之${CNN(num)}`;
    const en = den === 2 ? 'half' : `${EN_ONES[num]} ${EN_ORD_DEN[den]}${num > 1 ? 's' : ''}`;
    return S(ST.lang === 'en' ? `${num}/${den} of ${base}` : `${base} 的 ${num}/${den}`, base / den * num, `${base}的${cn}是多少？`, `${base}嘅${cn}係幾多？`, `What is ${en} of ${base}?`);
  },
  percent() { const p = pick([10, 20, 25, 30, 40, 50, 75]), base = 20 * rnd(1, 20); return S(ST.lang === 'en' ? `${p}% of ${base}` : `${base} 的 ${p}%`, base * p / 100, `${base}的百分之${p}是多少？`, `${base}嘅百分之${p}係幾多？`, `What is ${p} percent of ${base}?`); },
  ratio() { const a = rnd(1, 4), b = rnd(1, 5), k = rnd(2, 8), t = (a + b) * k; return W(`男生和女生人数比是 ${a}:${b}，一共 ${t} 人，男生有几人？`, `男仔同女仔人數比係 ${a}:${b}，總共 ${t} 人，男仔有幾多人？`, `Boys to girls is ${a} to ${b}. There are ${t} children. How many are boys?`, a * k); },
  discount() {
    const p = 10 * rnd(2, 30), [z, off] = pick([['八', 20], ['九', 10], ['七', 30]]);
    return W(`一件衣服 ${p} 元，打${z}折后是多少元？`, `一件衫 ${p} 蚊，打${z}折之後係幾多蚊？`, `A shirt costs ${p} dollars. With ${off} percent off, how much is it?`, p * (100 - off) / 100);
  },
  // ---- 一年级奥数 ----
  oPattern() {
    const t = rnd(0, 2); let s;
    if (t === 0) { const a = rnd(1, 10), d = rnd(2, 5); s = [a, a + d, a + 2 * d, a + 3 * d, a + 4 * d]; }
    else if (t === 1) { const a = rnd(25, 40), d = rnd(2, 4); s = [a, a - d, a - 2 * d, a - 3 * d, a - 4 * d]; }
    else { const a = rnd(1, 5); s = [a, a + 1, a + 3, a + 6, a + 10]; }
    const shown = s.slice(0, 4);
    return [`${shown.join(', ')}, ?`, s[4], tr({ zh: `找规律：${shown.join('，')}，下一个数是几？`, yue: `搵規律：${shown.join('，')}，下一個數係幾多？`, en: `What comes next: ${shown.join(', ')}?` }), true];
  },
  oQueue() {
    const a = rnd(2, 8), b = rnd(2, 8);
    if (Math.random() < .5) return W(`小朋友排队，小明从前面数是第 ${a} 个，从后面数是第 ${b} 个。这一队一共有几人？`, `小朋友排隊，小明由前面數係第 ${a} 個，由後面數係第 ${b} 個。成隊一共有幾多人？`, `In a line, Tom is ${enOrd(a)} from the front and ${enOrd(b)} from the back. How many children are in the line?`, a + b - 1);
    return W(`小红前面有 ${a} 人，后面有 ${b} 人。这一队一共几人？`, `小紅前面有 ${a} 個人，後面有 ${b} 個人。成隊一共幾多人？`, `There are ${a} children in front of Amy and ${b} behind her. How many children are in the line?`, a + b + 1);
  },
  oSaw() { const n = rnd(3, 9); return W(`一根木头锯成 ${n} 段，要锯几次？`, `一條木鋸成 ${n} 段，要鋸幾多次？`, `How many cuts does it take to saw a log into ${n} pieces?`, n - 1); },
  oStairs() { const n = rnd(3, 8); return W(`从 1 楼走到 ${n} 楼，要走几层楼梯？`, `由 1 樓行到 ${n} 樓，要行幾多層樓梯？`, `How many flights of stairs from floor 1 to floor ${n}?`, n - 1); },
  oAge() { const me = rnd(5, 8), d = rnd(2, 5), y = rnd(2, 5); return W(`我今年 ${me} 岁，哥哥比我大 ${d} 岁。${y} 年后哥哥几岁？`, `我今年 ${me} 歲，哥哥大我 ${d} 歲。${y} 年之後哥哥幾多歲？`, `I am ${me}. My brother is ${d} years older. How old will he be in ${y} years?`, me + d + y); },
  oSweets() { const b = rnd(1, 4), x = rnd(2, 8); return W(`小红有 ${x + 2 * b} 颗糖，给小明 ${b} 颗后，两人一样多。小明原来有几颗？`, `小紅有 ${x + 2 * b} 粒糖，俾咗 ${b} 粒小明之後，兩個一樣多。小明本來有幾多粒？`, `Amy has ${x + 2 * b} sweets. After giving Tom ${b}, they have the same. How many did Tom have at first?`, x); },
  oMakeTen() {
    const p = rnd(1, 8), q = rnd(1, 8), A = 10 * rnd(1, 3) + (10 - p), B = 10 * rnd(1, 2) + (10 - q);
    return S(`${A} + ${B} + ${p} + ${q}`, A + B + p + q, `巧算：${A}加${B}加${p}加${q}等于几？`, `巧算：${A}加${B}加${p}加${q}係幾多？`, `Quick sum: ${A} plus ${B} plus ${p} plus ${q}?`);
  },
  oLegs() {
    const n = rnd(2, 6);
    if (Math.random() < .5) return W(`${n} 只鸡一共有几条腿？`, `${n} 隻雞一共有幾多隻腳？`, `How many legs do ${n} chickens have?`, 2 * n);
    return W(`${n} 只小狗一共有几条腿？`, `${n} 隻狗仔一共有幾多隻腳？`, `How many legs do ${n} dogs have?`, 4 * n);
  },
  oShare() { const k = rnd(2, 8); return W(`有 ${2 * k} 个苹果，每人分 2 个，可以分给几个人？`, `有 ${2 * k} 個蘋果，每人分 2 個，可以分俾幾多個人？`, `There are ${2 * k} apples. Each child gets 2. How many children get apples?`, k); },
};
// 混合闯关：从第 1 关（一年级）起，连对 2 题升一关、答错降一关；每 3 题插一道一年级奥数
const TIERS = [null, ['add20', 'add10gap'], ['add100', 'times'], ['div', 'mul21'], ['div31', 'mul22', 'mixedOps', 'perim', 'time'],
  ['decAdd', 'decMul', 'equation', 'lcmGcd'], ['triangle', 'average', 'fraction'], ['percent', 'ratio', 'discount']];
const OLYMPIAD = ['oPattern', 'oQueue', 'oSaw', 'oStairs', 'oAge', 'oSweets', 'oMakeTen', 'oLegs', 'oShare'];
const TIER_GRADE = ['', '一年级', '二年级', '二三年级', '三四年级', '五年级', '五六年级', '六年级'];
// 题库（/api/qbank，可更新）：应用题、奥数题。最近出过的不重复（记最近 300 道）
const QB = { items: [], at: 0 };
async function loadBank() {
  if (Date.now() - QB.at < 10 * 60e3 && QB.items.length) return;
  try { const d = await (await fetch('/api/qbank')).json(); if (d.ok) { QB.items = d.items || []; QB.at = Date.now(); QB.version = d.version; } } catch (e) {}
}
const TIER_GRADE_N = [0, 1, 2, 3, 4, 5, 5, 6];
function bankPick(pred) {
  let seen = []; try { seen = JSON.parse(localStorage.getItem('qbSeen') || '[]'); } catch (e) {}
  const okLang = it => ST.lang === 'en' ? it.en : (it.zh || it.yue);
  let pool = QB.items.filter(it => pred(it) && okLang(it) && !seen.includes(it.id));
  if (!pool.length) pool = QB.items.filter(it => pred(it) && okLang(it));       // 都出过了：允许重复
  if (!pool.length) return null;
  const it = pick(pool);
  seen.push(it.id); localStorage.setItem('qbSeen', JSON.stringify(seen.slice(-300)));
  const text = ST.lang === 'en' ? it.en : ST.lang === 'yue' ? (it.yue || it.zh) : it.zh;
  return [text, it.answer, null, true, 'qb:' + it.id];
}
function fromGen(names, f) {
  // 同一种题不连着出
  let name = pick(names);
  for (let k = 0; k < 5 && names.length > 1 && f && name === f.lastGen; k++) name = pick(names);
  if (f) f.lastGen = name;
  const q = GEN[name](); q[4] = name; return q;
}
function flashQuestion(level, f) {
  if (level === 'chain') {                       // 口诀接龙：某一张表从一顺到九，念「三七」答「二十一」
    const t = f.table, i = f.n + 1, a = Math.min(t, i), b = Math.max(t, i);
    return [`${a} × ${b}`, a * b, ST.lang === 'en' ? `${a} times ${b}?` : CN_DIGIT[a] + CN_DIGIT[b], false];   // 英文界面念 3 times 7
  }
  if (level === 'review') { const r = f.pool[f.n % f.pool.length]; return [r.q, r.a, null, !/^\S+ [+−×÷] \S+$/.test(r.q)]; }
  if (level === 'olympiad') return timoFlashPick(f) || fromGen(OLYMPIAD, f);
  if (level === 'upper') {
    // 连错两题就先回落到三年级题，连对两题再回高年级（11-20 09:06 一轮 4/10 用了 785 s，一题一分多钟干卡着）
    if (f.ease) return fromGen(TIERS[3], f);
    return (Math.random() < .3 && bankPick(it => !it.olympiad && it.grade >= 3)) || fromGen([].concat(TIERS[4], TIERS[5], TIERS[6], TIERS[7]), f);
  }
  if (level === 'mixed') {
    // 混合：每 3 题一道奥数（题库/模板各半）；其余 25% 题库应用题、20% 复习低关、其余本关
    const g = TIER_GRADE_N[f.tier];
    if ((f.n + 1) % 3 === 0) {                     // 第 1 关也插：一年级奥数本来就是一年级的
      return timoFlashPick(f) || fromGen(OLYMPIAD, f);
    }
    const r = Math.random();
    if (r < .25) { const q = bankPick(it => !it.olympiad && it.grade <= g && it.grade >= Math.max(1, g - 1)); if (q) return q; }
    if (r < .45 && f.tier > 1) return fromGen(TIERS[rnd(1, f.tier - 1)], f);
    return fromGen(TIERS[f.tier], f);
  }
  return GEN[level] ? GEN[level]() : GEN.add20();
}
function questionSpeech(q, lang) {
  if (q[2]) return q[2];
  if (q[3] || !/^\S+ [+−×÷] \S+$/.test(q[0])) return q[0];
  const [x, op, y] = q[0].split(' ');
  const w = { yue: { '+': '加', '−': '減', '×': '乘', '÷': '除以', end: '係幾多？' },
              zh: { '+': '加', '−': '减', '×': '乘', '÷': '除以', end: '等于几？' },
              en: { '+': 'plus', '−': 'minus', '×': 'times', '÷': 'divided by', end: '' } }[lang] || {};
  return lang === 'en' ? `What is ${x} ${w[op]} ${y}?` : `${x}${w[op]}${y}${w.end}`;
}

/* 识别结果 → 数字。hub 给的有「21」「二十一」「廿四」「6十3」几种写法；取最后一个数（「我諗係三十二」→ 32）。 */
const CN_VAL = { 零: 0, 〇: 0, 一: 1, 幺: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const EN_VAL = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function parseNum(text) {
  let s = String(text || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/．/g, '.')
    .replace(/一把|一伯|一柏/g, '一百').replace(/廿/g, '二十').replace(/卅/g, '三十').replace(/卌/g, '四十').replace(/點/g, '点');
  const runs = s.match(/[0-9零〇一幺二两兩三四五六七八九十百千点.]+/g);
  if (runs) {
    for (let k = runs.length - 1; k >= 0; k--) { const v = numRun(runs[k]); if (v !== null) return v; }
  }
  const words = s.toLowerCase().replace(/-/g, ' ').match(/[a-z]+/g) || [];
  let total = 0, cur = 0, any = false, dec = null;
  for (const wd of words) {
    if (dec !== null) { if (wd in EN_VAL && EN_VAL[wd] < 10) dec += String(EN_VAL[wd]); continue; }
    if (wd === 'point' && any) { dec = ''; continue; }
    if (wd === 'hundred') { cur = (cur || 1) * 100; any = true; }
    else if (wd === 'thousand') { total += (cur || 1) * 1000; cur = 0; any = true; }
    else if (wd in EN_VAL) { cur += EN_VAL[wd]; any = true; }
  }
  if (!any) return null;
  return Number(String(total + cur) + (dec ? '.' + dec : ''));
}
function numRun(r) {
  const i = r.search(/[点.]/);
  if (i < 0) return cnRun(r);
  const ip = r.slice(0, i), dp = r.slice(i + 1).replace(/[点.]/g, '');
  const iv = ip ? cnRun(ip) : 0;
  const ds = Array.from(dp).map(ch => /\d/.test(ch) ? ch : CN_VAL[ch]).filter(d => d !== undefined).join('');
  if (iv === null) return null;
  return ds ? Number(iv + '.' + ds) : iv;
}
function cnRun(r) {
  if (/^\d+$/.test(r)) return Number(r);
  let total = 0, cur = null, any = false;
  for (const ch of r) {
    const d = /\d/.test(ch) ? Number(ch) : CN_VAL[ch];
    if (d !== undefined) { cur = cur === null ? d : cur * 10 + d; any = true; }
    else if (ch === '十') { total += (cur === null ? 1 : cur) * 10; cur = null; any = true; }
    else if (ch === '百') { total += (cur === null ? 1 : cur) * 100; cur = null; any = true; }
    else if (ch === '千') { total += (cur === null ? 1 : cur) * 1000; cur = null; any = true; }
  }
  return any ? total + (cur || 0) : null;
}
function voiceCommand(text) {
  const t = String(text || '').toLowerCase();
  if (/(唔玩|不玩|停|结束|結束|唔做|不做了|stop|quit)/.test(t)) return 'stop';
  if (/(唔知|不知道|唔识|唔識|不会|不會|don.?t know|no idea)/.test(t)) return 'dunno';
  if (/(跳过|跳過|下一题|下一題|skip|next)/.test(t)) return 'skip';
  if (/(再讲|再講|再说|再說|重复|重複|again|repeat|咩话|咩話|什么|什麼)/.test(t)) return 'repeat';
  return null;
}

/* 音效：WebAudio 现合成，不用等网络。
   AudioContext 建了就一直在跑实时音频线程（设备上实测 webaudio 线程 ≈ 一个核），所以用完就挂起。 */
let sfxCtx = null, sfxIdle = null;
function sfx(kind) {
  try {
    sfxCtx = sfxCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (sfxCtx.state === 'suspended') sfxCtx.resume().catch(() => {});
    const notes = { good: [[880, 0], [1320, .09]], bad: [[220, 0], [196, .12]], combo: [[880, 0], [1100, .08], [1320, .16], [1760, .24]],
                    listen: [[660, 0]] }[kind] || [];
    const t0 = sfxCtx.currentTime + .01;
    for (const [hz, at] of notes) {
      const o = sfxCtx.createOscillator(), g = sfxCtx.createGain();
      o.type = kind === 'bad' ? 'triangle' : 'sine'; o.frequency.value = hz;
      g.gain.setValueAtTime(.0001, t0 + at); g.gain.exponentialRampToValueAtTime(.25, t0 + at + .015);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + at + (kind === 'listen' ? .12 : .22));
      o.connect(g).connect(sfxCtx.destination); o.start(t0 + at); o.stop(t0 + at + .3);
    }
    clearTimeout(sfxIdle);
    sfxIdle = setTimeout(() => { try { sfxCtx.suspend(); } catch (e) { /* 已关就算了 */ } }, 3000);
  } catch (e) { /* 没声音也照样判题 */ }
}
// 念一句并等它念完（最多 10 秒）；要是已经预取过同一句就直接用
const ttsCache = new Map();
function ttsAudio(text, lang) {
  const key = lang + '|' + text;
  let a = ttsCache.get(key);
  if (!a) {
    a = new Audio('/api/hw/tts?lang=' + encodeURIComponent(lang) + '&text=' + encodeURIComponent(text));
    a.preload = 'auto';
    ttsCache.set(key, a);
    if (ttsCache.size > 12) { const k0 = ttsCache.keys().next().value; audioDrop(ttsCache.get(k0)); ttsCache.delete(k0); }
  }
  return a;
}
function speakWait(text, lang) {
  return new Promise(res => {
    if (!text) return res();
    noteSaid(text);
    if (HW.audio) { audioDrop(HW.audio); HW.audio = null; }
    const a = ttsAudio(text, lang);
    ttsCache.delete(lang + '|' + text);            // 用过就丢，下次同一句重新取（Audio 不能可靠重播）
    HW.audio = a;
    let done = false;
    const fin = () => { if (!done) { done = true; clearTimeout(tm); if (HW.audio === a) HW.audio = null; audioDrop(a); res(); } };
    const tm = setTimeout(fin, 10000);
    a.addEventListener('ended', fin, { once: true });
    a.addEventListener('error', fin, { once: true });
    a.play().catch(fin);
  });
}
const PRAISE = {
  yue: { 3: '三连啱！', 5: '五连啱，劲呀！', 8: '八连啱，好犀利！', 10: '十连啱，冇得输！' },
  zh: { 3: '三连对！', 5: '五连对，厉害！', 8: '八连对，太强了！', 10: '十连对，满分！' },
  en: { 3: 'Three in a row!', 5: 'Five in a row!', 8: 'Eight in a row!', 10: 'Ten in a row!' },
};
const VOICE_SAY = {
  wrong: { yue: (q, a) => `差少少！${q}係${a}`, zh: (q, a) => `差一点！${q}是${a}`, en: (q, a) => `Nice try! It's ${a}` },
  unclear: { yue: '听唔清楚，再讲一次', zh: '没听清，再说一次', en: 'Sorry, say it again' },
  silent: { yue: '讲个答案出嚟啦', zh: '说出你的答案吧', en: 'Say your answer' },
  paused: { yue: '我等你，㩒继续就得', zh: '我等你，点继续就好', en: 'I will wait. Tap continue' },
};
const voiceOn = () => localStorage.getItem('flashVoice') !== 'off' && !document.body.classList.contains('mic-off');
// 听孩子讲一句（听写/清单用）：客户端断句 + hub 识别，不经大模型
function listenOnce(lang, wait) {
  return fetch('/api/listen', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, wait: wait || 15 }) }).then(x => x.json()).catch(() => ({ status: 'error' }));
}
const listenCancel = () => fetch('/api/listen/cancel', { method: 'POST' }).catch(() => {});
/* 回声过滤（2026-11-20 09:22 日志）：页面刚念完的句子被麦克风收回来当成孩子的话——
   'and I will go step by step' / 'now, step by step' 命中「讲讲」正则，讲解自己触发自己，还扣了星。
   记住最近 20 s 念过的句子；听到的是其中一段（够长，孩子的回答都很短）就当回声，重听一次。 */
const SAID = { text: '', at: 0 };
function noteSaid(t) {
  const now = Date.now();
  SAID.text = (now - SAID.at > 20000 ? '' : SAID.text + ' ') + String(t || '');
  if (SAID.text.length > 2000) SAID.text = SAID.text.slice(-2000);
  SAID.at = now;
}
const echoNorm = x => String(x || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
function isEcho(heard) {
  if (!heard || Date.now() - SAID.at > 20000) return false;
  const h = echoNorm(heard);
  const words = String(heard).trim().split(/\s+/).filter(Boolean).length;
  const cjk = (h.match(/[\u4e00-\u9fff]/g) || []).length;
  if (!(words >= 3 || cjk >= 4)) return false;
  return echoNorm(SAID.text).includes(h);
}
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
// 中文短句粗匹配：粤语/普通话常见写法统一后，按字算重合比例
const ZH_NORM = [[/食/g, '吃'], [/咗|晒|好咗|完了|好了|完/g, ''], [/嘅/g, '的'], [/冲凉|沖涼/g, '洗澡'], [/执|執/g, '收拾'],
                 [/书|書/g, '书'], [/喇|啦|了|呀|啊|㗎|咯|嘞|。|，|！|？|\s/g, '']];
function zhNorm(t) { let x = String(t || ''); for (const [a, b] of ZH_NORM) x = x.replace(a, b); return x.toLowerCase(); }
function overlap(item, heard) {
  const a = Array.from(zhNorm(item)), h = zhNorm(heard);
  if (!a.length) return 0;
  return a.filter(ch => h.includes(ch)).length / a.length;
}

function flashView(body, opts) {
  const level = FLASH_LEVELS[opts.level] ? opts.level : (ST.flashLevel || 'mixed');
  ST.flashLevel = level;
  const v = localStorage.getItem('flashVoice') !== 'off';
  const en = flEN(), names = en ? FLASH_LEVELS_EN : FLASH_LEVELS;
  const meta = en ? (level === 'chain' ? '9 questions. I say the first half, you finish it' : level === 'mixed' ? '10 questions. 2 right in a row = level up' : '10 questions. Say or tap your answer')
                  : (level === 'chain' ? '9 题一轮，我讲前半句，你接后半句' : level === 'mixed' ? '10 题一轮，连对两题升一关，答错降一关' : '10 题一轮');
  // 语音/键盘开关放行首（钉在左边）：放行尾时盖住最后一个档位「Retry mistakes」（owner 2026-11-19）
  body.innerHTML = `<div class="st-row"><button class="st-pill voice-pill${v ? ' on' : ''}" id="flVoiceT">${v ? (en ? '🎤 Say it' : '🎤 讲答案') : (en ? '⌨ Tap it' : '⌨ 按答案')}</button>
      ${Object.entries(names).map(([k, t]) =>
      `<button class="st-pill${k === level ? ' on' : ''}" data-lv="${k}">${t}</button>`).join('')}</div>
    <div class="flash"><div class="flash-q long" id="flQ">${en ? 'Tap Start or any key' : '点「开始」或任何数字'}</div><div class="flash-a" id="flA"></div>
      <div class="flash-voice" id="flV"></div>
      <div class="flash-meta" id="flMeta">${meta}</div>
      <div class="pad">${[1,2,3,4,5,6,7,8,9,'.',0,'⌫','✓'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>
      <div class="st-row flash-go-row"><button class="pri st-go" id="flGo">${en ? 'Start' : '开始'}</button></div></div>`;
  // 点档位直接开始（11-19 10:47 孩子连点 Times tables / Division 各 5 下：以前只换档、还要再找「开始」，像点不动）
  body.querySelectorAll('[data-lv]').forEach(b => b.addEventListener('click', () => { flashStop(); flashView(body, { level: b.dataset.lv, auto: true }); }));
  starRender();
  body.querySelectorAll('.pad button').forEach(b => b.addEventListener('click', () => flashKey(b.dataset.k)));
  stEl('flGo').addEventListener('click', () => {
    const f = ST.flash;
    if (f && f.paused && f.n <= f.total) { f.paused = false; stEl('flGo').hidden = true; flashAsk(); }
    else flashStart(level);
  });
  stEl('flVoiceT').addEventListener('click', () => {
    const on = localStorage.getItem('flashVoice') === 'off';
    localStorage.setItem('flashVoice', on ? 'on' : 'off');
    stEl('flVoiceT').classList.toggle('on', on); stEl('flVoiceT').textContent = on ? '🎤 讲答案' : '⌨ 按答案';
    if (!on) { fetch('/api/listen/cancel', { method: 'POST' }).catch(() => {}); flashVoiceLine(''); }
    else if (ST.flash && ST.flash.q && !ST.flash.locked) flashAsk();
  });
  if (opts.auto) flashStart(level, true);      // 语音叫出来的：直接开始，不用再㩒
}
function flashVoiceLine(t, cls) {
  const el = stEl('flV'); if (!el) return;
  el.textContent = t || ''; el.className = 'flash-voice' + (cls ? ' ' + cls : '');
}
function flashStop() {
  const f = ST.flash;
  if (f) { f.gen += 1; if (f.tick) clearInterval(f.tick); }
  fetch('/api/listen/cancel', { method: 'POST' }).catch(() => {});
}
// 混合闯关最高到第 3 关（一到三年级）：家里是 K2 和小一，升到 5–6 年级的百分数/比例就一路错（11-19 12:18 5/10、11:07 一轮 372 s）；
// 想做难的用「高年级」档
const MIXED_TOP = 3;
async function flashStart(level, fromVoice) {
  flashStop();
  if (stEl('flUp')) stEl('flUp').hidden = true;
  const f = ST.flash = { level, n: 0, total: level === 'chain' ? 9 : 10, right: 0, wrong: [], done: [], input: '', streak: 0, best: 0,
                         started: Date.now(), q: null, gen: (ST.flash ? ST.flash.gen : 0) + 1, table: rnd(2, 9), pool: [],
                         tier: Math.max(1, Math.min(MIXED_TOP, (Number(localStorage.getItem('flashTier')) || 1) - 1)), up: 0 };
  if (level === 'review') {
    const d = await fetch('/api/hw/book?days=60').then(r => r.json()).catch(() => ({}));
    const seen = new Set();
    for (const m of (d.mistakes || [])) {
      const q = String(m.question || '').replace(/\s*=\s*$/, '').trim(), a = Number(m.correct);
      if (m.fixed || m.subject !== '口算' || !q || !Number.isFinite(a) || seen.has(q)) continue;
      seen.add(q); f.pool.push({ q, a });
    }
    if (!f.pool.length) { toast('错题本里没有口算错题，好叻！'); return flashView(stEl('stBody'), { level: 'times' }); }
    f.pool.sort(() => Math.random() - .5);
    f.total = Math.min(10, f.pool.length);
  }
  const g0 = f.gen;
  if (['mixed', 'upper', 'olympiad'].includes(level)) await loadBank();
  if (f !== ST.flash || f.gen !== g0) return;
  QV.streak = 0; QV.roundStars = 0;
  easyRoundStart('flash', level);
  f.tick = setInterval(flashMeta, 500);
  stEl('flGo').hidden = true;
  if (voiceOn()) {
    flashVoiceLine('稍等…');
    await fetch('/api/quiz/prepare', { method: 'POST' }).catch(() => {});   // 等小麦讲完、收起对话
    if (f !== ST.flash || f.gen !== g0) return;   // flashStop 原地加 f.gen，旧写法永远相等（11-20 09:29 换到听写后 flQ 为 null）
  }
  if (!stEl('flQ')) return;
  flashNext();
}
function flashNext() {
  const f = ST.flash;
  if (!f || !stEl('flQ')) return;
  if (f.n >= f.total) return flashEnd();
  f.q = flashQuestion(f.level, f); f.input = ''; f.n += 1; f.tries = 0;
  stEl('flQ').classList.remove('end-score');
  stEl('flQ').textContent = f.q[3] || f.q[0].includes('=') ? f.q[0] : f.q[0] + ' = ?';   // 方程「□ + 3 = 8」本身带等号
  stEl('flQ').className = 'flash-q' + (f.q[3] ? ' long' : '');
  stEl('flA').textContent = ''; stEl('flA').className = 'flash-a';
  flashMeta();
  studyPush();
  if (voiceOn()) flashAsk(); else flashVoiceLine('');
}
async function flashAsk() {
  const f = ST.flash, gen = f.gen, n = f.n, lang = ST.lang;
  const stale = () => ST.flash !== f || f.gen !== gen || f.n !== n || f.locked || !voiceOn();
  if (!stEl('stSheet').classList.contains('on')) return;
  flashVoiceLine('🔊 读题…', 'speak');
  await speakWait(questionSpeech(f.q, lang), lang);
  for (let k = 0; k < 3; k++) {
    if (stale()) return;
    flashVoiceLine('🎤 在听…讲答案', 'listen'); sfx('listen');
    const r = await fetch('/api/listen', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang, wait: 7 }) }).then(x => x.json()).catch(() => ({ status: 'error' }));
    if (stale()) return;
    if (r.status === 'busy') { flashPause(false); return flashVoiceLine('小麦在讲嘢，㩒「继续」再答'); }
    if (r.status === 'cancelled') return;
    if (r.status === 'silent') {
      // owner 2026-11-19「小朋友在点，就不要后台小麦提醒没说话了」：刚点过屏幕就安静地等键盘，不催
      if (touchedRecently()) { flashVoiceLine(tr({ yue: '⌨ 用键盘答都得', zh: '⌨ 用键盘答也行', en: '⌨ Tap your answer' })); return; }
      if (k === 0) { flashVoiceLine(''); await speakWait(VOICE_SAY.silent[lang], lang); continue; }
      return flashPause(true);
    }
    if (r.status !== 'ok') { flashVoiceLine('听不到，可以用键盘答', ''); return; }
    const cmd = voiceCommand(r.text), num = parseNum(r.text);
    if (num === null && cmd === 'stop') { flashVoiceLine('听到：' + r.text); return flashEnd(true); }
    if (num === null && cmd === 'repeat') { flashVoiceLine('听到：' + r.text); await speakWait(questionSpeech(f.q, lang), lang); continue; }
    if (num === null && (cmd === 'dunno' || cmd === 'skip')) { flashVoiceLine('听到：' + r.text); f.input = ''; return flashCheck(true); }
    if (num === null) {
      flashVoiceLine('听到：' + (r.text || '（没听清）'));
      if (k < 2) { await speakWait(VOICE_SAY.unclear[lang], lang); continue; }
      return flashPause(true);
    }
    flashVoiceLine('听到：' + r.text);
    f.input = String(num); stEl('flA').textContent = f.input;
    return flashCheck(true);
  }
  flashPause(true);
}
function flashPause(say) {
  const f = ST.flash; f.paused = true;
  flashVoiceLine(flEN() ? '⏸ Tap Continue to answer' : '⏸ 㩒「继续」再答');
  const go = stEl('flGo'); go.hidden = false; go.textContent = flEN() ? 'Continue' : '继续';
  if (say && !touchedRecently()) speakText(VOICE_SAY.paused[ST.lang], ST.lang);
}
function flashMeta() {
  const f = ST.flash; if (!f) return;
  const sec = Math.round((Date.now() - f.started) / 1000);
  const m = stEl('flMeta');
  if (!m) return;
  if (flEN()) {
    const tier = f.level === 'mixed' ? ` · Level ${f.tier}` : '';
    m.textContent = `Question ${f.n}/${f.total}${tier} · ${f.right} right${f.streak >= 2 ? ` · 🔥 ${f.streak} in a row` : ''} · ⭐ ${QV.roundStars} · ${sec} s`;
    return;
  }
  const tier = f.level === 'mixed' ? ` · 第 ${f.tier} 关（${TIER_GRADE[f.tier]}）` : '';
  m.textContent = `第 ${f.n}/${f.total} 题${tier} · 答对 ${f.right}${f.streak >= 2 ? ` · 🔥连对 ${f.streak}` : ''} · ⭐ ${QV.roundStars} · ${sec} 秒`;
}
/* 键盘「点不动」的三种情况（11-19 10:46 0、✓ 后一秒连点 ✓ 15 下）都要看得见：
   没在出题（还没开始/一轮做完）→ 点任何键就开始一轮；判题讲解时键盘变暗（.wait）；没输数字就点 ✓ → 抖一下并提示 */
function flashNudge(text) {
  const a = stEl('flA'); if (!a) return;
  a.textContent = text; a.className = 'flash-a nudge';
  void a.offsetWidth; a.classList.add('shake');
}
function flashPadWait(on) { const p = document.querySelector('.flash .pad'); if (p) p.classList.toggle('wait', !!on); }
function flashKey(k) {
  const f = ST.flash;
  if (!f || !f.q) { flashStart(ST.flashLevel || 'mixed'); return; }
  // 讲解时点任何键 = 跳过讲解直接下一题（11-19 12:17:04 答错后 5 秒内连点 ✓ 13 下）
  if (f.locked) { if (f.skip) { if (HW.audio) { audioDrop(HW.audio); HW.audio = null; } f.skip(); } return; }
  if (k === '⌫') f.input = f.input.slice(0, -1);
  else if (k === '✓') {
    if (f.input) { fetch('/api/listen/cancel', { method: 'POST' }).catch(() => {}); flashCheck(false); }
    else flashNudge(flEN() ? 'Type a number first' : '先按数字');
    return;
  }
  else if (k === '.') { if (!f.input.includes('.')) f.input = (f.input || '0') + '.'; }
  else if (f.input.length < 6) f.input += k;
  stEl('flA').textContent = f.input;
}
async function flashCheck(byVoice) {
  const f = ST.flash, gen = f.gen, ok = f.input !== '' && Math.abs(Number(f.input) - f.q[1]) < 1e-6, a = stEl('flA'), lang = ST.lang;
  if (f.level === 'mixed') {
    if (ok) { f.up += 1; if (f.up >= 2 && f.tier < MIXED_TOP) { f.tier += 1; f.up = 0; f.levelUp = true; } }
    else { f.tier = Math.max(1, f.tier - 1); f.up = 0; }
    localStorage.setItem('flashTier', String(f.tier));
  }
  f.locked = true; flashPadWait(true);
  const item = { question: f.q[3] ? f.q[0] : f.q[0] + ' =', child_answer: f.input || '（不知道）', correct: fmt(f.q[1]), ok };
  f.done.push(item);
  if (ok) {
    f.right += 1; f.streak += 1; f.best = Math.max(f.best, f.streak); QV.streak = f.streak;
    f.miss = 0; if (f.ease && f.streak >= 2) f.ease = false;
    a.className = 'flash-a good'; a.textContent = f.input + ' ✓';
    starGain(1);                                                        // 小星星（2026-11-19）：答对 +1
    if (f.streak % 3 === 0) setTimeout(() => starGain(1, STREAK[ST.lang](f.streak)), 600);   // 每连对 3 题再 +1
    if (f.levelUp) setTimeout(() => starGain(1, tr({ yue: `升级！第${f.tier}关`, zh: `升级！第${f.tier}关`, en: `Level up! Level ${f.tier}` })), 1100);
    let p = PRAISE[lang][f.streak];
    if (f.levelUp) { f.levelUp = false; p = tr({ yue: `升级！第${f.tier}关`, zh: `升级！第${f.tier}关`, en: `Level up! Level ${f.tier}` }); }
    sfx(p ? 'combo' : 'good');
    flashMeta();
    await Promise.race([byVoice && p ? speakWait(p, lang) : sleepMs(byVoice ? 350 : 500), new Promise(r => { f.skip = r; })]);
    f.skip = null;
  } else {
    f.streak = 0; QV.streak = 0; f.wrong.push(item);
    f.miss = (f.miss || 0) + 1; if (f.level === 'upper' && f.miss >= 2) f.ease = true;
    a.className = 'flash-a bad'; a.textContent = `${f.input || '?'} ✗  = ${fmt(f.q[1])}`;
    sfx('bad'); flashMeta();
    const ans = fmt(f.q[1]);
    const say = f.q[3] || /[□(]/.test(f.q[0]) ? tr({ yue: `差少少！答案係${ans}`, zh: `差一点！答案是${ans}`, en: `Nice try! The answer is ${ans}` })
      : VOICE_SAY.wrong[lang](questionSpeech([f.q[0], f.q[1], f.q[2]], lang).replace(/(係幾多？|等于几？|^What is |\?$)/g, ''), ans);
    // 讲解可以点任何键跳过
    await Promise.race([byVoice ? speakWait(say, lang) : sleepMs(1600), new Promise(r => { f.skip = r; })]);
    f.skip = null;
  }
  // 讲解那 0.5–1.6 s 里换了标签（stTab → flashStop 加 gen、闪卡视图被换掉）：别再出下一题，
  // 否则 flashNext 找不到 #flQ 抛错（2026-11-19 回归抓到：答完 ✓ 马上点「TIMO 奥数」）
  if (ST.flash !== f || f.gen !== gen || ST.mode !== 'flash' || !stEl('flQ')) return;
  f.locked = false; flashPadWait(false);
  studyPush();
  flashNext();
}
function flashEnd(early) {
  const f = ST.flash; clearInterval(f.tick); f.gen += 1; f.q = null;
  fetch('/api/listen/cancel', { method: 'POST' }).catch(() => {});
  const sec = Math.round((Date.now() - f.started) / 1000), asked = f.done.length || 1;
  const stars = f.right === asked && asked >= f.total ? 3 : f.right / asked >= .7 ? 2 : f.right > 0 ? 1 : 0;
  const en = flEN();
  stEl('flQ').textContent = `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  ${en ? `${f.right} / ${f.done.length} right` : `答对 ${f.right} / ${f.done.length}`}`;
  stEl('flQ').className = 'flash-q end-score';   // 结果一行放得下（104 px 题面字号会折两行，把「升一级」挤出屏）
  stEl('flA').textContent = en
    ? `${sec} s · ⭐ +${QV.roundStars}${f.best >= 3 ? ` · best streak ${f.best}` : ''}${f.wrong.length ? ' · misses saved to your mistake book' : ''}`
    : `${sec} 秒 · ⭐ +${QV.roundStars}${f.best >= 3 ? ` · 最多连对 ${f.best}` : ''}${f.wrong.length ? ' · 错的已放进错题本' : ''}`;
  stEl('flA').className = 'flash-a end';
  flashVoiceLine('');
  const go = stEl('flGo'); go.hidden = false; go.textContent = flEN() ? 'Play again' : '再来一轮';
  // 固定档全对：一键升到下一档（11-19「Up to 20」一再 10/10、40 秒做完）
  const NEXT_LV = { add20: 'add100', add100: 'times', times: 'div', div: 'mixed' };
  const up = f.right === f.done.length && f.done.length >= f.total && NEXT_LV[f.level];
  let nb = stEl('flUp');
  if (!nb) { nb = document.createElement('button'); nb.id = 'flUp'; nb.className = 'pri st-go'; go.after(nb); }
  nb.hidden = !up;
  if (up) {
    nb.textContent = (flEN() ? 'Next level ▶ ' : '升一级 ▶ ') + (flEN() ? FLASH_LEVELS_EN : FLASH_LEVELS)[up];
    nb.onclick = () => { flashStop(); flashView(stEl('stBody'), { level: up, auto: true }); };
  }
  const all = f.right === f.done.length && f.done.length >= f.total;
  const say = { yue: all ? '全部啱晒，三粒星，好叻！' : `啱咗${f.right}题，攞到${stars}粒星${f.wrong.length ? '，错咗嘅放咗入错题本' : ''}`,
                en: all ? 'All correct, three stars!' : `${f.right} right, ${stars} stars`,
                zh: all ? '全对了，三颗星，真棒！' : `对了${f.right}题，得了${stars}颗星${f.wrong.length ? '，错的放进错题本了' : ''}` }[ST.lang];
  studyPush();
  const sayStars = f.done.length ? quizRoundEnd('flash', f.level, f.right, f.done.length, sec) : '';   // 记一轮 + 讲今轮攞了几粒星
  if (!early || f.done.length) speakText(sayStars || say, ST.lang);
  // 对的也记：错题本据此把以前错过、这次答对的题标成「改对了」，本周小结的正确率也才准
  if (f.done.length) fetch('/api/hw/record', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: '口算', source: f.level === 'review' ? 'review' : 'flash',
                           items: f.done.map((w, i) => ({ no: i + 1, ...w })) }) }).catch(() => {});
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
  body.innerHTML = `<div class="st-row"><button class="st-pill" id="dcBook">${LX('用错题本的词', 'Words from my mistake book')}</button>
      <button class="st-pill" id="dcSample">${LX('示例词', 'Sample words')}</button><span class="st-note">${LX('也可以说「帮我听写：苹果、香蕉……」', 'You can also say "dictation: apple, banana…"')}</span></div>
    <div class="dict"><div class="dict-n" id="dcN">${LX(`共 ${words.length} 个词`, `${words.length} words`)}</div>
      <div class="dict-w" id="dcW">${LX('准备好纸笔', 'Get your pencil and paper')}</div>
      <div class="st-row center"><button class="pri st-go" id="dcNext">${LX('开始', 'Start')}</button><button id="dcAgain" hidden>${LX('再念一次', 'Say it again')}</button></div>
      <div class="st-row center"><button id="dcShoot" hidden>${LX('写完了，拍照批改', 'Done — take a photo to check')}</button></div>
      <div class="flash-voice" id="dcV"></div></div>`;
  stEl('dcNext').addEventListener('click', dictNext);
  stEl('dcAgain').addEventListener('click', dictSay);
  stEl('dcShoot').addEventListener('click', dictShoot);
  stEl('dcBook').addEventListener('click', async () => { const w = await dictFromBook();
    if (!w.length) return toast('错题本里没有可以听写的词');
    dictView(body, { words: w }); });
  stEl('dcSample').addEventListener('click', () => dictView(body, { words: DICT_SAMPLE[ST.lang] }));
  if (opts.auto && opts.words && opts.words.length) dictNext();
}
function dictShoot() { if (ST.dict) ST.dict.gen = (ST.dict.gen || 0) + 1; listenCancel(); stClose(); hwOpen(true, false); hwCapture({ expected: ST.dict.words }); }
const dictLine = t => { const el = stEl('dcV'); if (el) { el.textContent = t || ''; el.className = 'flash-voice' + (/在听/.test(t || '') ? ' listen' : ''); } };
// 念两遍，念完一直听孩子的口令（写字要时间，每次等 15 秒，最多约 2 分钟）：
// 「下一个/写好了」→ 下一个；「再念一次」→ 重念；「写完了」→ 拍照批改。孩子边写边念词这些别的话一律不理。
async function dictSay() {
  const d = ST.dict, w = d.words[d.i];
  if (w == null) return;
  // 中文词不让英文声音念（学习默认英文后 ST.lang 常是 en）
  const gen = d.gen = (d.gen || 0) + 1, lang = isLatin(w) ? 'en' : (ST.lang === 'en' ? 'yue' : ST.lang);
  const stale = () => ST.dict !== d || d.gen !== gen || ST.mode !== 'dictation' || !stEl('stSheet').classList.contains('on');
  listenCancel();
  dictLine('🔊 念词…');
  await speakWait(w, lang); await sleepMs(1500); if (stale()) return;
  await speakWait(w, lang); if (stale()) return;
  if (!voiceOn()) return dictLine('');
  const last = d.i + 1 >= d.words.length;
  for (let k = 0; k < 8; k++) {
    dictLine(`🎤 在听…写好讲「${last ? '写完了' : '下一个'}」，听唔清讲「再念一次」`);
    const r = await listenOnce(ST.lang, 15);
    if (stale()) return;
    if (r.status === 'silent') continue;
    if (r.status !== 'ok') break;
    const t = r.text || '';
    if (/(再念|再讲|再講|再说|再說|重复|重複|听唔清|聽唔清|没听清|again|repeat)/i.test(t)) return dictSay();
    if (/(写完|寫完|拍照|影相|批改|finished)/i.test(t)) return last ? dictShoot() : dictNext();
    if (/(下一个|下一個|下个|下個|好咗|好了|写好|寫好|next|done|ok)/i.test(t)) return dictNext();
  }
  if (!stale()) dictLine('🎤 停咗听，㩒按钮继续');
}
function dictNext() {
  const d = ST.dict;
  d.i += 1;
  const n = stEl('dcN'), w = stEl('dcW'), next = stEl('dcNext');
  stEl('dcAgain').hidden = false;
  if (d.i >= d.words.length) {
    d.gen = (d.gen || 0) + 1; listenCancel(); dictLine('');
    n.textContent = LX('听写完了', 'All done'); w.textContent = LX('检查一下，再拍照批改', 'Check your work, then take a photo');
    next.hidden = true; stEl('dcAgain').hidden = true; stEl('dcShoot').hidden = false;
    speakText({ yue: '写完喇，检查下再影相', en: 'All done. Check your work, then take a photo', zh: '写完了，检查一下再拍照' }[ST.lang], ST.lang);
    return;
  }
  n.textContent = LX(`第 ${d.i + 1} / ${d.words.length} 个`, `Word ${d.i + 1} / ${d.words.length}`);
  w.textContent = '🔊 ' + '＿'.repeat(Math.min(6, String(d.words[d.i]).length));
  next.textContent = d.i + 1 === d.words.length ? LX('写完了', 'Done') : LX('下一个', 'Next');
  dictSay();
}

/* 学习面板固定文案：英文界面用英文（owner 2026-11-19「题目也是英文默认」） */
const LX = (zh, en) => ST.lang === 'en' ? en : zh;

/* -- 这是什么 -- */
function identView(body) {
  body.innerHTML = `<div class="st-split">${camBox(LX('拿一样东西到镜头前', 'Hold something up to the camera'))}<div class="st-side" id="idOut">
      <div class="st-note">${LX('拿一样东西到镜头前，点「认一认」，我会讲粤语、普通话、英文点叫。', 'Hold something up to the camera and tap "What is it?". I will tell you its name in English, Cantonese and Mandarin.')}</div></div></div>
    <div class="st-row"><button class="pri" id="idGo">${LX('认一认', 'What is it?')}</button></div>`;
  stLive(true);
  stEl('idGo').addEventListener('click', async () => { const d = await stShoot('identify'); if (d) identShow(d, true); });
}
function identShow(d, speak) {
  const out = stEl('idOut');
  if (!out) return;
  const shot = stEl('stShot');
  if (shot && d.thumb) { shot.src = d.thumb; shot.hidden = false; }
  if (d.sure === false) { out.innerHTML = `<div class="st-note">${esc((d.speech || {})[ST.lang] || (d.speech || {}).zh || LX('没看清，拿近一点再试', 'I could not see it. Bring it closer and try again'))}</div>`; return; }
  const row = (label, word, sub, lang) => `<div class="id-row" data-say="${esc(word)}" data-lang="${lang}"><em>${label}</em>
      <b>${esc(word || '')}</b><span>${esc(sub || '')}</span><i>🔊</i></div>`;
  const rows = [row('English', d.en, '', 'en'), row('粤语', d.yue, d.jyutping, 'yue'), row('普通话', d.zh, d.pinyin, 'zh')];
  out.innerHTML = (ST.lang === 'en' ? rows.join('') : rows[1] + rows[2] + rows[0])   // 英文界面英文排第一
    + (d.en_sentence ? `<div class="id-sent" data-say="${esc(d.en_sentence)}" data-lang="en">🔊 ${esc(d.en_sentence)}</div>` : '')
    + (d.fact ? `<div class="st-note">💡 ${esc(d.fact)}</div>` : '');
  out.querySelectorAll('[data-say]').forEach(el => el.addEventListener('click', () => speakText(el.dataset.say, el.dataset.lang)));
  if (speak) speakText((d.speech || {})[ST.lang] || d.zh, ST.lang);
}

/* -- 朗读检查 -- */
function readView(body) {
  ST.read = ST.read || { text: '' };
  body.innerHTML = `<div class="st-split">${camBox(LX('把课文放到镜头前', 'Hold the page up to the camera'))}<div class="st-side">
      <div class="read-text" id="rdText">${ST.read.text ? esc(ST.read.text) : `<span class="st-note">${LX('先拍下要读的课文', 'First take a photo of the page to read')}</span>`}</div>
      <div class="st-note" id="rdScore"></div></div></div>
    <div class="st-row"><button id="rdShoot">${LX('拍课文', 'Take a photo')}</button><button class="pri" id="rdGo" ${ST.read.text ? '' : 'disabled'}>${LX('开始读', 'Start reading')}</button></div>`;
  stLive(true);
  stEl('rdShoot').addEventListener('click', async () => {
    const d = await stShoot('ocr');
    if (!d) return;
    ST.read.text = (d.text || '').trim();
    stEl('rdText').textContent = ST.read.text || LX('没抄到字，放正一点再拍', 'No words found. Hold it straight and try again');
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
    r.recording = true; go.textContent = LX('读完了', 'Done'); go.classList.add('rec');
    stEl('rdScore').textContent = LX('在听… 读完停一停就得，或者点「读完了」', 'Listening… pause when you finish, or tap Done');
    // 读完静 2.5 秒自动收尾（不用再点）
    fetch('/api/rec/wait', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ silence: 2.5 }) })
      .then(x => x.json()).then(w => { if (w.status === 'ended' && ST.read === r && r.recording) readToggle(); }).catch(() => {});
    return;
  }
  r.recording = false; go.textContent = LX('在听写…', 'Checking…'); go.disabled = true; go.classList.remove('rec');
  let d = {};
  try { d = await (await fetch('/api/rec/stop', { method: 'POST' })).json(); } catch (e) {}
  go.disabled = false; go.textContent = LX('再读一次', 'Read again');
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
  stEl('rdScore').textContent = heard ? LX(`读对 ${pct}%，红色是读漏或读错的`, `${pct}% read right. Red words were missed`) : LX('没听到声音，靠近一点再读', 'I could not hear you. Come closer and read again');
  if (!heard) return;
  // 语音点评：百分比 + 星星 + 点名最多两处读漏的（连着漏的算一处）
  const miss = [];
  { let cur = '', k2 = 0;
    for (const piece of refRaw) {
      const isTok = latin ? /^[A-Za-z0-9']+$/.test(piece) : /[一-鿿0-9a-zA-Z]/.test(piece);
      if (!isTok) { if (!latin && cur) { miss.push(cur); cur = ''; } continue; }
      if (!hit[k2]) cur += (latin && cur ? ' ' : '') + piece; else if (cur) { miss.push(cur); cur = ''; }
      k2++;
    }
    if (cur) miss.push(cur); }
  const stars = pct >= 95 ? 3 : pct >= 80 ? 2 : pct >= 50 ? 1 : 0;
  stEl('rdScore').textContent = `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)} ` + LX(`读对 ${pct}%`, `${pct}% right`) + (miss.length ? LX('，红色是读漏或读错的', '. Red words were missed') : '');
  const top = miss.sort((a, b) => b.length - a.length).slice(0, 2).map(x => x.slice(0, 8));
  const L = ST.lang;
  const head = { yue: `读对${pct}%，${stars}粒星。`, zh: `读对了${pct}%，${stars}颗星。`, en: `${pct} percent, ${stars} stars. ` }[L];
  const tail = !top.length ? { yue: '全部读啱，好叻！', zh: '全都读对了，真棒！', en: 'Perfect reading!' }[L]
    : pct >= 90 ? { yue: `好叻！就差「${top.join('」同「')}」`, zh: `很棒！只差「${top.join('」和「')}」`, en: `Great! Just check: ${top.join(', ')}` }[L]
    : { yue: `「${top.join('」同「')}」再读多次`, zh: `「${top.join('」和「')}」再读一遍`, en: `Try again: ${top.join(', ')}` }[L];
  if (stars === 3) sfx('combo'); else if (stars >= 1) sfx('good');
  speakText(head + tail, L);
}

/* -- TIMO 奥数练习（2026-11-19）--
 * 题库在 timo_bank.js（S 盘 timo-papers 的 K2/幼稚园组与小一 P1 卷改写）。
 * 默认英文交互（owner 2026-11-19）：题面、提示、讲解、对错反馈都用英文走 /api/hw/tts（en 声音）；
 * 答题用数字键盘或选项。错题照旧进错题本（/api/hw/record），和口算闪卡同一条路。
 */
const TIMO = { level: 'k2', n: 0, total: 8, right: 0, firstRight: 0, retried: 0, skipTries: 0, wrong: [], input: '', q: null, list: null, started: 0, hintUsed: 0, sk: null };
/* 奥数面板固定英文：页面文案也走英文，切粤语/普通话按钮时同样生效 */
function timoUI() { return ST.lang === 'en'; }
const T_UI = {
  en: { start: 'Start', again: 'Repeat the question', hint: 'Hint', ready: 'Tap Start and I will read the question',
        meta: '8 questions. Listen first, then answer', done: 'Done', right: 'correct', used: 'seconds', allRight: 'All correct, well done!',
        inBook: 'The ones you missed went into your mistake book', retry: 'Try another round', loading: 'Question bank not loaded (timo_bank.js)',
        sec: 'topic', sk: 'Sketch', guide: 'Explain', review: 'reviewed', keys: 'Keys', clear: 'Clear' },
  yue: { start: '开始', again: '再听一次', hint: '提示', ready: '按「开始」听我读题',
         meta: '一次 8 题，先听题再答', done: '做完啦', right: '答对', used: '秒', allRight: '全对，好叻！',
         inBook: '错的题已经放进错题本', retry: '再来一轮', loading: '题库没载入（timo_bank.js）', sec: '题型',
         sk: '草稿', guide: '讲讲', review: '复练', keys: '数字', clear: '擦干净' },
  zh: { start: '开始', again: '再听一次', hint: '提示', ready: '按「开始」听我读题',
        meta: '一次 8 题，先听题再答', done: '做完啦', right: '答对', used: '秒', allRight: '全对，真棒！',
        inBook: '错的题已经放进错题本', retry: '再来一轮', loading: '题库没载入（timo_bank.js）', sec: '题型',
        sk: '草稿', guide: '讲讲', review: '复练', keys: '数字', clear: '擦干净' },
};
function timoT() { return T_UI[ST.lang] || T_UI.en; }
function timoBank() { return window.TIMO || null; }
function timoView(body, opts) {
  const B = timoBank(), t = timoT();
  if (!B) { body.innerHTML = `<div class="st-note">${t.loading}</div>`; return; }
  const level = opts.level && B.LEVELS.some(l => l.id === opts.level) ? opts.level : (TIMO.level || 'k2');  TIMO.level = level;
  const en = timoUI(), lv = B.LEVELS.find(l => l.id === level) || {};
  const note = (en && lv.note_en) || lv.note || '';
  body.innerHTML = `<div class="st-row">${B.LEVELS.map(l =>
      `<button class="st-pill${l.id === level ? ' on' : ''}" data-lv="${l.id}">${esc((en && l.name_en) || l.name)}</button>`).join('')}
      <span class="st-note">${esc(note)}</span></div>
    <div class="timo"><div class="timo-q" id="tqQ">${esc(t.ready)}</div>
      <div class="timo-a" id="tqA"></div>
      <div class="flash-voice" id="tqV"></div>
      <div class="timo-meta" id="tqMeta">${esc(t.meta)}</div>
      <div id="tqPad"></div>
      <div class="timo-sk" id="tqSk" hidden><canvas id="tqCv"></canvas><button id="tqSkClear">🧽 ${esc(t.clear)}</button></div>
      <div class="st-row"><button class="pri st-go" id="tqGo">${esc(t.start)}</button>
        <button id="tqGuide" hidden>🗣 ${esc(t.guide)}</button>
        <button id="tqSkTg" hidden>✍ ${esc(t.sk)}</button>
        <button id="tqSay" hidden>🔊 ${esc(t.again)}</button><button id="tqHint" hidden>💡 ${esc(t.hint)}</button>
        <button class="pri" id="tqNext" hidden>${timoUI() ? 'Next ▶' : '下一题 ▶'}</button></div></div>`;
  body.querySelectorAll('[data-lv]').forEach(b => b.addEventListener('click', () => { timoStop(); timoView(body, { level: b.dataset.lv }); timoStart(b.dataset.lv, {}); }));
  stEl('tqGo').addEventListener('click', () => timoStart(level, opts));
  stEl('tqSay').addEventListener('click', timoSay);
  stEl('tqHint').addEventListener('click', () => timoHint());
  stEl('tqGuide').addEventListener('click', () => timoExplain());
  stEl('tqSkTg').addEventListener('click', () => timoSkToggle());
  stEl('tqSkClear').addEventListener('click', () => { timoSkClear(); tqVoice(timoUI() ? 'Cleared' : '擦干净了'); });
  stEl('tqNext').addEventListener('click', () => {
    // 先立刻隐藏并停在原地，不能等念完再换题：孩子点完看不到变化就会连点（2026-11-19 一整屏的连点日志）
    stEl('tqNext').hidden = true;
    quizCancel(); listenCancel(); TIMO.n = Math.max(TIMO.n, TIMO.answered || 0); timoNext();
  });
  starRender();
}
function timoStop() { TIMO.gen = (TIMO.gen || 0) + 1; TIMO.q = null; clearTimeout(TIMO.idle); listenCancel(); TIMO.sk = null; }
/* 关面板/换标签时把草稿板也收掉：下次进来先看到数字键盘，不会被上一题的画占着 */
function timoReset() { timoStop(); timoSkToggle(false); }
async function timoStart(level, opts) {
  const B = timoBank();
  const n = Number(opts && opts.count) || 8;
  timoStop();
  TIMO.level = level;
  TIMO.list = B.pick(level, n);         // 反背题：这一轮的题面和数字都是现场生成的
  TIMO.n = 0; TIMO.right = 0; TIMO.firstRight = 0; TIMO.retried = 0; TIMO.skipTries = 0;
  TIMO.wrong = []; TIMO.input = ''; TIMO.hintUsed = 0; TIMO.answered = 0;
  QV.streak = 0; QV.roundStars = 0;
  // 熟档里掺两道上一档的挑战题（满星、多 1 颗），逼一逼，不只做会的
  if (level === 'k2' && isMastered('timo', 'k2')) {
    const ch = B.pick('p1', 2).map(q => Object.assign({}, q, { _ch: true }));   // 拷贝，别把标记写进题库原题
    TIMO.list.splice(-2, 2, ...ch);
    TIMO.list.sort(() => Math.random() - .5);
  }
  easyRoundStart('timo', level);
  TIMO.roundSize = TIMO.list.length; TIMO.total = TIMO.roundSize; TIMO.started = Date.now();
  stEl('tqGo').hidden = true;
  stEl('tqSay').hidden = false; stEl('tqHint').hidden = false;
  stEl('tqGuide').hidden = false; stEl('tqSkTg').hidden = false;
  const k2btn = stEl('tqK2'); if (k2btn) k2btn.hidden = true;
  const upbtn = stEl('tqUp'); if (upbtn) upbtn.hidden = true;
  if (voiceOn()) await fetch('/api/quiz/prepare', { method: 'POST' }).catch(() => {});   // 等小麦讲完、收起对话再念题
  timoNext();
}
function timoText(q) {
  return ST.lang === 'en' ? q.qe : ST.lang === 'yue' ? q.qy : q.q;
}
/* 选项在英文界面用 optse（有的题原卷选项是中文：猫/狗/兔），判题仍按 opts/a */
const timoOptLabel = (q, i) => (ST.lang === 'en' && q.optse && q.optse[i]) || q.opts[i];
const timoAnsLabel = q => { const i = (q.opts || []).findIndex(o => timoNorm(o) === timoNorm(q.a)); return i >= 0 ? timoOptLabel(q, i) : q.a; };
function timoOptsSpeech(q) {
  if (q.ans !== 'choice' || !q.opts) return '';
  const labels = q.opts.map((o, i) => timoOptLabel(q, i));
  return ST.lang === 'en' ? ' Is it ' + labels.join(', or ') + '?' : ' 选：' + labels.join('，');
}
function tqVoice(t, cls) { const el = stEl('tqV'); if (el) { el.textContent = t || ''; el.className = 'flash-voice' + (cls ? ' ' + cls : ''); } }
/* 选择题口头作答：字母 A-D、选项原文、或数字等于某个选项 */
/* 数字答案口头兜底：两位数孩子常说成「十二」「一十二」，parseNum 未必拿到；
   这里再从原文里揪出「一到两位数字」并和答案比对，避免听对了却判成没听懂 */
function timoMatchNumber(q, text) {
  const want = timoNorm(q.a);
  const t = String(text || '');
  if (timoNorm(t).indexOf(want) >= 0) return q.a;
  const digs = (t.match(/[0-9]+/g) || []).map(d => String(Number(d)));
  if (digs.indexOf(want) >= 0) return q.a;
  // 中文数字整段转换：小孩常说「十二」「二十三」而不是 12、23
  const D = { '零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
  const cn2num = s => s.replace(/[零一二两三四五六七八九十廿]+/g, w => {
    // 「十二」「十六」是 12、16，不是 102、106：十开头时十位是 1
    if (w === '十') return '10';
    if (w[0] === '十') return String(10 + (D[w[1]] || 0));
    if (w.indexOf('十') >= 0) {
      const [a, b] = w.split('十');
      const hi = a ? (D[a] || 0) : 1, lo = b ? (D[b] || 0) : 0;
      return String(hi * 10 + lo);
    }
    return Array.from(w).map(ch => D[ch] ).join('');
  });
  const cn = cn2num(t);
  const nums = (cn.match(/[0-9]+/g) || []).map(d => String(Number(d)));
  return nums.indexOf(want) >= 0 ? q.a : null;
}
function timoMatchChoice(q, text) {
  const t = timoNorm(text);
  const letter = (String(text || '').trim().match(/^[a-dA-D][.。!！]?$/) || [''])[0][0];
  if (letter) return q.opts[letter.toUpperCase().charCodeAt(0) - 65] || null;
  const hit = q.opts.find(o => timoNorm(o) && t.includes(timoNorm(o)));
  if (hit) return hit;
  const ie = (q.optse || []).findIndex(o => timoNorm(o) && t.includes(timoNorm(o)));
  if (ie >= 0) return q.opts[ie];
  const v = parseNum(text);
  return v === null ? null : (q.opts.find(o => timoNorm(o) === String(v)) || null);
}
/* ===== 草稿板（owner 2026-11-19「快速的做一个靠背来写」）=====
   右栏从数字键盘换成画布：手指/鼠标写竖式、画圈、凑数，换题自动清空。
   pointer 事件统一处理触摸和鼠标；画布按 devicePixelRatio 放大，线条才不会糊。 */
function timoSketch() {
  const cv = stEl('tqCv'); if (!cv) return null;
  const w = Math.max(120, cv.clientWidth || 320), h = Math.max(160, cv.clientHeight || 320);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#4fc3ff';
  TIMO.sk = { cv, ctx, w, h, drawing: false };
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (x) {}
    TIMO.sk.drawing = true;
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  });
  cv.addEventListener('pointermove', e => {
    if (!TIMO.sk || !TIMO.sk.drawing) return;
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  });
  const up = () => { if (TIMO.sk) TIMO.sk.drawing = false; };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(k => cv.addEventListener(k, up));
  return TIMO.sk;
}
function timoSkClear() {
  const S = TIMO.sk; if (!S) return;
  S.ctx.clearRect(0, 0, S.w + 8, S.h + 8);
  S.ctx.beginPath();
}
function timoSkToggle(on) {
  const sk = stEl('tqSk'), pad = stEl('tqPad'), tg = stEl('tqSkTg');
  if (!sk || !tg || !pad) return;
  const want = on === undefined ? sk.hidden : !!on;
  sk.hidden = !want;
  pad.hidden = want;
  tg.textContent = want ? '⌨ ' + (timoUI() ? 'Keys' : '数字') : '✍ ' + timoT().sk;
  TIMO.sk = null;
  if (want) requestAnimationFrame(() => timoSketch());
}

/* ===== 错题详解 + 引导（owner 2026-11-19「错题也要出一个详细的说明和引导，语音交互的」）=====
   不是一句「答案是 X」，而是：读题 → 给线索 → 一步一步算 → 落到答案 → 换一组数据再练一道。
   讲完留 5 秒听孩子回话：说「明白了」就下一题，说「再讲一次」就重讲，直接讲对答案也会被夸。
   任何时候点屏幕/按数字 = 直接下一题，不会被长讲解困住。 */
function timoGuideLines(q) {
  const en = ST.lang === 'en';
  const exp = q.expe || q.exp || '';
  const hint = ST.lang === 'en' ? (q.hinte || q.hint) : (ST.lang === 'yue' ? (q.hinty || q.hint) : q.hint);
  const ans = timoAnsLabel(q);
  const how = q.howto ? (en ? (q.howtoe || q.howto) : q.howto) : '';
  return en
    ? [`Let's read the question again. ${timoText(q)}`,
       `Here is the clue: ${hint}`,
       `Now step by step. ${exp}`,
       `So the answer is ${ans}. ${how}`.trim(),
       `Now a brand new one of the same kind. Let's try it together.`]
    : [`我们再读一次题：${timoText(q)}`,
       `先看线索：${hint}`,
       `我们一起一步一步算：${exp}`,
       `所以答案是 ${ans}。${how}`,
       `换一组数，再来一道同型的题，这次你自己算给我看。`];
}
async function timoSpeakGuide(q) {
  const gen = TIMO.gen;
  // 只看 gen 不够：讲解中点「提示」、再点「讲讲」，两段话同时往下念、互相打断，麦克风全收进去（11-20 09:22–09:23）
  const talk = TIMO.talk = (TIMO.talk || 0) + 1;
  TIMO.guideAt = Date.now();
  for (const line of timoGuideLines(q)) {
    if (TIMO.gen !== gen || TIMO.talk !== talk) return false;
    await quizSay(line, ST.lang, false);
    if (TIMO.gen !== gen || TIMO.talk !== talk) return false;
  }
  return true;
}
async function timoAfterGuide(q) {
  if (!voiceOn() || TIMO.q !== q) return;
  const gen = TIMO.gen;
  await sleepMs(300);
  if (TIMO.gen !== gen || TIMO.q !== q) return;
  tqVoice(timoUI() ? '🎤 Say "got it", or "again", or say the answer' : '🎤 说「明白了」「再讲一次」，或者直接讲答案', 'listen');
  let r = await listenOnce(ST.lang, 6);
  if (TIMO.gen !== gen || TIMO.q !== q) return;
  if (r.status === 'ok' && isEcho(r.text)) { pageLog('note', 'timo 回声丢弃: ' + r.text); r = await listenOnce(ST.lang, 5); if (TIMO.gen !== gen || TIMO.q !== q) return; }
  if (r.status !== 'ok') return tqVoice('');
  const low = String(r.text || '').toLowerCase();
  tqVoice((timoUI() ? 'Heard: ' : '听到：') + (r.text || ''));
  if (/(明白|懂了|知道|识了|ok|got it|i see|understand|yes)/.test(low)) return;
  if (/(再讲|再讲一次|again|repeat|唔明|不明白|听不懂)/.test(low)) return timoSpeakGuide(q);
  const ans = q.ans === 'choice' ? timoMatchChoice(q, r.text) : (timoMatchNumber(q, r.text) || (() => { const v = parseNum(r.text); return v === null ? null : String(v); })());
  if (ans != null && timoNorm(ans) === timoNorm(q.a)) { tqVoice(timoUI() ? 'Yes! You got it now.' : '对了！这次你自己算出来了'); sfx('good'); }
}
/* 错题/跳过的题：按同型模板换一组数据放回队尾，必须再做一次（原题重来只会背答案） */
function timoRetryPush(q) {
  const B = timoBank();
  let nq = (B && B.variant && B.variant(q)) || null;
  if (!nq) nq = Object.assign({}, q);
  nq._re = true;
  TIMO.list.push(nq);
  TIMO.retried = (TIMO.retried || 0) + 1;
  return nq;
}

/* 念题 → 本机断句听一句（/api/listen，hub 只做识别，不进大模型）→ 判。和闪卡 flashAsk 同一套 */
async function timoAsk(readQuestion, prefix) {
  const q = TIMO.q, gen = TIMO.gen, lang = ST.lang;
  const talk = TIMO.talk = (TIMO.talk || 0) + 1;     // 新的一段说话/听：之前没讲完的讲解自动收声
  const stale = () => TIMO.q !== q || TIMO.gen !== gen || TIMO.talk !== talk || TIMO.locked || !stEl('stSheet').classList.contains('on');
  if (!q) return;
  const text = [prefix || '', readQuestion ? timoText(q) + timoOptsSpeech(q) : ''].filter(Boolean).join(' ');
  if (text) { tqVoice(timoUI() ? '🔊 Reading…' : '🔊 读题…', 'speak'); await quizSay(text, lang, false); }
  if (readQuestion && TIMO.q === q) TIMO.readyAt = Date.now();      // 题念完才开始算思考时间
  if (stale() || !voiceOn()) { if (!stale()) tqVoice(''); return; }
  await sleepMs(300);                    // 喇叭里还有尾音：ended 比声音出完早，马上开麦会收到自己（09:22 waited 0.1 s）
  let echoes = 0;
  for (let k = 0; k < 3; k++) {
    if (stale()) return;
    tqVoice(timoUI() ? '🎤 Listening… say your answer' : '🎤 在听…讲答案', 'listen'); sfx('listen');
    const r = await listenOnce(lang, 8);
    if (stale()) return;
    if (r.status === 'cancelled') return;
    if (r.status === 'busy') return tqVoice(timoUI() ? 'Tap 🔊 to hear it again' : '㩒 🔊 再听一次');
    if (r.status === 'silent') {
      if (touchedRecently() || k > 0) return tqVoice(timoUI() ? '⌨ Tap your answer, or 🔊 to hear it again' : '⌨ 点答案，或者 🔊 再听一次');
      tqVoice(''); await speakWait(VOICE_SAY.silent[lang], lang); continue;
    }
    if (r.status !== 'ok') return tqVoice(timoUI() ? 'Tap your answer' : '点答案就行');
    if (isEcho(r.text) && echoes++ < 2) { pageLog('note', 'timo 回声丢弃: ' + r.text); k -= 1; continue; }
    tqVoice((timoUI() ? 'Heard: ' : '听到：') + (r.text || ''));
    const cmd = voiceCommand(r.text), low = String(r.text || '').toLowerCase();
    if (cmd === 'stop') return stClose();
    if (cmd === 'repeat') { await speakWait(timoText(q) + timoOptsSpeech(q), lang); continue; }
    if (cmd === 'skip') return timoSkipAsk();
    if (/讲解|讲讲|解释|一步一步|explain|teach|step by step/.test(low)) return timoExplain();
    if (cmd === 'dunno' || /提示|hint|help|clue/.test(low)) return timoHint();
    const ans = q.ans === 'choice' ? timoMatchChoice(q, r.text) : (timoMatchNumber(q, r.text) || (() => { const v = parseNum(r.text); return v === null ? null : String(v); })());
    if (ans !== null && ans !== undefined) {
      const i = q.ans === 'choice' ? q.opts.findIndex(o => timoNorm(o) === timoNorm(ans)) : -1;
      return timoAnswer(ans, i >= 0 ? timoOptLabel(q, i) : ans);
    }
    if (k < 2) await speakWait(q.ans === 'choice' ? (timoUI() ? 'Which one? Say one of the choices.' : '选边个？讲一个选项') : VOICE_SAY.unclear[lang], lang);
  }
  tqVoice(timoUI() ? '⌨ Tap your answer' : '⌨ 点答案');
}
function timoSay() { const q = TIMO.q; if (!q) return; listenCancel(); timoAsk(true); }
/* 「讲讲/一步一步」：只讲不清题，孩子还能自己再答（讲过 = 这题只算 1 颗星） */
function timoExplain() {
  const q = TIMO.q; if (!q || TIMO.locked) return;
  // 连点两下（11-20 09:23:54/55）不重头再讲；正在讲就别打断
  if (TIMO.guideQ === q && Date.now() - (TIMO.guideAt || 0) < 3000) return;
  TIMO.guideQ = q;
  listenCancel();
  TIMO.hintUsed += 1;
  TIMO.input = '';                       // 答案框被讲解盖住了，旧数字看不见：清掉，免得接着按成「2466」
  const note = stEl('tqA');
  if (note) { note.textContent = '🗣 ' + (timoUI() ? 'Step by step…' : '一步一步讲…'); note.className = 'timo-a'; }
  // 讲完不能干站着：接着听孩子作答
  timoSpeakGuide(q).then(done => { if (done && TIMO.q === q && !TIMO.locked) timoAsk(false); });
}
/* 反跳过（owner 2026-11-19「要避免小朋友跳过不会的」）：
   说「跳过/不会」不再直接翻页。前两次只给提示并请他再想；
   第三次才揭晓，而且这题会换一组数回到队尾 —— 跳过 = 多做一道同型题，白跳不了。 */
function timoSkipAsk() {
  const q = TIMO.q; if (!q || TIMO.locked) return;
  TIMO.skipTries = (TIMO.skipTries || 0) + 1;
  if (TIMO.skipTries >= 3) return timoAnswer('__skip__', '—');
  timoHint(timoUI() ? 'No skipping. Let me give you a clue first.' : '不能跳过，我先给你一个提示。');
}
function timoHint(prefix) {
  const q = TIMO.q; if (!q || TIMO.locked) return;
  TIMO.hintUsed += 1;
  TIMO.input = '';                       // 提示盖住了答案框：旧数字看不见就别留着（11-20 09:23 「24」+「66」=2466，连按 5 次 ⌫）
  const t = ST.lang === 'en' ? (q.hinte || q.hint) : ST.lang === 'yue' ? (q.hinty || q.hint) : q.hint;
  const note = stEl('tqA');
  if (note) { note.textContent = '💡 ' + t; note.className = 'timo-a'; }
  listenCancel();
  timoAsk(false, (typeof prefix === 'string' ? prefix + ' ' : '') + t);
}
function timoNext() {
  const q = TIMO.list && TIMO.list[TIMO.n];
  if (!q) return timoEnd();
  TIMO.gen = (TIMO.gen || 0) + 1;
  TIMO.q = q; TIMO.input = ""; TIMO.locked = false; TIMO.hintUsed = 0; TIMO.tries = 0; TIMO.skipTries = 0;
  TIMO.readyAt = Date.now() + (voiceOn() ? 4000 : 0); TIMO.thinkUntil = 0;   // 有声音时念题约 4 s，念完 timoAsk 会改成真实时间
  if (TIMO.sk) timoSkClear();            // 换题清草稿：上一题的演算不留在这一题
  const n = stEl('tqQ'), a = stEl('tqA'), pad = stEl('tqPad');
  // owner 2026-11-19「出题的时候，题目在屏幕也要有」：题面整句显示，不只念；题号和题型放到下面一行
  n.textContent = timoText(q);
  a.className = 'timo-a'; a.textContent = '';
  stEl('tqNext').hidden = true;
  const no = Math.min(TIMO.n + 1, TIMO.total);
  const rev = TIMO.n >= TIMO.total ? (timoUI() ? ' · review' : ' · 复练') : '';
  stEl('tqMeta').textContent = timoUI()
    ? `Question ${no} / ${TIMO.total}${rev}${q._ch ? ' · ⭐ challenge' : ''} · say or tap your answer · ⭐ ${QV.roundStars}`
    : `第 ${no} / ${TIMO.total} 题（${q.sec}）${rev}${q._ch ? ' · ⭐挑战题' : ''} · 说答案或点 · ⭐ ${QV.roundStars}`;
  // 选择题：2 个选项横向大按钮、3 个以上纵向；数字题：键盘 + 一句「说答案也可以」
  pad.innerHTML = q.ans === 'choice'
    ? `<div class="timo-opts${q.opts.length <= 2 ? ' two' : ''}">${q.opts.map((o, i) => `<button data-o="${i}">${String.fromCharCode(65 + i)}. ${esc(timoOptLabel(q, i))}</button>`).join('')}</div>`
    : `<div class="pad">${[1,2,3,4,5,6,7,8,9,'⌫',0,'✓'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>
       <div class="timo-tip">${timoUI() ? '🎤 You can also just say the answer' : '🎤 也可以直接说答案，不用按键'}</div>`;
  if (q.ans === 'choice') {
    pad.querySelectorAll('[data-o]').forEach(b => b.addEventListener('click', () => {
      if (TIMO.locked) return timoKey('next');      // 讲解中点选项 = 下一题
      if (timoThinking()) return;
      listenCancel(); timoAnswer(q.opts[Number(b.dataset.o)], timoOptLabel(q, Number(b.dataset.o)));
    }));
  } else {
    pad.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => timoKey(b.dataset.k)));
  }
  studyPush();
  setTimeout(() => { if (TIMO.q === q) timoAsk(true); }, 250);
  timoIdle();
}
/* 25 s 没作答也没提示过：自动给提示（念 + 上屏），算用过提示（答对 1 颗）。11-19 小一两轮 2/8、4/8，卡住就干等 */
const TIMO_IDLE_MS = 25000;
function timoIdle() {
  clearTimeout(TIMO.idle);
  const q = TIMO.q;
  TIMO.idle = setTimeout(() => {
    if (TIMO.q === q && !TIMO.locked && !TIMO.hintUsed && !TIMO.input && stEl('stSheet').classList.contains('on')) timoHint();
  }, TIMO_IDLE_MS);
}
/* 不仔细想就乱按（owner 2026-11-20「不仔细思考」）：答错后 4 秒「想一想」——这时按数字/选项只提示倒数，
   不能连点把选项一个个试出来。按钮不 disabled（灰掉的按钮收不到点按，孩子以为死机），只给看得见的倒数 */
const THINK_MS = 4000, FAST_MS = 3000;
function timoThinking() {
  const left = (TIMO.thinkUntil || 0) - Date.now();
  if (left <= 0) return false;
  tqNudge((timoUI() ? 'Think first… ' : '先想一想… ') + Math.ceil(left / 1000));
  return true;
}
function timoKey(k) {
  const q = TIMO.q; if (!q) return;
  if (TIMO.locked) {
    // 讲解中（TIMO.locked）按任何数字：直接进下一题，跟闪卡一个口径。
    // 以前全部被吞掉，按钮看着在、按了没反应，孩子就以为卡死（2026-11-19 18:07 日志里成串的连点）。
    const nx = stEl('tqNext');
    if (nx && !nx.hidden) nx.click();
    return;
  }
  timoIdle();
  if (k !== '⌫' && timoThinking()) return;
  if (k === '⌫') {
    if (!TIMO.input) return tqNudge(timoUI() ? 'Nothing to delete' : '没有数字可删');
    TIMO.input = TIMO.input.slice(0, -1);
  }
  else if (k === '✓') {
    if (TIMO.input) { listenCancel(); timoAnswer(TIMO.input, TIMO.input); }
    else tqNudge(timoUI() ? 'Tap a number first' : '先按数字');
    return;
  }
  else if (TIMO.input.length < 6) TIMO.input += k;
  stEl('tqA').textContent = TIMO.input;
  stEl('tqA').className = 'timo-a';
}
/* 按下去有没有生效要看得见：2026-11-19 18:07 孩子一秒敲 13 次 ⌫，就是「按了没反应」 */
function tqNudge(msg) {
  const a = stEl('tqA'), q = TIMO.q;
  if (!a) return;
  a.textContent = msg;
  a.className = 'timo-a nudge';
  void a.offsetWidth;
  a.classList.add('shake');
  clearTimeout(TIMO.nudge);
  TIMO.nudge = setTimeout(() => {
    if (TIMO.locked || TIMO.q !== q) return;   // 已经换题/在讲解：别把新题的输入框抹掉
    a.textContent = TIMO.input || '';
    a.className = 'timo-a';
  }, 900);
}
function timoNorm(s) { return String(s == null ? "" : s).replace(/[\s,，、。.元蚊$]/g, "").toLowerCase(); }
/* 选项按钮的状态要看得见（11-19 09:06 孩子在讲解时连点「P」30 多下，按钮锁了却没任何样子）：
   错的那个变红并禁用；揭晓/答对后正确项变绿、其余全部禁用，出「下一题 ▶」 */
function timoMarkOpts(q, wrongOpt, reveal) {
  document.querySelectorAll('#tqPad [data-o]').forEach(b => {
    const o = q.opts[Number(b.dataset.o)];
    if (wrongOpt !== undefined && timoNorm(o) === timoNorm(wrongOpt)) { b.classList.add('bad'); b.disabled = true; }
    // 揭晓后只变暗（.off），不 disabled：disabled 的按钮收不到点按，19:00 前后孩子对着灰掉的 ✓ 连点 14 次没反应。
    // 现在讲解时点任何键/选项 = 下一题（timoKey / 选项点按里判 TIMO.locked）
    if (reveal) { b.classList.add('off'); if (timoNorm(o) === timoNorm(q.a)) b.classList.add('good'); }
  });
  if (reveal) document.querySelectorAll('#tqPad [data-k]').forEach(b => b.classList.add('off'));
}
async function timoAnswer(given, shown) {
  const q = TIMO.q; if (!q || TIMO.locked) return;
  const gen = TIMO.gen;
  TIMO.locked = true;
  const skipped = given === '__skip__';
  const ok = !skipped && timoNorm(given) === timoNorm(q.a);
  const a = stEl('tqA');
  const exp = ST.lang === 'en' ? (q.expe || q.exp) : (q.exp || q.expe);
  let say = null;
  tqVoice('');
  if (ok) {
    TIMO.right += 1;
    if (!(TIMO.tries || TIMO.hintUsed || TIMO.skipTries || q._re)) TIMO.firstRight += 1;   // 第一次自己答对才算「一次答对」
    a.className = 'timo-a good';
    a.textContent = `${shown} ✓  ${exp}`;
    // 自己第一次就对 2 颗，提示/再想之后对 1 颗；选项不多时错一次再选对 = 排除出来的，不给星
    const elim = q.ans === 'choice' && TIMO.tries && (q.opts || []).length <= 3;
    say = quizRight(elim ? 0 : TIMO.tries || TIMO.hintUsed ? 1 : 2) + ' ' + exp;
    if (elim) say = tr({ yue: '啱喇。不过呢次系排除出嚟嘅，下次谂清楚先拣。', zh: '对了。不过这次是排除出来的，下次先想清楚再选。',
                         en: 'Right. But that was by elimination. Next time, think it through first.' }) + ' ' + exp;
    if (q._ch && !TIMO.tries && !TIMO.hintUsed) setTimeout(() => starGain(1, timoUI() ? 'Challenge!' : '挑战题', true), 800);
    sfx('good');
  } else if (!skipped && !TIMO.tries) {
    // 第一次错：先鼓励，给提示，再想一次（不揭答案、不放行）
    TIMO.tries = 1; QV.streak = 0;
    TIMO.thinkUntil = Date.now() + THINK_MS;
    const fast = Date.now() - (TIMO.readyAt || 0) < FAST_MS;      // 题刚念完就答错：多半是蒙的
    TIMO.fastWrong = (TIMO.fastWrong || 0) + (fast ? 1 : 0);
    const hint = ST.lang === 'en' ? (q.hinte || q.hint) : (ST.lang === 'yue' ? (q.hinty || q.hint) : q.hint);
    a.className = 'timo-a bad';
    a.textContent = `${shown} ✗  💡 ${hint}`;
    if (q.ans === 'choice') timoMarkOpts(q, given, false);
    sfx('bad');
    TIMO.locked = false; TIMO.input = '';
    studyPush();
    timoAsk(false, (fast ? tr({ yue: '答得太快喇，慢慢嚟，读清楚条题先。', zh: '答得太快啦，慢一点，先把题读清楚。', en: 'That was very fast. Slow down and read it carefully.' }) + ' ' : '')
      + pickOne(TRY_AGAIN[ST.lang] || TRY_AGAIN.en) + ' ' + hint
      + ' ' + (timoUI() ? 'Or say "explain" and I will go step by step.' : '或者讲「讲讲」，我一步一步讲。'));
    return;
  } else {
    QV.streak = 0;
    TIMO.wrong.push({ question: timoText(q), child_answer: skipped ? '' : String(given), correct: String(q.a), ok: false });
    const reveal = { yue: '答案系', en: 'The answer is', zh: '答案是' }[ST.lang];
    a.className = 'timo-a bad';
    a.textContent = `${skipped ? '' : shown + ' ✗  '}${reveal} ${timoAnsLabel(q)}. ${exp}`;
    if (!skipped) sfx('bad');
    if (!q._re) timoRetryPush(q);        // 换一组数放回队尾，必须再做一次
  }
  if (q.ans === 'choice') timoMarkOpts(q, ok ? undefined : given, true); else timoMarkOpts(q, undefined, true);
  TIMO.n += 1; TIMO.answered = TIMO.n;
  stEl('tqNext').hidden = false;
  studyPush();
  // 讲解期间孩子点屏幕/按数字 = 直接下一题（timoKey/选项点按里改 TIMO.gen），讲解要立刻让位
  if (say) await quizSay(say, ST.lang, false);
  else await timoSpeakGuide(q);          // 错题：读题 → 线索 → 分步 → 答案 → 换数据再练
  if (TIMO.gen !== gen) return;          // 已经翻页了：别再等听完
  if (!say) { await timoAfterGuide(q); if (TIMO.gen !== gen) return; }
  await sleepMs(250);
  if (TIMO.gen === gen) timoNext();
}
function timoEnd() {
  const sec = Math.round((Date.now() - TIMO.started) / 1000), t = timoT();
  TIMO.q = null;
  stEl('tqQ').textContent = timoUI()
    ? `${t.done}: ${TIMO.firstRight} / ${TIMO.total} ${t.right} first time${TIMO.retried ? ` · ${TIMO.retried} ${t.review}` : ''}, ${sec} ${t.used}`
    : `${t.done}：一次答对 ${TIMO.firstRight} / ${TIMO.total}${TIMO.retried ? `，复练 ${TIMO.retried} 题` : ''}，用了 ${sec} ${t.used}`;
  stEl('tqA').className = 'timo-a';
  stEl('tqA').textContent = TIMO.firstRight === TIMO.total ? t.allRight : t.inBook;
  stEl('tqPad').innerHTML = '';
  tqVoice('');
  stEl('tqSay').hidden = true; stEl('tqHint').hidden = true; stEl('tqNext').hidden = true;
  stEl('tqGuide').hidden = true; stEl('tqSkTg').hidden = true;
  timoSkToggle(false);
  const go = stEl('tqGo'); go.hidden = false; go.textContent = t.retry;
  clearTimeout(TIMO.idle);
  // 小一不到一半：一键换幼稚园组（11-19 小一 2/8、4/8，幼稚园 6/8）
  let k2 = stEl('tqK2');
  if (!k2) { k2 = document.createElement('button'); k2.id = 'tqK2'; k2.className = 'pri'; go.after(k2); }
  k2.hidden = !(TIMO.level === 'p1' && TIMO.firstRight * 2 < TIMO.total);
  k2.textContent = timoUI() ? 'Try Kindergarten (K2) ▶' : '换幼稚园组 ▶';
  k2.onclick = () => { timoStop(); timoView(stEl('stBody'), { level: 'k2' }); timoStart('k2', {}); };
  // 幼稚园组连两轮一次全对：给「挑战小一」（11-20 早上 K2 八轮七轮 8/8，约 100 s 一轮，已经太容易）
  let pk = Number(localStorage.getItem('timoK2Perfect')) || 0;
  if (TIMO.level === 'k2') { pk = TIMO.firstRight === TIMO.total ? pk + 1 : 0; localStorage.setItem('timoK2Perfect', pk); }
  let up = stEl('tqUp');
  if (!up) { up = document.createElement('button'); up.id = 'tqUp'; up.className = 'pri'; k2.after(up); }
  up.hidden = !(TIMO.level === 'k2' && pk >= 2);
  up.textContent = timoUI() ? 'Ready for Grade 1? ▶' : '挑战小一 ▶';
  up.onclick = () => { timoStop(); timoView(stEl('stBody'), { level: 'p1' }); timoStart('p1', {}); };
  studyPush();
  quizSay(quizRoundEnd('timo', TIMO.level, TIMO.firstRight, TIMO.total, sec), ST.lang, false);
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
    <div class="flash-voice" id="rtV"></div>
    <div class="st-note">做完一样直接讲，例如「刷完牙了」；讲「仲有咩」听剩低嘅。改清单也直接说，例如「晚上清单加冲凉」。每天自动清零。</div>`;
  if (opts && opts.which) ST.rtWhich = opts.which;
  if (voiceOn() && !ST.rtLoop) routineListen();
  else if (ST.rtLoop) { const v = stEl('rtV'); if (v) { v.textContent = ST.rtLine || ''; v.className = 'flash-voice listen'; } }
  body.querySelectorAll('.rt-item').forEach(b => b.addEventListener('click', async () => {
    const on = !b.classList.contains('on');
    await fetch('/api/routine/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: b.dataset.list, index: Number(b.dataset.i), done: on }) });
  }));
}

// 清单语音打勾：面板开着就一直听（每次 15 秒），2 分钟没人讲话就停
function rtLists() {
  const r = (FAM.state && FAM.state.routine) || {};
  const pref = ST.rtWhich || (new Date().getHours() < 14 ? 'morning' : 'evening');
  return [pref, pref === 'morning' ? 'evening' : 'morning'].map(k => ({ key: k, items: (r[k] || {}).items || [], done: new Set((r[k] || {}).done || []) }));
}
function rtSay(text) { return speakWait(text, ST.lang); }
const rtLine = t => { ST.rtLine = t; const v = stEl('rtV'); if (v) { v.textContent = t || ''; v.className = 'flash-voice' + (/在听/.test(t || '') ? ' listen' : ''); } };
async function routineListen() {
  const gen = ST.rtLoop = (ST.rtGen = (ST.rtGen || 0) + 1);
  const stale = () => ST.rtGen !== gen || ST.mode !== 'routine' || !stEl('stSheet').classList.contains('on') || !voiceOn();
  const L = ST.lang;
  let idleSince = Date.now();
  try {
    await fetch('/api/quiz/prepare', { method: 'POST' }).catch(() => {});   // 等小麦讲完「清单喺屏幕上」再听
    while (!stale() && Date.now() - idleSince < 120000) {
      rtLine('🎤 在听…做完一样就讲，例如「刷完牙了」');
      const r = await listenOnce(L, 15);
      if (stale()) return;
      if (r.status === 'silent') continue;
      if (r.status === 'cancelled') break;                      // 别的地方叫停（关面板、换功能）
      if (r.status !== 'ok') { await sleepMs(1500); continue; }   // busy：小麦在讲嘢，等一下再听
      idleSince = Date.now();
      const t = r.text || '', lists = rtLists();
      const left = lists[0].items.filter((_, i) => !lists[0].done.has(i));
      if (/(仲有咩|仲有乜|还有什么|還有什麼|还要做|剩低|剩下|下一样|下一樣|what.?s left|next)/i.test(t)) {
        rtLine('听到：' + t);
        await rtSay(left.length ? { yue: `仲有${left.length}样：${left.join('，')}`, zh: `还有${left.length}项：${left.join('，')}`, en: `${left.length} left: ${left.join(', ')}` }[L]
                                : { yue: '全部做晒喇', zh: '全部做完了', en: 'All done' }[L]);
        continue;
      }
      let best = null;
      for (const l of lists) l.items.forEach((it, i) => {
        if (l.done.has(i)) return;
        const sc = overlap(it, t);
        if (sc >= 0.5 && (!best || sc > best.sc)) best = { key: l.key, i, it, sc, l };
      });
      if (!best) { rtLine('听到：' + t + '（清单入面冇呢样）'); continue; }
      rtLine('✓ ' + best.it);
      await fetch('/api/routine/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list: best.key, index: best.i, done: true }) }).catch(() => {});
      best.l.done.add(best.i);
      const rest = best.l.items.filter((_, i) => !best.l.done.has(i));
      if (!rest.length) { sfx('combo'); await rtSay({ yue: '全部搞掂，好叻！', zh: '全部完成，真棒！', en: 'All done. Well done!' }[L]); }
      else { sfx('good'); await rtSay({ yue: `${best.it}，搞掂！下一样：${rest[0]}`, zh: `${best.it}，完成！下一项：${rest[0]}`, en: `${best.it}, done! Next: ${rest[0]}` }[L]); }
    }
    if (!stale()) rtLine('🎤 停咗听，再开清单或者㩒一下就得');
  } finally {
    if (ST.rtGen === gen) ST.rtLoop = 0;
  }
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
  if (ST.mode === 'routine' && stEl('stSheet').classList.contains('on')) routineView(stEl('stBody'), {});
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
/* 语言按钮要立刻看得见变化（11-19 晚孩子在 TIMO 里连点「普通话」9 次：以前只改 ST.lang，屏幕上的题到下一题才换） */
document.querySelectorAll('.st-lang').forEach(b => b.addEventListener('click', () => {
  const same = ST.lang === b.dataset.lang;
  ST.lang = b.dataset.lang; document.querySelectorAll('.st-lang').forEach(x => x.classList.toggle('on', x === b));
  toast({ en: 'English', yue: '粤语', zh: '普通话' }[ST.lang] + (same ? '' : ' ✓'));
  if (same) return;
  if (ST.mode === 'timo' && TIMO.q) {
    const q = TIMO.q;
    stEl('tqQ').textContent = timoText(q);
    document.querySelectorAll('#tqPad [data-o]').forEach(o => { const i = Number(o.dataset.o); o.textContent = `${String.fromCharCode(65 + i)}. ${timoOptLabel(q, i)}`; });
    if (!TIMO.locked) { listenCancel(); timoAsk(true); }   // 换了语言就用新语言再念一遍（和「再听一次」同一条路）
  } else if (ST.mode === 'flash' && ST.flash) flashMeta();
}));
