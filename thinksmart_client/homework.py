"""看作业：设备内置摄像头拍照 → 网关看图 → 屏幕卡片 + 粤语/英文语音。

拍照用 libcamera（gst libcamerasrc，1280x960，JPEG）。上游 PR #6 的摄像头支持已经在
thinksmart-camera 包里（2026-11-15 装上并验证：S5KC505A 3-0037 识别、30fps 出图）。

接口（只在本机 127.0.0.1 的 kiosk 页面上用）：
  POST /api/hw/capture           拍照并交给网关分析，返回网关的 JSON
  GET  /api/hw/latest            网关最近一次的结果（页面重连/切场景时恢复）
  POST /api/hw/clear             清掉网关的最近一次
  GET  /api/hw/photo?which=thumb|full  拿最近一次的照片（缩略图默认）
分析本身在网关（/kiosk/hw/analyze），这里只负责拍和转。
"""
import base64
import logging
import os

import shutil
import subprocess
import time
import urllib.parse

import aiohttp
from aiohttp import web

log = logging.getLogger(__name__)

CAPTURE_WIDTH = 1280
CAPTURE_HEIGHT = 960
CAPTURE_TIMEOUT = 60
PHOTO_DIR = os.path.expanduser('~/.local/share/thinksmart/photo')

def _gst_available():
    return shutil.which('gst-launch-1.0') is not None

