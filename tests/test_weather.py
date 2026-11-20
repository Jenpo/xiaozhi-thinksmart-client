"""Home-screen weather (weather.py): the summary the page shows, and that a network failure neither
raises nor wipes the last good forecast."""
import pytest

from thinksmart_client import config, weather

SAMPLE = {
    'current': {'temperature_2m': 21.4, 'weather_code': 3},
    'daily': {'time': ['2026-11-20', '2026-11-21'],
              'weather_code': [3, 61], 'temperature_2m_min': [17.6, 16.9], 'temperature_2m_max': [27.2, 24.0],
              'precipitation_probability_max': [10, 65]},
}


def test_summary_has_today_and_tomorrow_in_chinese():
    w = weather.summarize('广州', SAMPLE)
    assert w['city'] == '广州'
    assert w['now'] == {'text': '阴', 'icon': 'cloud', 'temp': 21}
    assert w['days'] == [
        {'label': '今天', 'date': '2026-11-20', 'text': '阴', 'icon': 'cloud', 'lo': 18, 'hi': 27, 'rain': 10},
        {'label': '明天', 'date': '2026-11-21', 'text': '小雨', 'icon': 'rain', 'lo': 17, 'hi': 24, 'rain': 65},
    ]


def test_summary_carries_seven_days_with_dated_labels():
    dates = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26',
             '2026-11-27']
    data = {'daily': {'time': dates, 'weather_code': [0] * len(dates),
                      'temperature_2m_min': [10] * len(dates), 'temperature_2m_max': [20] * len(dates)}}
    days = weather.summarize('广州', data)['days']
    assert len(days) == weather.FORECAST_DAYS                 # 7, never 8 even if the API sends more
    assert [d['label'] for d in days[:3]] == ['今天', '明天', '11月22日 周日']
    assert days[3]['label'] == '11月23日 周一'
    assert weather.day_label('2026-13-40') == ''              # garbled date -> no label, no crash


def test_summary_tolerates_missing_fields():
    w = weather.summarize('广州', {'daily': {'time': ['2026-11-20'], 'weather_code': [999]}})
    assert w['days'] == []
    assert w['now']['temp'] is None


@pytest.mark.asyncio
async def test_failure_keeps_the_last_forecast_and_does_not_retry_at_once(monkeypatch):
    w = weather.Weather('广州')
    w.value, w.at = {'city': '广州', 'days': [1]}, -10_000.0     # stale, so it tries to refresh
    calls = []

    class Boom:
        def __init__(self, *a, **k):
            calls.append(1)

        async def __aenter__(self):
            raise OSError('network down')

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(weather.aiohttp, 'ClientSession', Boom)
    assert await w.get() == {'city': '广州', 'days': [1]}
    assert await w.get() == {'city': '广州', 'days': [1]}
    assert len(calls) == 1                                         # second call is inside RETRY


def test_weather_city_comes_from_the_device_config():
    # The city is per-device (config.json); the source keeps no city of its own, so changing where the
    # device is never means editing code.
    assert config.DEFAULTS['weather_city'] == ''
    w = weather.Weather('')
    assert w.city == ''


@pytest.mark.asyncio
async def test_no_city_means_no_weather():
    assert await weather.Weather('').get() is None
