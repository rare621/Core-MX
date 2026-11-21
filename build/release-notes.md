CoreMX 1.0.51

- Missing gear now explains why the owner's CoreMX could not send an item. If the owner is offline, CoreMX waits up to 10 minutes before trying other sources or asking you; it retries the MXB Mods lookup every 10 minutes.
- Paints for paid or account-bound models are no longer searched for separately. The missing model row explains that its paint needs the model too.
- Rider kits with a number or name plate are checked against the game's rider model when sharing, avoiding a false missing-model warning.

Includes **CoreMX-server-v27.zip** for completeness. The server code did not change in this release, and the live service was already v27 when prepared, so **no server update is needed**. Users should update the app to 1.0.51 for these sync fixes.
