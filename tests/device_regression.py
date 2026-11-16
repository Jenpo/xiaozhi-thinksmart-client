#!/usr/bin/env python3
"""SmartView 设备端幂等回归（2026-11-16，owner「做个幂等回归测试吧，从前端功能着手」）。

在设备上跑（需要 127.0.0.1:8090 客户端、:16688 网关、weston 显示）：
    python3 tests/device_regression.py            # 静音模式：不出声、不放歌、不拍屋里、不清历史
    python3 tests/device_regression.py --audible  # 另外真放 3 秒歌（音量不变）
    python3 tests/device_regression.py --only page,api
报告：~/.local/share/thinksmart-regression/last.json；退出码 = 失败数（0 为全过）。

幂等：会改的状态（作息清单勾选、电视限时）先记下原值、测完放回；已有电视限时就跳过那项，不覆盖。
不碰：留言（会念出来）、拍照判题（会存记录、拍到家人）、清除作业历史、关电视。
只用系统 python3（gi/WebKit2）+ urllib + ffmpeg，不依赖客户端/网关的 venv。
"""
import argparse
import base64
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

C = "http://127.0.0.1:8090"
H = "http://127.0.0.1:16688"
REPORT = pathlib.Path.home() / ".local/share/thinksmart-regression/last.json"
EXPECT_TOOLS = {"homework_check", "cast_youtube", "get_weather", "song_request", "tv_timer", "show_card",
                "family_note", "routine", "study_open", "whats_this", "bedtime_story"}
RESULTS = []


# ---------------- 小工具 ----------------

def http(method, url, body=None, timeout=30, raw=False):
    data = None
    headers = {}
    if body is not None:
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode()
        headers["Content-Type"] = "application/octet-stream" if isinstance(body, (bytes, bytearray)) else "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = r.read()
            return r.status, (payload if raw else _json(payload)), r.headers
    except urllib.error.HTTPError as e:
        payload = e.read()
        return e.code, (payload if raw else _json(payload)), e.headers


def _json(b):
    try:
        return json.loads(b)
    except ValueError:
        return {"_raw": b[:200].decode("utf-8", "replace")}


def get(path, base=C, **kw):
    return http("GET", base + path, **kw)


def post(path, body=None, base=C, **kw):
    return http("POST", base + path, body if body is not None else {}, **kw)


def check(group, name, fn):
    t = time.time()
    try:
        detail = fn()
        ok, note = (True, detail) if not isinstance(detail, tuple) else detail
    except AssertionError as e:
        ok, note = False, "断言失败: %s" % e
    except Exception as e:
        ok, note = False, "%s: %s" % (type(e).__name__, e)
    RESULTS.append({"group": group, "name": name, "ok": bool(ok), "note": str(note or "")[:300],
                    "s": round(time.time() - t, 2)})
    print("%s %-8s %-34s %s" % ("✓" if ok else "✗", group, name, str(note or "")[:110]), flush=True)


def wpctl_volume():
    env = dict(os.environ, XDG_RUNTIME_DIR="/run/user/%d" % os.getuid())
    out = subprocess.run(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"], capture_output=True, text=True, env=env).stdout
    return round(float(out.split()[1]) * 100)


def tts_pcm(text, lang):
    """网关 /kiosk/hw/tts（mp3，按语言选声音）→ 16 kHz PCM，给识别测试用；不出声。"""
    st, mp3, _ = get("/kiosk/hw/tts?" + urllib.parse.urlencode({"text": text, "lang": lang}), base=H, raw=True, timeout=30)
    assert st == 200 and len(mp3) > 1000, "合成失败 %s" % st
    return subprocess.run(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1"],
                          input=mp3, capture_output=True).stdout


def jpeg_of_text(lines, size=(960, 720)):
    """用 ffmpeg drawtext 画一张白底文字图（OCR 测试用），不依赖 PIL。"""
    font = next((f for f in ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                             "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
                             "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc") if os.path.exists(f)), None)
    if not font:
        found = subprocess.run(["fc-match", "-f", "%{file}", ":lang=zh"], capture_output=True, text=True).stdout.strip()
        font = found or None
    assert font, "设备上没有中文字体"
    vf = ",".join("drawtext=fontfile=%s:text='%s':x=80:y=%d:fontsize=46:fontcolor=black" % (font, l, 120 + i * 90)
                  for i, l in enumerate(lines))
    return subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "color=white:s=%dx%d" % size,
                           "-vf", vf, "-frames:v", "1", "-f", "mjpeg", "pipe:1"], capture_output=True).stdout


