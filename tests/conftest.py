"""Local-only stubs for the native bits the tests don't need on a Mac.

tests/test_barge_in.py stubs sounddevice, sherpa-onnx, WebRTC APM and libopus. Two things it
can't stub are needed before it even imports:

- libspeexdsp (speex_aec.py): on the device it comes with PipeWire; a Mac without it would fail
  at import. Stubbed only when it really is missing, so the device's own runs stay unchanged.
- pytest-asyncio: the device's run command installs it; skip the async tests instead of failing
  them when it isn't there.

Nothing here changes what the tests assert on the device.
"""
import ctypes
import ctypes.util
import sys
import types


def _speex_missing():
    for name in (ctypes.util.find_library('speexdsp'), 'libspeexdsp.so.1',
                 '/opt/homebrew/lib/libspeexdsp.dylib'):
        if not name:
            continue
        try:
            ctypes.CDLL(name)
            return False
        except OSError:
            pass
    return True


if _speex_missing():
    mod = types.ModuleType('thinksmart_client.speex_aec')

    class LinearAec:
        """Pass-through stand-in: the echo tests skip themselves when it is in use."""

        STUBBED = True

        def __init__(self, *_a, **_k):
            pass

        def process(self, near, _far):
            return near

        def reset(self):
            pass

    mod.LinearAec = LinearAec
    sys.modules['thinksmart_client.speex_aec'] = mod

try:
    import pytest_asyncio  # noqa: F401
except ImportError:   # not installed here: the async tests need it, they skip rather than fail
    def pytest_collection_modifyitems(config, items):
        import pytest
        skip = pytest.mark.skip(reason='pytest-asyncio not installed')
        for item in items:
            if 'asyncio' in item.keywords:
                item.add_marker(skip)
