"""SmartView 音乐播放器后端。

支持三个出声目标：
  local    SmartView 本机扬声器（ffplay，支持 APE/FLAC/DSF 等全格式）
  homepod  HomePod（HA raop_segment_play 分段推流）
  tv       SONY 电视（HA media_player.play_media，Chromecast）

曲库来源：hub 的 music-index.json（NAS 曲库 18368 首）。
本机播放路径需与 NAS 挂载一致；本机没有 NAS 挂载时走 hub 的 HTTP 代理。

安全：
  - 曲库只读，不改任何文件。
  - 同一时刻只允许一个播放进程；新播放先停旧的。
"""
import asyncio
import json
import os
import random
import re
import shlex
import subprocess
import time

from .zh_t2s import t2s

MUSIC_INDEX_CANDIDATES = (
    os.path.expanduser("~/.local/share/thinksmart/music-index.json"),
    "/opt/thinksmart/music-index.json",
)
# NAS 曲库在本机的 NFS 挂载点（与 hub 一致）
NAS_ROOTS = (
    "/mnt/thinksmart-music/main",
    "/mnt/thinksmart-music/datavol2",
)
HOMEPOD_ENTITY = "media_player.office_office"
TV_ENTITY = "media_player.bravia_xr_55x90j"
PLAYER_BIN = "ffplay"
YTM_PREFIX = "ytm:"       # YouTube Music 曲目：放之前向网关要流地址（resolver，由 web.py 设置）
resolver = None           # callable(video_id) -> url；阻塞调用，web.py 在线程里调 play_index/tick

# 本机播放器进程（全局单例）
_local_proc = None
_local_track = None
_local_volume = None
_local_started = 0.0


_INDEX_CACHE = {"key": None, "items": []}


def _load_index():
    """曲库索引（约 18368 首、几 MB 的 JSON）。2026-11-15：原来每次搜索/随机都重读重解析一遍，
    现在按文件的 mtime 缓存在内存里，同时算好搜索键（繁简归一、去标点）。"""
    for path in MUSIC_INDEX_CANDIDATES:
        try:
            st = os.stat(path)
        except OSError:
            continue
        key = (path, st.st_mtime, st.st_size)
        if _INDEX_CACHE["key"] == key:
            return _INDEX_CACHE["items"]
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        items = data.get("items") if isinstance(data, dict) else data
        if not isinstance(items, list):
            continue
        for t in items:
            t["_k"] = _key(t.get("title"))
            t["_c"] = _key(_core_title(t.get("title")))
            t["_ka"] = _key(t.get("artist")) + "|" + _key(t.get("album")) + "|" + _key(t.get("path"))
        _INDEX_CACHE.update(key=key, items=items)
        return items
    return []


_TRACKNO = re.compile(r"^\s*(?:cd\s*\d+\s*[\-_.]?\s*)?\d{1,3}(?:[.\-_]\d{1,3})?(?:\s*[.\-_、)\]]\s*|\s+)", re.I)


def _core_title(title):
    """「12 周杰伦 - 稻香」->「稻香」（和网关 play_music._split_title 同一个规则）。"""
    t = _TRACKNO.sub("", str(title or ""), count=1).strip().lstrip("-–—_.、 ").strip() or str(title or "")
    if " - " in t:
        left, right = t.split(" - ", 1)
        if left.strip() and right.strip() and len(left) <= 24:
            return right.strip()
    return t


def _key(text):
    return re.sub(r"[\W_]+", "", t2s(str(text or "").casefold()))


def _whole_disc(t):
    """整张 CD 一个文件（CDImage + cue，300 MB 以上）：随机里不抽，一放就是一小时。"""
    return (t.get("size") or 0) > 300e6 or (t.get("title") or "").casefold().startswith("cdimage")


