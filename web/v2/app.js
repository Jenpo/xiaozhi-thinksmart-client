// ThinkSmart voice client page v2: renders what the client streams on /events and sends the buttons back.
// Same contract as v1. Open with ?demo (or ?demo=<scene>) to preview without a client.
const $ = id => document.getElementById(id);

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
    // 不带城市：hub 的上下文里已有本地 7 天预报，模型直接答，不用多走一轮 get_weather 工具
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
  ['夜间', [
    ['晚安', '#5ee0ff24', '#8ff0ff', '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'],
    ['把屏幕亮度调到 20%', '#ffb54729', '#ffcf7a', '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'],
    ['明天早上 7 点叫我', '#9b7bff2b', '#c8b4ff', '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3l-2 3M19 3l2 3"/>'],
  ]],
];

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
  for (const [q, bg, fg, icon] of SCENES[i][1]) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `<i style="background:${bg};color:${fg}"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></i>${esc(q)}`;
    b.addEventListener('click', async () => {
      // 点了立即给反馈：卡片进 loading，避免用户以为没点中而重复点
      b.classList.add('sending');
      b.setAttribute('aria-busy', 'true');
      try {
        await post('/api/text', { text: q });
      } catch (e) {
        toast('这句话没发出去，再点一次', 'error');
      } finally {
        b.classList.remove('sending');
        b.removeAttribute('aria-busy');
      }
    });
    box.appendChild(b);
  }
}

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
  // 前端用 22:00-07:00 的本地时钟兜底，保证夜里总能提示到
  const now = new Date();
  const hour = now.getHours();
  const quiet = hour >= 22 || hour < 7;
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
    text = backendUp() ? '后台在，点麦克风开始对话' : '还没连上后台，点麦克风会重新连';
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
// volumeByTarget：每个通路各存各的音量。原来 MP.volume 是单一全局值，切到电视拉到
// 电视音量后再切回本机，滑杆显示的是上一个目标的值，一动就把错值写到新目标。
const MP = { target: 'local', queue: [], idx: -1,
             volumeByTarget: { local: 55, tv: 30 },
             playing: false, title: '', nowTitle: '', startedAt: 0, volTimer: null, pollFailed: false,
             // 非本机通路的真实状态（从后台查 HA 实体得到）：{state, playing, title, artist}
             remote: { state: '', playing: false, title: '', artist: '' } };
