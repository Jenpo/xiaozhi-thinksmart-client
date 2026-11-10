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
import shlex
import subprocess
import time

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

# 本机播放器进程（全局单例）
_local_proc = None
_local_track = None
_local_volume = None
_local_started = 0.0


def _load_index():
    for path in MUSIC_INDEX_CANDIDATES:
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                items = data.get("items") if isinstance(data, dict) else data
                if isinstance(items, list):
                    return items
            except (OSError, ValueError):
                continue
    return []


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
    return {
        "title": track.get("title") or os.path.basename(track.get("path") or ""),
        "artist": track.get("artist") or "",
        "album": track.get("album") or "",
        "ext": (track.get("ext") or "").lstrip(".").lower(),
        "path": track.get("path") or "",
    }


def _match(items, q):
    return [
        t for t in items
        if q in (t.get("title") or "").lower()
        or q in (t.get("artist") or "").lower()
        or q in (t.get("album") or "").lower()
    ]


def list_tracks(limit=50, query=""):
    """搜索结果也只给能播的：搜到 .cue/.log 这类会让用户点了没反应。"""
    items = _load_index()
    q = (query or "").strip().lower()
    if q:
        items = _match(items, q)
    items = [t for t in items if _playable(t)]
    return [_public(t) for t in items[:limit]]


def random_tracks(count=20, query=""):
    items = _load_index()
    q = (query or "").strip().lower()
    if q:
        items = _match(items, q)
    items = [t for t in items if _playable(t)]
    if not items:
        return []
    picked = random.sample(items, min(count, len(items)))
    return [_public(t) for t in picked]


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
        pool = [t for t in items if _playable(t)]
        return _public(random.choice(pool)) if pool else None
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

def _kill_local():
    global _local_proc, _local_track, _local_volume
    if _local_proc is not None:
        try:
            if _local_proc.poll() is None:
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


def local_play(path, volume=70):
    """用 ffplay 在本机扬声器播放。volume 0-100。

    幂等：同一首正在放就不再重开（页面的轮询/重试不会让歌从头开始），
    只有音量变了才重开——ffplay 不支持运行时改音量。
    """
    global _local_proc, _local_track, _local_volume, _local_started
    if not path or not os.path.isfile(path):
        return {"ok": False, "error": "本机没有这个文件: %s" % path}
    vol = max(0, min(100, int(volume)))
    if (_local_proc is not None and _local_proc.poll() is None
            and _local_track == path and _local_volume == vol):
        return {"ok": True, "target": "local", "path": path, "volume": vol,
                "elapsed": round(time.time() - _local_started, 1), "restarted": False}
    _kill_local()
    cmd = [PLAYER_BIN, "-nodisp", "-autoexit", "-loglevel", "error",
           "-volume", str(vol), path]
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
    return {"ok": True, "target": "local", "path": path, "volume": vol, "restarted": True}


def local_stop():
    _kill_local()
    return {"ok": True, "target": "local", "state": "stopped"}


def local_set_volume(volume):
    """ffplay 不支持运行时调音量，只能重启当前曲目（从当前位置无法续播）。"""
    global _local_proc
    if _local_proc is None or _local_proc.poll() is not None:
        return {"ok": False, "error": "本机没有在播"}
    path = _local_track
    vol = max(0, min(100, int(volume)))
    return local_play(path, vol)


def local_status():
    playing = _local_proc is not None and _local_proc.poll() is None
    return {
        "playing": playing,
        "path": _local_track if playing else None,
        "elapsed": round(time.time() - _local_started, 1) if playing else 0,
        "volume": _local_volume if playing else None,
    }