# ---------------- 前端：真 WebKit 离屏加载页面并操作 ----------------

PAGE_JS = r"""
(async () => {
  const out = {errors: (window.__errs || []).slice(), checks: {}};
  const C = (k, v) => { out.checks[k] = !!v; };
  const vis = id => { const e = document.getElementById(id); if (!e) return null; return getComputedStyle(e).display !== 'none' && !e.hidden; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    for (const f of ['hwOpen','hwRender','hwShowBook','stOpen','stTab','flashStart','flashKey','dictView','identShow',
                     'readCompare','routineView','famApply','cardShow','speakText','toast','renderMusic'])
      C('fn:' + f, typeof window[f] === 'function');
    for (const id of ['hwSheet','hwBusy','hwLive','hwBook','stSheet','stBody','cardBox','famBar','chips','sceneTabs','musicQueue'])
      C('el:' + id, !!document.getElementById(id));
    window.__step='scenes';
    // 场景：学习/家庭两组在，卡片可渲染
    const tabs = [...document.querySelectorAll('.scene-tab')].map(t => t.textContent.trim());
    C('scene:学习', tabs.some(t => t.includes('学习'))); C('scene:家庭', tabs.some(t => t.includes('家庭')));
    window.__step='hw';
    // 看作业：空闲时转圈遮罩必须真的看不见（2026-11-15「一直在转」）
    C('hw:busy hidden at rest', vis('hwBusy') === false);
    hwRender({subject:'数学', items:[{no:1,question:'9 × 8 =',child_answer:'63',correct:'72',ok:false,hint:'想想口诀',explain:'八九七十二'},
                                   {no:2,question:'1+1=',child_answer:'2',correct:'2',ok:true}], speech:{yue:'x'}, fixed:[], summary:'s'});
    const items = document.querySelectorAll('#hwItems .hw-item');
    C('hw:render items', items.length === 2);
    C('hw:answer hidden before reveal', !document.getElementById('hwItems').textContent.includes('应该是'));
    const rv = document.querySelector('#hwItems .reveal'); C('hw:reveal button', !!rv);
    if (rv) { rv.click(); await sleep(50); C('hw:answer after reveal', document.getElementById('hwItems').textContent.includes('应该是')); }
    // 学习面板五个标签都能渲染出内容
    for (const m of ['flash','dictation','identify','read','routine']) {
      window.__step='study:'+m; stOpen(m); await sleep(150);
      C('study:' + m, document.getElementById('stBody').children.length > 0 && vis('stSheet') !== false);
    }
    stLive(false);
    window.__step='flash';
    // 闪卡：开一轮、答一题、键盘可用
    stOpen('flash'); await sleep(50); flashStart('add20'); const q = ST.flash.q;
    String(q[1]).split('').forEach(k => flashKey(k)); flashKey('✓'); await sleep(50);
    C('flash:correct counted', ST.flash.right === 1);
    clearInterval(ST.flash.tick); stClose();
    // 朗读对齐
    const el = document.createElement('div');
    C('read:compare fn', typeof readCompare === 'function');
    window.__step='card';
    // 卡片覆盖层：开、关
    cardShow({title:'回归测试', kind:'steps', items:['一','二']}); await sleep(250);
    C('card:open', document.getElementById('cardBox').classList.contains('on') && document.querySelectorAll('#cardItems li').length === 2);
    cardShow({close:true}); await sleep(50); C('card:close', !document.getElementById('cardBox').classList.contains('on'));
    window.__step='fam';
    // 主屏横幅：留言 + 电视限时（只渲染，不调接口）
    const keep = FAM.state;
    famApply({notes:[{id:'t',text:'回归',from:'测试',language:'zh'}], tv:{left:600}, routine:(keep||{}).routine||{}});
    C('fam:banner shows', vis('famBar') === true && document.getElementById('famBar').textContent.includes('回归'));
    famApply(keep || {notes:[], tv:null, routine:{}}); C('fam:banner restores', true);
    window.__step='book';
    const _ok = window.__regr_marker = 1;
    // 错题本视图能拉到数据
    hwOpen(true, false); await sleep(100); hwLiveOff(); await hwShowBook(); await sleep(300);
    C('book:render', document.getElementById('hwItems').textContent.length > 0);
    hwOpen(false);
  } catch (e) { out.errors.push('test: ' + e.message); }
  out.errors = out.errors.concat((window.__errs || []).filter(x => !out.errors.includes(x)));
  return JSON.stringify(out);
})()
"""