GENRES = {   # 面板的风格标签 -> 索引里的 genre_dir（NAS 顶层目录）
    "classical": ("Classical",), "pop": ("PoP",), "ost": ("OST",), "euro": ("Euro_US_Korea",),
    "mainland": ("Mainland",), "light": ("FO_Light",), "beyond": ("BEYOND合集资源",),
    "test": ("试音", "纯试音"),
}


_exist_cache = {}
_EXIST_TTL = 600.0       # 目录存在性缓存 10 分钟：NFS 断一下不能让它一直判「不可播」


def _playable(track):
    """过滤掉本机没有的文件。

    索引有 18368 首，逐个 os.path.isfile 会打 18368 次 NFS stat，
    实测把设备 load 拉到 13+ 且进程卡在 D 状态。这里按目录缓存，
    只 stat 目录存在性，不逐文件确认（缺失文件由 ffplay 播放时自然失败）。

    例外：真正要播的那一首（find_track/local_play）按文件确认——目录在而文件没了
    会让面板显示一首放不出声的歌。单次 isfile 不是热点。
    """
    path = track.get("path") or ""
    if not path:
        return False
    root = os.path.dirname(path)
    hit = _exist_cache.get(root)
    now = time.monotonic()
    if hit is None or now - hit[1] > _EXIST_TTL:
        try:
            hit = (os.path.isdir(root), now)
        except OSError:
            hit = (False, now)
        _exist_cache[root] = hit
    return hit[0]


def _file_exists(path):
    """单个文件的确认（只给真正要播的那首用）。目录不在就当文件不在。"""
    if not path:
        return False
    try:
        return os.path.isfile(path)
    except OSError:
        return False


def _public(track):
    path = track.get("path") or ""
    return {
        "title": track.get("title") or os.path.basename(path),
        "artist": track.get("artist") or "",
        "album": track.get("album") or "",
        "ext": (track.get("ext") or "").lstrip(".").lower(),
        "genre": track.get("genre_dir") or "",
        "path": path,
        "source": "youtube" if path.startswith(YTM_PREFIX) else "nas",
    }


def _match(items, q):
    """多个词（空格隔开）都要出现在 歌名/歌手/专辑/路径 里；繁简、大小写、标点都不计较。"""
    words = [_key(w) for w in str(q or "").split()]
    words = [w for w in words if w]
    if not words:
        return list(items)
    return [t for t in items if all(w in t.get("_k", "") or w in t.get("_ka", "") for w in words)]


def _rank(t, words):
    k = t.get("_k", "")
    joined = "".join(words)
    core = t.get("_c", "")                 # 去掉曲序号和「歌手 - 」前缀的歌名
    full = core == joined or k == joined or (core and core in words and all(w in core or w in t.get("_ka", "") for w in words))
    return (0 if full else 1 if core.startswith(joined) else 2 if joined in k else 3,
            _whole_disc(t), (t.get("ext") or "").lower() in (".dsf", ".dff", ".ape", ".wv"), len(k))


def list_tracks(limit=50, query=""):
    """搜索：多词同时命中，歌名完全一样的排前面、再是开头一样的、再是包含的，只出现在歌手/专辑里的最后；
    同一首（歌名+歌手）只留一个版本。只给能播的：搜到 .cue/.log 会让用户点了没反应。"""
    items = _load_index()
    q = (query or "").strip()
    words = [w for w in (_key(x) for x in q.split()) if w]
    if words:
        items = sorted(_match(items, q), key=lambda t: _rank(t, words))
    out, seen, checked_dirs = [], set(), {}
    for t in items:
        dup = (t.get("_c", ""), _key(t.get("artist")))
        if words and dup in seen:
            continue
        root = os.path.dirname(t.get("path") or "")
        if root not in checked_dirs:
            checked_dirs[root] = _playable(t)
        if checked_dirs[root]:
            seen.add(dup)
            out.append(_public(t))
            if len(out) >= limit:
                break
    return out


