"""Exercise the shipped Windows plugin through the actual exported ABI."""
import ctypes as c
import json
import pathlib
import sys
import tempfile


class BikeEvent(c.Structure):
    _fields_ = [(n, c.c_char * 100) for n in ("rider", "bike_id", "bike")]
    _fields_ += [("gears", c.c_int * 4), ("engine", c.c_float * 7)]
    _fields_ += [(n, c.c_char * 100) for n in ("category", "track_id", "track")]
    _fields_ += [("length", c.c_float), ("type", c.c_int), ("server", c.c_char * 64),
                ("server_type", c.c_int), ("guid", c.c_char * 100)]


class RaceEvent(c.Structure):
    _fields_ = [("type", c.c_int), ("name", c.c_char * 100),
                ("track", c.c_char * 100), ("length", c.c_float)]


plugin = c.CDLL(str(pathlib.Path(sys.argv[1]).resolve()))
plugin.Startup.argtypes = [c.c_char_p]
plugin.Startup.restype = c.c_int
for callback in (plugin.EventInit, plugin.RaceEvent):
    callback.argtypes = [c.c_void_p, c.c_int]
plugin.RunTelemetry.argtypes = [c.c_void_p, c.c_int, c.c_float, c.c_float]
with tempfile.TemporaryDirectory(prefix="mxb-presence-") as folder:
    state_file = pathlib.Path(folder, "mxbm_presence.json")
    old_disable = pathlib.Path(folder, "mxbm_hook_disabled.json")
    old_disable.write_text('{"v":1,"build":0,"at":1}')
    read = lambda: json.loads(state_file.read_text())
    assert plugin.Startup(folder.encode()) == 3, "Startup must enable callbacks, not return -1"
    assert not old_disable.exists(), "A newer plugin must retire an older build's crash marker"
    assert read()["v"] == 2 and read()["inEvent"] == 0
    try:
        race = RaceEvent(type=2, name=b"Fixture event", track=b"Fixture track")
        plugin.RaceEvent(c.byref(race), c.sizeof(race))
        assert read()["inEvent"] == 1 and read()["trackName"] == "Fixture track"
        bike = BikeEvent(rider=b"Fixture rider", bike=b"Fixture bike", type=2,
                         track_id=b"fixture", track=b"Fixture track", server=b"Fixture server", guid=b"fixture-guid")
        plugin.EventInit(c.byref(bike), c.sizeof(bike))
        assert read()["server"] == "Fixture server" and read()["guid"] == "fixture-guid"
        plugin.RunTelemetry(None, 0, 0, 0)  # no telemetry file or per-frame writes
        plugin.RaceDeinit()
        assert read()["inEvent"] == 0 and "server" not in read()
        # Optional server fields must not depend on the GUID being supplied.
        plugin.EventInit(c.byref(bike), BikeEvent.server.offset + 64)
        assert read()["server"] == "Fixture server" and read()["guid"] == ""
        plugin.EventDeinit()
        # Older game packets still carry track/type even without server fields.
        plugin.EventInit(c.byref(bike), BikeEvent.server.offset)
        assert read()["inEvent"] == 1 and "server" not in read()
        race.type = -1
        plugin.RaceEvent(c.byref(race), c.sizeof(race))
        assert read()["inEvent"] == 0 and "server" not in read()
    finally:
        plugin.Shutdown()
    assert read()["inEvent"] == 0
    hook = json.loads(pathlib.Path(folder, "mxbm_hook.json").read_text())
    # Outside MX Bikes the code signature cannot match, so the missing-track hook must stay off.
    assert hook["state"] == "paused", hook
    assert sorted(p.name for p in pathlib.Path(folder).iterdir()) == ["mxbm_hook.json", "mxbm_presence.json"]
print("Plugin enabled; race/bike callbacks, optional fields, replay and exit states verified")
