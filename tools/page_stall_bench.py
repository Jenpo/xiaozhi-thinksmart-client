#!/usr/bin/env python3
"""页面主线程卡顿归因（2026-11-20）：离屏 WebKit 打开真页面，逐项测「点 ✓ 之后会发生的事」各堵主线程多久。
静音：AudioContext 只 suspend/resume 不发声，Audio 元素 muted。结果 POST 回本进程，打印 JSON。
用法（设备上，系统 python3）：python3 page_stall_bench.py [轮数]"""
import json, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import gi
gi.require_version('Gtk', '3.0'); gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5
OUT = {}

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        OUT.update(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.send_response(200); self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers()
        GLib.idle_add(Gtk.main_quit)
    def do_OPTIONS(self):
        self.send_response(200); self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*'); self.end_headers()
    def log_message(self, *a): pass

srv = HTTPServer(('127.0.0.1', 18977), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()

JS = r"""
(async () => {
  const N = %d, R = {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // 漂移探针：50 ms 一跳，记录区间内最大间隔 = 主线程最长被堵多久
  let last = performance.now(), worst = 0;
  setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last - 50); last = n; }, 50);
  async function measure(name, fn, settle) {
    const xs = [];
    for (let i = 0; i < N; i++) {
      await sleep(400); worst = 0; last = performance.now();
      const t0 = performance.now(); try { await Promise.race([fn(i), sleep(4000).then(() => { R[name + ':timeout'] = (R[name + ':timeout'] || 0) + 1; })]); } catch (e) { R[name + ':err'] = String(e); }
      const sync = performance.now() - t0;
      await sleep(settle || 600);
      xs.push([Math.round(sync), Math.round(worst)]);
    }
    R[name] = xs;
  }
  await sleep(3000);   // 页面自己初始化完
  const ctx = new AudioContext();
  await measure('audioctx resume after suspend', async () => { await ctx.suspend(); await sleep(100); await ctx.resume(); });
  await measure('audioctx running: oscillator note (silent)', async () => {
    const o = ctx.createOscillator(), g = ctx.createGain(); g.gain.value = 0; o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + .2); });
  await measure('new Audio muted + play (tts)', async (i) => {
    const a = new Audio('/api/hw/tts?lang=en&text=' + encodeURIComponent('bench ' + i)); a.muted = true;
    await Promise.race([a.play().catch(() => {}), sleep(3000)]);
    a.pause(); a.removeAttribute('src'); a.load(); }, 1500);
  await measure('starFly (DOM anim)', async () => { if (typeof starFly === 'function') starFly(1, 'bench'); }, 1500);
  await measure('starRender', async () => { if (typeof starRender === 'function') starRender(); });
  fetch('http://127.0.0.1:18977/', { method: 'POST', body: JSON.stringify(R) });
})();
""" % N

view = WebKit2.WebView(website_policies=WebKit2.WebsitePolicies(autoplay=WebKit2.AutoplayPolicy.ALLOW))
view.get_settings().set_media_playback_requires_user_gesture(False)
win = Gtk.OffscreenWindow(); win.set_default_size(1280, 800); win.add(view); win.show_all()
done = [False]
def on_load(v, e):
    if e == WebKit2.LoadEvent.FINISHED and not done[0]:
        done[0] = True
        v.evaluate_javascript(JS, -1, None, None, None, None, None)
view.connect('load-changed', on_load)
view.load_uri('http://127.0.0.1:8090/')
GLib.timeout_add(120000, Gtk.main_quit)
Gtk.main()
print(json.dumps(OUT, ensure_ascii=False, indent=1))