def random_tracks(count=20, query="", genre=""):
    """随机取 count 首；genre 是面板的风格标签（GENRES），按索引里的 genre_dir 筛（原来按歌名关键词猜）。

    [2026-11-11] 原来对 18368 首逐个 _playable（=按目录 NFS stat），1734 个目录在
    设备上一次 80ms，实测 /api/music/random?count=20 要 144s，面板一直黑着。
    现在按目录去重后抽样：先打乱目录，只 stat 到凑够 count 首为止，正常几个目录就够。
    """
    items = [t for t in _load_index() if not _whole_disc(t)]
    if genre:
        dirs = GENRES.get(str(genre).lower(), (genre,))
        items = [t for t in items if t.get("genre_dir") in dirs]
    q = (query or "").strip()
    if q:
        items = _match(items, q)
    if not items:
        return []
    by_dir = {}
    for t in items:
        by_dir.setdefault(os.path.dirname(t.get("path") or ""), []).append(t)
    roots = list(by_dir)
    random.shuffle(roots)
    picked = []
    per_dir = max(2, count // 8)            # 一个目录最多拿几首：随机列表不要整张都是同一张专辑
    for root in roots:
        if len(picked) >= count:
            break
        cand = by_dir[root]
        random.shuffle(cand)
        probe = cand[0]
        if not _playable(probe):
            continue
        picked.extend(cand[:min(per_dir, count - len(picked))])
    if not picked:
        # 缓存可能整库判死（NFS 抖动）：清一次重试一个目录
        _exist_cache.clear()
        for root in roots[:5]:
            cand = by_dir[root]
            if cand and _playable(cand[0]):
                picked.extend(cand[:count])
                break
    random.shuffle(picked)
    return [_public(t) for t in picked[:count]]


def find_track(title=""):
    """按歌名/歌手找一首。空 title 随机取一首。

    先找歌名完全相同的，再找歌名包含的，最后才是歌手包含的——「勇气」不该因为索引里
    先出现「勇气（伴奏）」而放到伴奏版。找到的必须真有这个文件。
    """
    items = _load_index()
    # 索引全不可播时（NFS 没挂上/目录暂时不在）重判一次：缓存是按目录记的，
    # 一次 NFS 抖动会把整库判成「没有这个文件」，之后随机播放就永远是空的。
    if items and not any(_playable(t) for t in items[:200]):
        _exist_cache.clear()
    q = (title or "").strip().lower()
    if not q:
        # 18368 首逐个判目录要 9-10 s（NFS stat 慢），而随机播放只要一首：
        # 打乱后按目录去重，同一目录只 stat 一次，通常几十次就够。
        # 原来这里一次扫全库，面板点「随机播放」要等近 10 s，用户以为没反应。
        order = list(items)
        random.shuffle(order)
        seen = set()
        for t in order:
            root = os.path.dirname(t.get("path") or "")
            if root in seen:
                continue
            seen.add(root)
            if _playable(t):
                return _public(t)
        return None
    exact, title_hit, artist_hit = [], [], []
    for t in items:
        name = (t.get("title") or "").lower()
        artist = (t.get("artist") or "").lower()
        if name == q:
            exact.append(t)
        elif q in name:
            title_hit.append(t)
        elif q in artist:
            artist_hit.append(t)
    for bucket in (exact, title_hit, artist_hit):
        for t in bucket:
            if _file_exists(t.get("path")) and _playable(t):
                return _public(t)
    return None


# ---------------- 本机播放 ----------------
# 2026-11-15：原来一次只放一首，放完就停（面板「随机播放」排了 20 首也只放第一首）；「暂停」其实是停止；
# 调音量要重开 ffplay，歌从头开始。现在：
#   - 本机有一个队列，放完一首 tick() 自动接下一首（web.py 每秒调一次）；
#   - 暂停 = SIGSTOP，继续 = SIGCONT，位置不丢；
#   - 调音量从当前位置重开（-ss）。

import signal

_queue = []           # [{title, artist, album, path, ...}]
_idx = -1
_paused_at = None     # 暂停的时刻（time.time()）
_paused_total = 0.0   # 本首累计暂停了多少秒
_seek = 0.0           # 本首是从第几秒开始放的
_user_stopped = False  # 停止/换歌是用户做的：tick() 不要自动接下一首


def _kill_local():
    global _local_proc, _local_track, _local_volume, _paused_at
    if _local_proc is not None:
        try:
            if _local_proc.poll() is None:
                if _paused_at is not None:
                    try:
                        os.killpg(_local_proc.pid, signal.SIGCONT)   # 停住的进程收不到 TERM
                    except OSError:
                        pass
                _local_proc.terminate()
                try:
                    _local_proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    _local_proc.kill()
        except OSError:
            pass
    _local_proc = None
    _local_track = None
    _local_volume = None
    _paused_at = None


def _elapsed():
    if _local_proc is None:
        return 0.0
    now = _paused_at or time.time()
    return max(0.0, _seek + now - _local_started - _paused_total)


def local_play(path, volume=70, seek=0.0):
    """用 ffplay 在本机扬声器播放。volume 0-100，seek 从第几秒开始。

    幂等：同一首正在放就不再重开（页面的轮询/重试不会让歌从头开始），
    只有音量变了才重开——ffplay 不支持运行时改音量。
    """
    global _local_proc, _local_track, _local_volume, _local_started, _paused_total, _seek, _user_stopped
    source = path
    if str(path or "").startswith(YTM_PREFIX):
        if resolver is None:
            return {"ok": False, "error": "YouTube Music 不可用"}
        try:
            source = resolver(path[len(YTM_PREFIX):])
        except Exception as exc:
            return {"ok": False, "error": "YouTube Music 取流失败: %s" % exc}
    elif not path or not os.path.isfile(path):
        return {"ok": False, "error": "本机没有这个文件: %s" % path}
    vol = max(0, min(100, int(volume)))
    if (_local_proc is not None and _local_proc.poll() is None
            and _local_track == path and _local_volume == vol and not seek):
        if _paused_at is not None:
            local_resume()
        return {"ok": True, "target": "local", "path": path, "volume": vol,
                "elapsed": round(_elapsed(), 1), "restarted": False}
    _user_stopped = True      # 换歌：旧进程被我们杀掉，不是自然放完
    _kill_local()
    cmd = [PLAYER_BIN, "-nodisp", "-autoexit", "-loglevel", "error", "-volume", str(vol)]
    if seek and seek > 1:
        cmd += ["-ss", "%.1f" % seek]
    if source != path:
        cmd += ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
    cmd.append(source)
    try:
        _local_proc = subprocess.Popen(
            cmd, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as exc:
        return {"ok": False, "error": "启动 ffplay 失败: %s" % exc}
    _local_track = path
    _local_volume = vol
    _local_started = time.time()
    _paused_total = 0.0
    _seek = float(seek or 0) if seek and seek > 1 else 0.0
    _user_stopped = False
    return {"ok": True, "target": "local", "path": path, "volume": vol, "restarted": True}


def set_queue(tracks, index=0):
    """面板的播放列表（随机/搜索/筛选的结果）。tick() 按它接下一首。"""
    global _queue, _idx
    _queue = [t for t in (tracks or []) if isinstance(t, dict) and t.get("path")][:200]
    for t in _queue:
        t["source"] = "youtube" if t["path"].startswith(YTM_PREFIX) else "nas"
    _idx = max(0, min(int(index or 0), len(_queue) - 1)) if _queue else -1
    return _queue[_idx] if _queue else None


def play_index(i, volume=None):
    global _idx
    if not _queue:
        return {"ok": False, "error": "播放列表是空的"}
    i = i % len(_queue)
    for step in range(len(_queue)):           # 文件不在（NAS 掉了一块）就往后找能放的
        j = (i + step) % len(_queue)
        if _queue[j]["path"].startswith(YTM_PREFIX) or _file_exists(_queue[j]["path"]):
            _idx = j
            vol = volume if volume is not None else (_local_volume if _local_volume is not None else 55)
            r = local_play(_queue[j]["path"], vol)
            r["index"] = j
            return r
    return {"ok": False, "error": "列表里的歌都读不到，NAS 可能没挂上"}


def local_next(step=1):
    if not _queue:
        return {"ok": False, "error": "播放列表是空的"}
    return play_index((_idx if _idx >= 0 else -1) + step)


def local_stop():
    global _user_stopped
    _user_stopped = True
    _kill_local()
    return {"ok": True, "target": "local", "state": "stopped"}


def local_pause():
    global _paused_at
    if _local_proc is None or _local_proc.poll() is not None:
        return {"ok": False, "error": "本机没有在播"}
    if _paused_at is None:
        try:
            os.killpg(_local_proc.pid, signal.SIGSTOP)
        except OSError as exc:
            return {"ok": False, "error": "暂停失败: %s" % exc}
        _paused_at = time.time()
    return {"ok": True, "target": "local", "state": "paused", "elapsed": round(_elapsed(), 1)}


def local_resume():
    global _paused_at, _paused_total
    if _local_proc is None or _local_proc.poll() is not None:
        if _queue and _idx >= 0:
            return play_index(_idx)
        return {"ok": False, "error": "本机没有在播"}
    if _paused_at is not None:
        try:
            os.killpg(_local_proc.pid, signal.SIGCONT)
        except OSError as exc:
            return {"ok": False, "error": "继续失败: %s" % exc}
        _paused_total += time.time() - _paused_at
        _paused_at = None
    return {"ok": True, "target": "local", "state": "playing", "elapsed": round(_elapsed(), 1)}


def local_set_volume(volume):
    """ffplay 不支持运行时调音量：从当前位置重开（原来从头开始）。"""
    if _local_proc is None or _local_proc.poll() is not None:
        return {"ok": False, "error": "本机没有在播"}
    path = _local_track
    vol = max(0, min(100, int(volume)))
    if vol == _local_volume:
        return {"ok": True, "target": "local", "volume": vol, "restarted": False}
    paused = _paused_at is not None
    r = local_play(path, vol, seek=_elapsed())
    if paused and r.get("ok"):
        local_pause()
    return r


def tick():
    """每秒调一次：一首自然放完就接队列里的下一首。返回 True 表示状态变了（要通知页面）。"""
    global _local_proc, _local_track
    if _local_proc is None or _local_proc.poll() is None:
        return False
    natural = not _user_stopped and _local_proc.returncode == 0
    _local_proc = None
    _local_track = None
    if natural and _queue and _idx + 1 < len(_queue):
        play_index(_idx + 1)
    return True


def local_status():
    playing = _local_proc is not None and _local_proc.poll() is None
    cur = _queue[_idx] if playing and 0 <= _idx < len(_queue) and _queue[_idx].get("path") == _local_track else None
    return {
        "playing": playing and _paused_at is None,
        "paused": playing and _paused_at is not None,
        "source": "local",
        # 面板标题要靠它显示「在放什么」：以前只回 path，前端只能猜
        "title": ((cur or {}).get("title") or os.path.splitext(os.path.basename(_local_track))[0])
                 if playing and _local_track else None,
        "artist": (cur or {}).get("artist") or "",
        "origin": ("youtube" if str(_local_track or "").startswith(YTM_PREFIX) else "nas") if playing else None,
        "path": _local_track if playing else None,
        "elapsed": round(_elapsed(), 1) if playing else 0,
        "volume": _local_volume if playing else None,
        "index": (_idx + 1) if cur else None,
        "total": len(_queue) if cur else None,
    }