Object.defineProperty(MP, 'volume', {
  get() { return this.volumeByTarget[this.target]; },
  set(v) { this.volumeByTarget[this.target] = Math.max(0, Math.min(100, Number(v) || 0)); },
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

function renderMusic() {
  const tv = musicEntity(MUSIC.tv);
  const tvOn = !!(tv && tv.on);
  const pill = $('musicPill');
  if (!pill) return;

  const localOn = MP.playing && MP.target === 'local';
  pill.classList.toggle('playing', localOn || tvOn);
  $('musicTitle').textContent = MP.playing ? (MP.title || '在放') : '放点音乐';
  $('musicSub').textContent = MP.playing ? ({ local: '本机', tv: '电视' })[MP.target] : '随机播放';

  // 音响选择状态
  for (const t of ['local', 'tv']) {
    const el = $('mt' + (t === 'local' ? 'Local' : 'Tv'));
    if (el) {
      el.classList.toggle('on', MP.target === t);
      el.setAttribute('aria-checked', MP.target === t ? 'true' : 'false');
    }
  }
  const ls = $('mtLocalState');
  if (ls) ls.textContent = localOn ? '在放' : '扬声器';
  const ts = $('mtTvState');
  if (ts) {
    const tvLive = tvOn || (MP.target === 'tv' && MP.remote.playing);
    ts.textContent = !tv ? '没接上' : (tv.state === 'unavailable' ? '连不上' : (tvLive ? '开着' : '关着'));
  }

  // 非本机通路：面板标题/副标以 MP.remote 为准。原来只看 MP.playing，
  // 而 MP.playing 只在轮询回来时才更新，切到 HomePod 后要等 4 秒且第一次轮询
  // 失败就永远停在「现在没在放」——设备已经在出声，面板却说没放。
  const remoteLive = MP.target !== 'local' && MP.remote.playing;
  const nowTitle = MP.target !== 'local' ? (MP.remote.title || (remoteLive ? '在放' : ''))
                                        : (MP.playing ? (MP.nowTitle || MP.title || '在放') : '');
  const nowPlaying = MP.target !== 'local' ? remoteLive : MP.playing;

  $('musicNowTitle').textContent = nowPlaying ? (nowTitle || '在放') : '现在没在放';
  $('musicNowSub').textContent = nowPlaying
    ? ('在 ' + ({ local: 'SmartView 本机', tv: 'SONY 电视' })[MP.target] + ' 播放' +
       (MP.target !== 'local' ? '（这条通路不提供进度）' : ''))
    : (MP.target === 'local' ? '点「随机播放」开始'
       : ('点「随机播放」开始' + (MP.remote.state === 'off' ? '（设备现在是待机/关机）'
          : MP.remote.state === 'unavailable' ? '（设备连不上）'
          : MP.remote.state === 'unknown' ? '（还没读到设备状态）' : '')));

  if ($('musicVolume')) $('musicVolume').value = String(MP.volume);
  if ($('musicVolumeText')) $('musicVolumeText').textContent = String(MP.volume);

  // 只有本机通路能拿到真实进度；HomePod/电视 的进度条要明确标注不可用，而不是留个空条骗人
  const prog = document.querySelector('.music-progress');
  if (prog) {
    const unsupported = MP.target !== 'local';
    prog.classList.toggle('unsupported', unsupported);
    prog.setAttribute('aria-disabled', unsupported ? 'true' : 'false');
  }
}

function renderQueue() {
  const box = $('musicQueue');
  if (!box) return;
  if (!MP.queue.length) {
    box.innerHTML = '<div class="mq-empty">曲库还没读出来，点「随机播放」会边读边放；也可以搜歌名、歌手或专辑</div>';
    return;
  }
  box.innerHTML = MP.queue.map((t, i) =>
    '<button class="mq-item' + (i === MP.idx ? ' on' : '') + '" data-i="' + i + '" aria-current="' + (i === MP.idx ? 'true' : 'false') + '">' +
    '<b>' + escapeHtml(t.title || '未命名') + '</b><span>' + escapeHtml(t.artist || '') +
    (t.album ? '<span class="mq-album">' + escapeHtml(t.album) + '</span>' : '') +
    (t.genre_dir ? '<span class="mq-genre">' + escapeHtml(t.genre_dir) + '</span>' : '') + '</button>').join('');
  box.querySelectorAll('.mq-item').forEach(el => {
    el.addEventListener('click', () => playTrack(Number(el.dataset.i)));
  });
}

// 曲库检索：/api/music/tracks 带 q 参数，服务端按歌名/歌手/专辑子串过滤。
// 原来面板只能「随机播放」20 首，18368 首曲库等于没法用。
//
// 风格筛选不能靠歌名子串：索引里 genre_dir（Classical/PoP/试音/OST/...）真实存在，
// 但 _public() 只返回 title/artist/album/ext/path，前端拿不到 genre_dir。
// 所以用专辑/曲目路径里的目录词做筛选，并且只筛「随机抽到的可播曲目」——
// 带 q 的查询不过 _playable，会混进 .cue/.log 这类不可播项。
const FILTERS = {
  classical: ['classical', 'bach', 'beethoven', 'mozart', 'chopin', 'sonata', 'symphony', 'adagio', 'piano', '古典'],
  pop: ['pop', '梁静茹', '王菲', '周杰伦', '陈奕迅'],
  ost: ['ost', 'soundtrack', 'hisaishi', '久石让', '原声'],
  test: ['试音'],
  chinese: ['王菲', '陈奕迅', '五月天', '周杰伦', '李宗盛', '张学友', '邓丽君', '梁静茹', 'beyond', '李健'],
  jazz: ['jazz', '爵士', 'hisaishi', '久石让'],
  rock: ['rock', 'beyond', '五月天', '摇滚'],
};

async function searchMusic(q) {
  const box = $('musicQueue');
  if (box) box.innerHTML = '<div class="mq-empty">正在找「' + escapeHtml(q) + '」…</div>';
  try {
    const d = await musicApi('/api/music/tracks?limit=40&q=' + encodeURIComponent(q));
    MP.queue = d.tracks || [];
    MP.idx = -1;
    renderQueue();
    if (!MP.queue.length) {
      if (box) box.innerHTML = '<div class="mq-empty">没找到「' + escapeHtml(q) + '」，换个词试试</div>';
    }
  } catch (e) {
    if (box) box.innerHTML = '<div class="mq-empty">曲库读不到：' + escapeHtml(e.message) + '</div>';
  }
}

// 风格筛选：先拉一批可播样本（random 走 _playable），按路径/歌手/专辑本地匹配。
// 样本里没命中就再拉一批，最多 6 批；仍然空就明说没筛到，不静默换队列。
async function filterMusic(kind) {
  const box = $('musicQueue');
  const words = (FILTERS[kind] || []).map(w => w.toLowerCase());
  if (!words.length) return shuffle();
  if (box) box.innerHTML = '<div class="mq-empty">正在筛「' + escapeHtml(kind) + '」…</div>';
  const seen = new Set();
  const out = [];
  try {
    for (let round = 0; round < 6 && out.length < 40; round++) {
      const d = await musicApi('/api/music/random?count=300');
      const batch = d.tracks || [];
      if (!batch.length) break;
      for (const t of batch) {
        const hay = ((t.path || '') + ' ' + (t.artist || '') + ' ' + (t.album || '') + ' ' + (t.title || '')).toLowerCase();
        if (!words.some(w => hay.includes(w))) continue;
        const k = t.path || (t.title + '|' + t.artist);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t);
        if (out.length >= 40) break;
      }
    }
  } catch (e) {
    if (box) box.innerHTML = '<div class="mq-empty">筛不到：' + escapeHtml(e.message) + '</div>';
    return;
  }
  if (out.length) {
    MP.queue = out;
    MP.idx = -1;
    renderQueue();
  } else if (box) {
    box.innerHTML = '<div class="mq-empty">这个风格没筛到，点「随机」试试</div>';
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
  if (MP.target === 'local') {
    try {
      const r = await musicApi('/api/music/play', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'local', title: t.title, volume: MP.volume }),
      });
      if (r && r.ok === false) {
        toast('本机没放成：' + (r.error || '后台没响应'), 'error');
        MP.playing = false;
        MP.startedAt = 0;
      } else {
        // 点下去要有回音：曲目名/歌手先写进面板，再让轮询去对真实状态
        MP.playing = true;
        MP.startedAt = Date.now();
        MP.nowTitle = t.title + (t.artist ? ' — ' + t.artist : '');
        renderMusic();
        toast('本机在放：' + t.title, 'info');
      }
    } catch (e) {
      toast('本机播放失败', 'error');
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
    if (MP.target === 'local') {
      const s = await musicApi('/api/music/status');
      MP.playing = !!s.playing;
      if (MP.playing) {
        // 曲名以后台真实 path 为准：用户在语音里让小麦放歌、或队列已被筛/搜换掉时，
        // MP.queue[MP.idx] 已经不指向在放的那首，界面会显示错的标题。
        const base = String(s.path || '').split('/').pop().replace(/\.[^.]+$/, '');
        if (base) MP.title = base;
        const el = $('musicBar');
        if (el) {
          // 原来分母写死 240 秒，长曲永远到不了 100%；接口给了时长就用真实时长
          const total = Number(s.duration) || 240;
          el.style.width = Math.min(100, ((Number(s.elapsed) || 0) / total) * 100) + '%';
        }
      } else if ($('musicBar')) {
        // 后台已停（自然播完或语音停掉）时，界面不能还挂着上一首
        MP.title = '';
        $('musicBar').style.width = '0%';
      }
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
      MP.target = want;
      // 请求序号：快速连点不同通路时，先发的响应后到会把音量写到错的目标上
      const seq = (MP.targetSeq = (MP.targetSeq || 0) + 1);
      renderMusic();
      // 切到非本机通路时立刻拉一次真实状态：只靠 4 秒轮询会让用户以为没投上
      if (want !== 'local') {
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
        toast('读不到' + ({ local: '本机', tv: '电视' })[want] +
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
  // 暂停和停止必须分开：原来两个键都绑 stopMusic，点暂停实际是停止，无法续播
  $('musicPauseLocal').addEventListener('click', async () => {
    if (MP.target !== 'local') {
      // 非本机通路没有独立的 pause 语义，明确告知而不是静默当暂停
      toast('这条通路只能停止，暂停请用电视自己的遥控', 'info');
    }
    await stopMusic();
  });
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
  toast: t => toast(t.text, t.kind),
  volume(v) {
    // a ring's own volume (keys while it rings) is shown, but isn't the device volume
    if (!v.ring) { ui.status.volume = v.volume; renderVol(); }
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
renderStatus();
renderThread();
if (demo) demo.start();
else connectEvents();
