"""Panel search (music_api): several words, traditional = simplified, the title itself first, one
version per song, genre from the library's folders, and the index read once."""
import json

import pytest

from thinksmart_client import music_api

ROOT = "/mnt/thinksmart-music/main/"
ITEMS = [
    {"path": ROOT + "PoP/周杰伦/12 周杰伦 - 稻香.flac", "title": "12 周杰伦 - 稻香", "artist": "周杰伦", "genre_dir": "PoP", "ext": ".flac"},
    {"path": ROOT + "PoP/周杰伦/12 周杰伦 - 稻香.dsf", "title": "12 周杰伦 - 稻香", "artist": "周杰伦", "genre_dir": "PoP", "ext": ".dsf"},
    {"path": ROOT + "PoP/周杰倫/04 晴天.flac", "title": "04 晴天", "artist": "周杰倫", "genre_dir": "PoP", "ext": ".flac"},
    {"path": ROOT + "PoP/合集/稻香村的故事.flac", "title": "稻香村的故事", "artist": "某人", "genre_dir": "PoP", "ext": ".flac"},
    {"path": ROOT + "Classical/Bach/01 Aria.flac", "title": "01 Aria", "artist": "", "genre_dir": "Classical", "ext": ".flac"},
    {"path": ROOT + "试音/李贤/CDImage.wav", "title": "CDImage", "artist": "", "genre_dir": "试音", "ext": ".wav", "size": 7e8},
]


@pytest.fixture(autouse=True)
def index(tmp_path, monkeypatch):
    f = tmp_path / "music-index.json"
    f.write_text(json.dumps({"items": ITEMS}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(music_api, "MUSIC_INDEX_CANDIDATES", (str(f),))
    monkeypatch.setattr(music_api, "_INDEX_CACHE", {"key": None, "items": []})
    monkeypatch.setattr(music_api, "_playable", lambda t: True)
    return f


def titles(r):
    return [t["title"] for t in r]


def test_exact_title_first_and_one_version():
    r = music_api.list_tracks(10, "稻香")
    assert titles(r) == ["12 周杰伦 - 稻香", "稻香村的故事"]
    assert r[0]["ext"] == "flac"                  # not the DSD copy


def test_several_words_and_traditional_chinese():
    assert titles(music_api.list_tracks(10, "周杰伦 晴天")) == ["04 晴天"]
    assert titles(music_api.list_tracks(10, "周杰倫 稻香")) == ["12 周杰伦 - 稻香"]


def test_genre_comes_from_the_folder_and_skips_whole_discs():
    assert titles(music_api.random_tracks(10, genre="classical")) == ["01 Aria"]
    assert music_api.random_tracks(10, genre="test") == []


def test_index_is_read_once(index, monkeypatch):
    music_api.list_tracks(5, "稻香")
    real = json.load
    monkeypatch.setattr(json, "load", lambda *a, **k: pytest.fail("read the index again"))
    music_api.list_tracks(5, "晴天")
    monkeypatch.setattr(json, "load", real)


def test_youtube_tracks_play_through_the_resolver(monkeypatch):
    calls = []
    monkeypatch.setattr(music_api, "resolver", lambda vid: calls.append(vid) or "http://example.invalid/a.webm")
    monkeypatch.setattr(music_api.subprocess, "Popen", lambda cmd, **k: calls.append(cmd) or _P())
    music_api.set_queue([{"title": "下一個天亮", "path": "ytm:g_r56GqF0E4"}], 0)
    r = music_api.play_index(0, 40)
    assert r["ok"] and calls[0] == "g_r56GqF0E4" and calls[1][-1] == "http://example.invalid/a.webm"
    assert music_api.local_status()["origin"] == "youtube"
    music_api.local_stop()


class _P:
    pid = 999999
    returncode = None

    def poll(self):
        return None

    def terminate(self):
        self.returncode = 0

    def wait(self, timeout=None):
        return 0

    def kill(self):
        pass
