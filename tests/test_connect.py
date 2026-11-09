"""One connection to the hub: a second wake (button, voice, a report to read) while connecting
waits for the first connect instead of opening another.

Run like test_barge_in.py (it stubs the audio stack; importing it first does that here too).
"""
import asyncio

import pytest

import test_barge_in


def make_client():
    c = test_barge_in.make_client()
    c.tools_listed = asyncio.Event()
    c.play = lambda name: None
    return c


class SlowHub:
    features = {}

    def __init__(self, fail=False):
        self.ws = None
        self.connects = 0
        self.fail = fail
        self.sent = []

    @property
    def connected(self):
        return self.ws is not None

    async def connect(self):
        self.connects += 1
        await asyncio.sleep(0.05)              # handshake and the hub's hello
        if self.fail:
            raise OSError('refused')
        self.ws = object()

    async def send(self, msg):
        self.sent.append(msg)
        return True


@pytest.mark.asyncio
async def test_concurrent_wakes_open_one_connection():
    c = make_client()
    c.hub = SlowHub()
    results = await asyncio.gather(*(c.ensure_connected() for _ in range(3)))
    assert results == [True, True, True]
    assert c.hub.connects == 1


@pytest.mark.asyncio
async def test_a_failed_connect_does_not_block_the_next_try():
    c = make_client()
    c.hub = SlowHub(fail=True)
    assert not await c.ensure_connected()
    assert c.state == 'idle'
    c.hub.fail = False
    assert await c.ensure_connected()
    assert c.hub.connects == 2


class FakeWs:
    def __init__(self, msgs):
        self.msgs = msgs
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.msgs:
            raise StopAsyncIteration
        return self.msgs.pop(0)

    async def close(self):
        self.closed = True


@pytest.mark.asyncio
async def test_a_handler_error_closes_the_connection_it_gives_up_on():
    from thinksmart_client.hub import Hub
    closed = []

    async def on_json(msg):
        raise KeyError('label')

    async def on_closed():
        closed.append(True)
    hub = Hub('ws://x', 'd', 'c', 't', on_json, lambda b: None, on_closed)
    ws = hub.ws = FakeWs(['{"type": "server"}'])
    await hub._read(ws)
    assert ws.closed and closed and not hub.connected


class DroppedHub(test_barge_in.FakeHub):
    """The hub closed the channel (its idle timeout, a restart): sends fail until we reconnect."""

    def __init__(self, fails=1):
        super().__init__()
        self.connected = False
        self.fails = fails
        self.connects = 0

    async def send(self, msg):
        if not self.connected:
            return False
        if self.fails:
            self.fails -= 1
            return False
        self.sent.append(msg)
        return True

    async def connect(self):
        self.connects += 1
        self.connected = True


def dropped_client(fails=1):
    c = make_client()
    c.hub = DroppedHub(fails)
    c.decoder = None
    c.mute_audio = False
    c.tools_listened = asyncio.Event()
    c.tools_listed = asyncio.Event()
    c.tools_listed.set()
    c.connecting = asyncio.Lock()
    c.play = lambda name: None
    return c


@pytest.mark.asyncio
async def test_listen_start_reconnects_once_when_the_channel_is_gone():
    """The hub closed the channel between turns: the mic must not be left "listening" into nothing."""
    c = dropped_client(fails=1)
    assert await c.start_listening('realtime') is True
    assert c.hub.connects == 1                     # reconnected before speaking
    assert c.hub.kinds() == [('listen', 'start')]  # exactly one listen start reached the hub
    assert c.uploading and c.state == 'listening'


@pytest.mark.asyncio
async def test_a_channel_that_stays_closed_leaves_the_client_idle():
    c = dropped_client(fails=2)
    assert await c.start_listening('realtime') is False
    assert not c.uploading and c.state == 'idle'   # no mic upload into a dead channel
    assert c.hub.connects == 1
