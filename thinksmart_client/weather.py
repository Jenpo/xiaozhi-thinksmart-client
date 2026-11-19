"""The next 7 days of weather for the home screen (Open-Meteo: no key, same source as the hub's
get_weather since 2026-11-11).

The city is config 'weather_city' (the hub's get_weather default is 广州 too). Coordinates are looked up
once; the forecast is cached for 30 minutes and a failure keeps the last good one, so the page never
waits on the network and an outage only leaves the line blank.

The page shows today and tomorrow by default; tapping the line expands the whole 7 days (the hub's
prompt carries the same 7-day forecast, so asking "第3天" / "周几" out loud agrees with the screen).
"""
import asyncio
import datetime
import logging
import time

import aiohttp

log = logging.getLogger(__name__)

GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search'
FORECAST = 'https://api.open-meteo.com/v1/forecast'
TTL = 30 * 60
RETRY = 5 * 60            # after a failure, don't ask again sooner than this
# api.open-meteo.com is far: TCP connect alone is ~1.4 s from the device, TLS doubles it. It runs in the
# background and is cached, so be patient rather than fail.
TIMEOUT = aiohttp.ClientTimeout(total=20, connect=10)

# WMO weather codes -> (short Chinese text, icon key the page knows)
WMO = {
    0: ('晴', 'sun'), 1: ('晴间多云', 'sun'), 2: ('多云', 'cloud-sun'), 3: ('阴', 'cloud'),
    45: ('雾', 'fog'), 48: ('雾', 'fog'),
    51: ('毛毛雨', 'rain'), 53: ('毛毛雨', 'rain'), 55: ('毛毛雨', 'rain'),
    56: ('冻雨', 'rain'), 57: ('冻雨', 'rain'),
    61: ('小雨', 'rain'), 63: ('中雨', 'rain'), 65: ('大雨', 'rain'),
    66: ('冻雨', 'rain'), 67: ('冻雨', 'rain'),
    71: ('小雪', 'snow'), 73: ('中雪', 'snow'), 75: ('大雪', 'snow'), 77: ('雪', 'snow'),
    80: ('阵雨', 'rain'), 81: ('阵雨', 'rain'), 82: ('强阵雨', 'rain'),
    85: ('阵雪', 'snow'), 86: ('阵雪', 'snow'),
    95: ('雷阵雨', 'storm'), 96: ('雷阵雨', 'storm'), 99: ('雷阵雨', 'storm'),
}


def describe(code):
    try:
        return WMO.get(int(code), ('', 'cloud'))
    except (TypeError, ValueError):
        return ('', 'cloud')


FORECAST_DAYS = 7          # the hub's prompt has the same 7 days; keep the two in step
WEEKDAYS = ('一', '二', '三', '四', '五', '六', '日')


def day_label(date):
    """'2026-11-20' -> '11月20日 周五' (empty when the date is missing/garbled)."""
    try:
        y, m, d = (int(x) for x in str(date).split('-')[:3])
        return '%d月%d日 周%s' % (m, d, WEEKDAYS[datetime.date(y, m, d).weekday()])
    except (ValueError, TypeError):
        return ''


def summarize(city, data):
    """Open-Meteo forecast JSON -> what the page shows (pure, tested).

    'days' is every day the forecast returned (today first, at most FORECAST_DAYS); the page shows the
    first two until the line is tapped. Each day carries a real label (date + weekday) so "第几天"
    and "周几" asked out loud line up with what is on the screen."""
    cur = data.get('current') or {}
    daily = data.get('daily') or {}
    dates = daily.get('time') or []
    days = []
    for i in range(min(len(dates), FORECAST_DAYS)):
        try:
            code = daily['weather_code'][i]
            lo, hi = daily['temperature_2m_min'][i], daily['temperature_2m_max'][i]
        except (KeyError, IndexError, TypeError):
            continue
        text, icon = describe(code)
        rain = None
        try:
            rain = daily['precipitation_probability_max'][i]
        except (KeyError, IndexError, TypeError):
            pass
        days.append({'label': '今天' if i == 0 else ('明天' if i == 1 else day_label(dates[i])),
                     'date': str(dates[i]), 'text': text, 'icon': icon,
                     'lo': None if lo is None else round(lo), 'hi': None if hi is None else round(hi),
                     'rain': rain})
    now_text, now_icon = describe(cur.get('weather_code'))
    temp = cur.get('temperature_2m')
    return {'city': city, 'now': {'text': now_text, 'icon': now_icon,
                                  'temp': None if temp is None else round(temp)},
            'days': days}


class Weather:
    def __init__(self, city):
        self.city = (city or '').strip()
        self.coords = None
        self.value = None
        self.at = 0.0
        self.failed_at = 0.0
        self._lock = asyncio.Lock()

    async def _geocode(self, session):
        async with session.get(GEOCODE, params={'name': self.city, 'count': 1, 'language': 'zh'}) as r:
            r.raise_for_status()
            hits = (await r.json()).get('results') or []
        if not hits:
            raise ValueError(f'no such city: {self.city}')
        return hits[0]['latitude'], hits[0]['longitude']

    async def get(self):
        """The cached summary, refreshed when older than TTL; None until the first success."""
        if not self.city:
            return None
        now = time.monotonic()
        if self.value and now - self.at < TTL:
            return self.value
        if now - self.failed_at < RETRY:
            return self.value
        async with self._lock:
            if self.value and time.monotonic() - self.at < TTL:
                return self.value
            if time.monotonic() - self.failed_at < RETRY:
                return self.value   # someone else just tried and failed while we waited
            try:
                async with aiohttp.ClientSession(timeout=TIMEOUT) as s:
                    if not self.coords:
                        self.coords = await self._geocode(s)
                    lat, lon = self.coords
                    params = {'latitude': lat, 'longitude': lon, 'timezone': 'Asia/Shanghai',
                              'forecast_days': FORECAST_DAYS,
                              'current': 'temperature_2m,weather_code',
                              'daily': 'weather_code,temperature_2m_max,temperature_2m_min,'
                                       'precipitation_probability_max'}
                    async with s.get(FORECAST, params=params) as r:
                        r.raise_for_status()
                        data = await r.json()
                self.value = summarize(self.city, data)
                self.at = time.monotonic()
            except Exception as e:
                self.failed_at = time.monotonic()
                log.warning('weather for %s unavailable: %s', self.city, e)
        return self.value