def _capture_sync(width=CAPTURE_WIDTH, height=CAPTURE_HEIGHT, timeout=CAPTURE_TIMEOUT):
    """拍一张 JPEG。libcamerasrc 不支持 num-buffers，所以用 multifilesink 收两帧后杀掉进程：
    第一帧常常还在等 AE/AWB 收敛，第二帧才正常。返回 bytes，失败抛 RuntimeError。"""
    # 固定工作目录：服务进程里 mkdtemp 出来的目录会立刻 isdir()=False（挂载命名空间里 /home 的
    # dentry 没刷新），gst 一帧都写不出来。用早就存在的目录就不踩这个坑。
    tmp = os.path.join(PHOTO_DIR, 'hw-current')
    os.makedirs(tmp, exist_ok=True)
    for f in os.listdir(tmp):
        try:
            os.unlink(os.path.join(tmp, f))
        except OSError:
            pass
    pattern = os.path.join(tmp, 'f-%03d.jpg')
    cmd = ['gst-launch-1.0', '-q',
           'libcamerasrc',
           '!', 'video/x-raw,width=%d,height=%d' % (width, height),
           '!', 'videoconvert',
           '!', 'jpegenc', 'quality=85',
           '!', 'multifilesink', 'location=' + pattern]
    started = time.monotonic()
    logpath = '/tmp/thinksmart-hw-gst.log'
    try:
        # stderr 别用 PIPE：libcamera 打很多 INFO，管道写满会把进程卡住（实测 40s 一张都不出）
        with open(logpath, 'wb') as logf:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=logf)
    except OSError as e:
        raise RuntimeError('起不了 gst-launch: %s' % e)
    best = None
    files = []
    try:
        # 等第二张：第一张常常还在等 AE/AWB 收敛。单张出图实测约 8-12 秒。
        while time.monotonic() - started < timeout:
            files = sorted(f for f in os.listdir(tmp) if f.endswith('.jpg'))
            if len(files) >= 2:
                break
            if proc.poll() is not None and not files:
                break
            time.sleep(0.2)
        files = sorted(f for f in os.listdir(tmp) if f.endswith('.jpg'))
        if files:
            with open(os.path.join(tmp, files[-1]), 'rb') as f:
                best = f.read()
    finally:
        # gst-launch 收到 SIGTERM 有时不退出（实测留下一个 100% CPU 的僵尸，还占着 /dev/media0，
        # 下一张就报 "Device or resource busy"），所以 SIGTERM 后再确认，没走就 SIGKILL
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=6)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    log.warning('gst-launch 没能退出（pid %s），摄像头可能被占住', proc.pid)
    if not best:
        log.warning('拍照空: dir=%s rc=%s elapsed=%.1fs',
                    tmp, proc.poll(), time.monotonic() - started)
        # 把 gst 的原话带出来：摄像头忙 / 没有摄像头 / 驱动没起来，原因都在这里面
        tail = ''
        try:
            with open(logpath, 'rb') as f:
                raw = f.read().decode('utf-8', 'replace').splitlines()
            lines = []
            for l in raw:
                if l.startswith('['):          # 去掉 libcamera 的 [时间] [pid] 前缀
                    parts = l.split('] ', 2)
                    l = parts[-1] if len(parts) > 2 else l
                if 'ERROR' in l or 'busy' in l or 'Could not' in l or 'permitted' in l:
                    lines.append(l.strip())
            tail = '；'.join(dict.fromkeys(lines))[:400]
        except OSError:
            pass
        raise RuntimeError('没拍到画面（%s）' % (tail or '摄像头可能被别的程序占着'))
    if not best.startswith(b'\xff\xd8\xff'):
        raise RuntimeError('拍到的不是 JPEG')
    log.info('拍照 %dx%d %dKB %.1fs', width, height, len(best) // 1024, time.monotonic() - started)
    return best

def install(client):
    """把这些接口挂到客户端（和 web.py 里的路由同一份 app）。"""

    async def diag(request):
        """诊断：在服务进程自己身上报告设备权限，排查「同 ns 能开、服务里打不开」。"""
        info = {'pid': os.getpid(), 'groups': os.getgroups(), 'devs': {}}
        for p in ('/dev/media0', '/dev/video0', '/dev/dma_heap/default_cma_region'):
            try:
                st = os.stat(p)
                fd = os.open(p, os.O_RDWR | os.O_NONBLOCK)
                os.close(fd)
                info['devs'][p] = 'OK major=%d' % os.major(st.st_rdev)
            except OSError as e:
                info['devs'][p] = 'FAIL %s' % e
        return web.json_response(info)

    async def capture(request):
        try:
            body = {}
            if request.can_read_body:
                try:
                    body = await request.json()
                except ValueError:
                    body = {}
            language = (body.get('language') or 'yue').strip()
            if not _gst_available():
                return web.json_response({'ok': False, 'error': '这台设备没有 gst-launch'}, status=501)
            jpeg = await asyncio_to_thread(_capture_sync)
        except RuntimeError as e:
            log.warning('拍照失败: %s', e)
            return web.json_response({'ok': False, 'error': str(e)}, status=503)
        except Exception as e:
            log.exception('拍照失败')
            return web.json_response({'ok': False, 'error': '拍照失败: %s' % e}, status=500)
        payload = {'image': base64.b64encode(jpeg).decode(), 'language': language,
                   'source': 'camera'}
        try:
            data = await client._hub_http('/kiosk/hw/analyze', payload, total=150)
        except Exception as e:
            return web.json_response({'ok': False, 'error': '网关没答: %s' % e}, status=502)
        return web.json_response(data, status=200 if data.get('ok') else 502)

    async def latest(_request):
        try:
            data = await client._hub_http('/kiosk/hw/latest')
        except Exception as e:
            return web.json_response({'ok': False, 'error': '网关没答: %s' % e}, status=502)
        return web.json_response(data)

    async def clear(_request):
        try:
            data = await client._hub_http('/kiosk/hw/clear', {})
        except Exception as e:
            return web.json_response({'ok': False, 'error': '网关没答: %s' % e}, status=502)
        return web.json_response(data)

    async def photo(request):
        """最近一次的原图（网关只留缩略图；原图在客户端的拍照目录里没留，所以走网关存的那份）。
        网关的 /kiosk/hw/latest 带 thumb（data URI），这里解出来当图片回。"""
        which = request.query.get('which') or 'thumb'
        try:
            data = await client._hub_http('/kiosk/hw/latest')
        except Exception:
            return web.Response(status=502)
        hw = (data or {}).get('homework') or {}
        uri = hw.get('thumb') or ''
        if which == 'full':
            uri = hw.get('thumb') or uri
        if ',' not in uri:
            return web.Response(status=404)
        try:
            raw = base64.b64decode(uri.split(',', 1)[1])
        except ValueError:
            return web.Response(status=500)
        return web.Response(body=raw, content_type='image/jpeg',
                            headers={'Cache-Control': 'no-store'})

    async def tts(request):
        """念作业：转给网关的 /kiosk/hw/tts（edge-tts），把 mp3 原样回给页面。"""
        text = (request.query.get('text') or '').strip()
        lang = (request.query.get('lang') or 'yue').strip()
        if not text:
            return web.json_response({'ok': False, 'error': '缺少 text'}, status=400)
        url = (client.cfg.get('hub_http') or '') + '/kiosk/hw/tts?' + urllib.parse.urlencode(
            {'text': text[:600], 'lang': lang})
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as s:
                async with s.get(url) as r:
                    if r.status != 200:
                        return web.json_response({'ok': False, 'error': '网关没合成'}, status=502)
                    body = await r.read()
        except Exception as e:
            return web.json_response({'ok': False, 'error': '连不上网关: %s' % e}, status=502)
        return web.Response(body=body, content_type='audio/mpeg', headers={'Cache-Control': 'no-store'})

    client.hw_photo = photo
    return [('/api/hw/capture', capture), ('/api/hw/latest', latest),
            ('/api/hw/clear', clear), ('/api/hw/photo', photo), ('/api/hw/tts', tts),
            ('/api/hw/diag', diag)]

async def asyncio_to_thread(func, *args, **kwargs):
    import asyncio
    import functools
    return await asyncio.get_running_loop().run_in_executor(None, functools.partial(func, *args, **kwargs))