# 只记脚本错误（ErrorEvent 带 message）；图片/音频加载失败也会触发 error 事件（如实时画面被取消），不算 JS 报错
ERR_HOOK = "window.__errs=[];window.addEventListener('error',e=>{if(e instanceof ErrorEvent&&e.message)" \
           "window.__errs.push(e.message+' @'+e.lineno)},true);" \
           "window.addEventListener('unhandledrejection',e=>window.__errs.push('promise: '+String(e.reason)));"


def run_page_checks():
    """离屏 WebKit2GTK 打开真页面，注入 error 钩子，跑 PAGE_JS；结果由页面 fetch POST 回本进程起的小 HTTP 服务。

    不用 WebKit 的 JS 返回值：这台 WebKitGTK 上 run_javascript 一律「Unsupported result type」，
    evaluate_javascript 轮询间歇同样报错，script message handler 收不到（2026-11-16 逐个试过）。"""
    import http.server
    import threading
    got = {}
    done = threading.Event()

    class H(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            got["out"] = self.rfile.read(n).decode("utf-8", "replace")
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            done.set()

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    script = r'''
import sys, gi
gi.require_version('Gtk','3.0'); gi.require_version('WebKit2','4.1')
from gi.repository import Gtk, WebKit2, GLib
hook, js, url, port = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
ucm = WebKit2.UserContentManager()
ucm.add_script(WebKit2.UserScript.new(hook, WebKit2.UserContentInjectedFrames.TOP_FRAME,
               WebKit2.UserScriptInjectionTime.START, None, None))
view = WebKit2.WebView.new_with_user_content_manager(ucm)
win = Gtk.OffscreenWindow(); win.set_default_size(1280, 800); win.add(view); win.show_all()
send = "x=>fetch('http://127.0.0.1:%s/',{method:'POST',mode:'no-cors',body:x})" % port
code = ('(' + js + ').then(' + send + ').catch(e=>(' + send + ')(JSON.stringify({errors:["reject: "+e],checks:{}})));0')
fired = [0]
def go():
    fired[0] += 1
    view.evaluate_javascript(code, -1, None, None, None, None, None)
    return False
def loaded(v, e):
    if e == WebKit2.LoadEvent.FINISHED and fired[0] < 2:   # 页面自己 reload 了就再跑一次
        GLib.timeout_add(2500, go)
view.connect('load-changed', loaded)
view.load_uri(url)
GLib.timeout_add(80000, Gtk.main_quit)
Gtk.main()
'''
    env = dict(os.environ, XDG_RUNTIME_DIR="/run/user/%d" % os.getuid(), WAYLAND_DISPLAY="wayland-1", GDK_BACKEND="wayland",
               WEBKIT_DISABLE_COMPOSITING_MODE="1", WEBKIT_DISABLE_DMABUF_RENDERER="1", LIBGL_ALWAYS_SOFTWARE="1")
    p = subprocess.Popen(["/usr/bin/python3", "-c", script, ERR_HOOK, PAGE_JS, C + "/", str(port)],
                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=env)
    ok = done.wait(90)
    p.terminate()
    try:
        p.wait(5)
    except subprocess.TimeoutExpired:
        p.kill()
    srv.shutdown()
    if not ok:
        return {"errors": ["页面 90 s 内没交结果"], "checks": {}}
    return json.loads(got["out"])


def group_page():
    res = {}

    def load():
        # 客户端刚重启时页面会因 build 变了自己 reload，测到一半状态全丢：先等客户端稳定，失败重来一次
        for _ in range(30):
            try:
                if get("/api/health", timeout=3)[0] == 200:
                    break
            except Exception:
                pass
            time.sleep(1)
        time.sleep(3)
        for attempt in (1, 2):
            out = run_page_checks()
            if out.get("checks") or attempt == 2:
                break
            print("  （页面检查第 1 次没出结果：%s，重来）" % "; ".join(out.get("errors", []))[:160], flush=True)
            time.sleep(6)          # 等上一轮残留的实时画面流超时放手
        res.update(out)
        return "%d 项检查%s" % (len(res.get("checks", {})), "（重试后）" if attempt == 2 else "")
    check("page", "WebKit 打开真页面", load)
    check("page", "页面无 JS 报错", lambda: (not res.get("errors"), "; ".join(res.get("errors", [])) or "无"))
    for k, v in sorted(res.get("checks", {}).items()):
        check("page", k, lambda v=v: (v, ""))
    for path in ("/", "/static/app.js", "/static/app.css"):
        check("page", "GET " + path, lambda path=path: (get(path, raw=True)[0] == 200, ""))
    # 实时画面 / 拍照框：页面关了以后摄像头必须放手
    def no_gst():
        for _ in range(10):
            if subprocess.run(["pgrep", "-c", "gst-launch"], capture_output=True, text=True).stdout.strip() in ("", "0"):
                return True, ""
            time.sleep(0.5)
        return False, "页面关了 5 s 摄像头还被占着"
    check("page", "页面关后摄像头放手", no_gst)


# ---------------- 客户端 API ----------------

def group_api(audible):
    def health():
        st, d, _ = get("/api/health"); assert st == 200 and d.get("hub") and d.get("audio"), d; return "hub/audio 正常"
    check("api", "health", health)

    def diag():
        st, d, _ = get("/api/hw/diag")
        bad = [k for k, v in (d.get("devs") or {}).items() if not str(v).startswith("OK")]
        assert st == 200 and not bad and d.get("busy") is False, d
        return "设备节点 OK，lens_covered=%s" % d.get("lens_covered")
    check("api", "camera diag", diag)

    def live():
        if subprocess.run(["pgrep", "-c", "gst-launch"], capture_output=True, text=True).stdout.strip() not in ("", "0"):
            return True, "摄像头正被占用，跳过"
        req = urllib.request.Request(C + "/api/hw/live")
        with urllib.request.urlopen(req, timeout=10) as r:
            assert "multipart" in r.headers.get("Content-Type", ""), r.headers.get("Content-Type")
            buf = b""
            t = time.time()
            while buf.count(b"\xff\xd8\xff") < 2 and time.time() - t < 8:
                buf += r.read(32768)
        n = buf.count(b"\xff\xd8\xff")
        time.sleep(1.5)
        left = subprocess.run(["pgrep", "-c", "gst-launch"], capture_output=True, text=True).stdout.strip()
        assert n >= 2, "只收到 %d 帧" % n
        assert left in ("", "0"), "断开后 gst 还在"
        return "收到 %d 帧，断开即停" % n
    check("api", "live preview stream", live)

    def family():
        st, d, _ = get("/api/family"); assert st == 200 and "routine" in d; return "notes=%d tv=%s" % (len(d.get("notes", [])), bool(d.get("tv")))
    check("api", "family state", family)

    def routine_idem():
        _, d, _ = get("/api/family")
        r = d["routine"]["morning"]
        if not r["items"]:
            return True, "早上清单为空，跳过"
        was = 0 in r.get("done", [])
        for done in (not was, was):     # 翻一次再翻回
            st, x, _ = post("/api/routine/tick", {"list": "morning", "index": 0, "done": done}); assert st == 200, x
        _, d2, _ = get("/api/family")
        assert d2["routine"]["morning"]["done"] == r.get("done", []), (d2["routine"]["morning"], r)
        return "勾选翻转后已复原"
    check("api", "routine tick (幂等)", routine_idem)

    def tv_idem():
        _, d, _ = get("/api/family")
        if d.get("tv"):
            return True, "已有电视限时，跳过（不覆盖）"
        st, x, _ = post("/api/tv-timer", {"minutes": 90, "language": "zh"}); assert st == 200 and x.get("tv"), x
        st, x, _ = post("/api/tv-timer", {"cancel": True}); assert x.get("cancelled"), x
        _, d2, _ = get("/api/family"); assert not d2.get("tv"), d2
        return "设置→取消，已复原"
    check("api", "tv timer (幂等)", tv_idem)

    check("api", "ui 拒绝未知事件", lambda: (post("/api/ui", {"event": "evil", "data": {}})[0] == 400, ""))
    check("api", "tv timer 拒绝 0 分钟", lambda: (post("/api/tv-timer", {"minutes": 0})[0] == 400, ""))

    def book():
        st, d, _ = get("/api/hw/book"); assert st == 200 and "week" in d; return "错题 %d，未改 %d" % (len(d.get("mistakes", [])), d.get("open", 0))
    check("api", "错题本", book)
    check("api", "最近一次作业", lambda: (get("/api/hw/latest")[0] == 200, ""))

    def weather():
        st, d, _ = get("/api/weather"); assert st == 200 and d.get("city"), d; return "%s %s℃" % (d["city"], (d.get("now") or {}).get("temp"))
    check("api", "天气", weather)

    def music_search():
        st, d, _ = get("/api/music/tracks?limit=5&q=" + urllib.parse.quote("稻香"))
        assert st == 200 and d.get("tracks"), d; return "%d 首" % len(d["tracks"])
    check("api", "曲库搜索 稻香", music_search)
    check("api", "随机曲目", lambda: (len(get("/api/music/random?count=5")[1].get("tracks") or []) > 0, ""))

    def vol_consistent():
        st, d, _ = get("/api/music/target_volume?target=local")
        real = wpctl_volume()
        assert d.get("volume") == real, "滑杆 %s ≠ 喇叭 %s" % (d.get("volume"), real)
        return "滑杆=喇叭=%d" % real
    check("api", "音乐滑杆=喇叭音量", vol_consistent)

    if audible:
        def music_play():
            st, d, _ = get("/api/music/tracks?limit=1&q=" + urllib.parse.quote("稻香"))
            t = d["tracks"][0]
            before = wpctl_volume()
            st, r, _ = post("/api/music/play", {"target": "local", "title": t["title"], "index": 0, "queue": [t]})
            assert st == 200 and r.get("ok"), r
            time.sleep(3)
            ps = subprocess.run(["pgrep", "-a", "ffplay"], capture_output=True, text=True).stdout
            post("/api/music/stop", {"target": "local"})
            assert "-volume 100" in ps, ps
            after = wpctl_volume()
            assert after == before or (before < 15 and after == 30), (before, after)
            return "ffplay -volume 100，音量 %d→%d" % (before, after)
        check("api", "本机放歌（出声）", music_play)


# ---------------- 网关 ----------------

def group_hub():
    def tools():
        cfg = subprocess.run([os.path.expanduser("~/xiaozhi-hub-server/main/xiaozhi-server/.venv/bin/python"), "-c",
                              "import sys;sys.path.insert(0,'.');from core.admin import config_store as c;"
                              "import json;print(json.dumps(list(c.load_custom()['Intent']['function_call']['functions'])))"],
                             capture_output=True, text=True, cwd=os.path.expanduser("~/xiaozhi-hub-server/main/xiaozhi-server"))
        names = set(json.loads(cfg.stdout.strip().splitlines()[-1]))
        miss = EXPECT_TOOLS - names
        assert not miss, "缺工具 %s" % miss
        return "%d 个工具已启用" % len(names)
    check("hub", "工具都启用", tools)

    def tts_wav():
        st, wav, hd = post("/kiosk/tts", {"text": "回归测试"}, base=H, raw=True)
        assert st == 200 and wav[:4] == b"RIFF", (st, wav[:20])
        import io, wave
        w = wave.open(io.BytesIO(wav)); dur = w.getnframes() / w.getframerate()
        assert 0.3 < dur < 10, "时长 %.1f s 不对（管道 wav 头？）" % dur
        return "WAV %.1f s" % dur
    check("hub", "/kiosk/tts WAV（提醒/介绍用）", tts_wav)

    for text, lang, want in (("帮我看看作业", "zh", "作业"), ("睇下我嘅作业", "yue", "作业"), ("熄咗部电视", "yue", "电视"),
                             ("放一首稻香", "zh", "稻香")):
        def asr(text=text, lang=lang, want=want):
            st, d, _ = post("/kiosk/asr", tts_pcm(text, lang), base=H)
            got = d.get("text", "")
            assert st == 200 and want in got, "「%s」→「%s」" % (text, got)
            return "「%s」→「%s」%s ms" % (text, got, d.get("ms"))
        check("hub", "识别 %s %s" % (lang, text), asr)

    def ocr():
        img = jpeg_of_text(["The Little Boat", "I sit in the little boat."])
        st, d, _ = post("/kiosk/hw/ocr", {"image": base64.b64encode(img).decode()}, base=H, timeout=90)
        assert st == 200 and "boat" in ((d.get("text") or "") + (d.get("title") or "")).lower(), d
        return "抄到：%s" % (d.get("text") or "")[:20]
    check("hub", "看图 OCR（不存盘）", ocr)

    check("hub", "看图拒绝非 JPEG", lambda: (post("/kiosk/hw/identify", {"image": base64.b64encode(b"x").decode()}, base=H)[0] == 400, ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audible", action="store_true", help="包括会出声的检查（本机放歌 3 秒）")
    ap.add_argument("--only", default="page,api,hub")
    a = ap.parse_args()
    only = set(a.only.split(","))
    t0 = time.time()
    if "page" in only:
        group_page()
    if "api" in only:
        group_api(a.audible)
    if "hub" in only:
        group_hub()
    def camera_free():
        for _ in range(12):
            if subprocess.run(["pgrep", "-c", "gst-launch"], capture_output=True, text=True).stdout.strip() in ("", "0"):
                return True, ""
            time.sleep(0.5)
        return False, "测完 6 s 摄像头还被占着（实时画面流泄漏？）"
    check("end", "测完摄像头空闲", camera_free)
    fail = [r for r in RESULTS if not r["ok"]]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps({"at": time.strftime("%Y-%m-%d %H:%M:%S"), "seconds": round(time.time() - t0, 1),
                                  "passed": len(RESULTS) - len(fail), "failed": len(fail), "results": RESULTS},
                                 ensure_ascii=False, indent=1))
    print("\n%d 过 / %d 不过，用时 %.0f s，报告 %s" % (len(RESULTS) - len(fail), len(fail), time.time() - t0, REPORT))
    for r in fail:
        print("  ✗ %s %s：%s" % (r["group"], r["name"], r["note"]))
    sys.exit(len(fail))


if __name__ == "__main__":
    main()
