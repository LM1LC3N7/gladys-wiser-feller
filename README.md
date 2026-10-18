# gladys-wiser-feller

[Gladys Assistant](https://gladysassistant.com) external integration for
**Wiser by Feller** installations (Switzerland): the outputs of the
**µGateway** (lights, dimmers, switched outlets, venetian blinds, shutters,
awnings), its **scenes** and the presses of its **registered buttons** become
Gladys devices of the Discovery tab. The states follow the µGateway live (its
WebSocket), and Gladys controls the outputs through its official local API, on
the local network only. Unofficial, not affiliated with Feller AG.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Development version.** Tested against a simulated µGateway only: it has
> never been tested with a real µGateway yet. Feedback and bug reports are
> welcome in the [GitHub issues](https://github.com/LM1LC3N7/gladys-wiser-feller/issues).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (WiserApp) ⇄ src/wiser.js ⇄ http://<µGateway>/api/… (Bearer token)
                                   │                     ⇄ src/live.js  ⇄ ws://<µGateway>/api
                                   ├─ src/model.js      answers -> Gladys devices, readers, writers (pure)
                                   ├─ src/publisher.js  states within 300/min, presses as events
                                   └─ src/store.js      /data/state.json: refused token, 429 pause
```

- **Token**: `POST /api/account/claim` (`{ user: "gladys", source: "admin" }`)
  from the **Get the token** button only: the µGateway blinks for 30 s and
  answers once one of its buttons is pressed. One request per click, never in
  a loop. The token is saved in the `secret` field through `setConfig`, sent
  only to the address typed (`Authorization: Bearer`), never logged; a
  redirection is never followed.
- **Inventory**: `GET /api/info` (serial, firmware, no token), `/api/loads`,
  then `/api/rooms`, `/api/scenes`, `/api/jobs`, `/api/buttons` (each may fail
  without blocking the outputs). External ids
  `ext:<selector>:load:<device>_<channel>`,
  `…:button:<device>_<channel>`, `…:scene:<serial>_<scene id>`.
- **States**: `GET /api/loads/state`; live changes on `ws://<µGateway>/api`
  (`{"load": {"id", "state"}}`, `{"button": {"id", "cmd": {"event", "type"}}}`).
  States read again every 5 minutes (a watchdog reopens the socket when a read
  finds a change no message told), the inventory every 30 minutes; without the
  socket, at the configured pace (30 s by default), and the socket is tried
  again (5 s doubling up to 2 min).
- **Commands**: lights by a simulated button press
  (`PUT /api/loads/<id>/ctrl {"button": "on", "event": "click"}`, which keeps
  the turn-on behaviour of the device), brightness, position and slats by
  `PUT /api/loads/<id>/target_state` (`bri` 0–10000, `level` 0 open–10000
  closed, `tilt` 0–9), stop by `ctrl stop`, scenes by
  `GET /api/jobs/<job>/trigger`. One at a time per output, sent within 3.5 s or
  refused; the ack never waits for a publication to Gladys. Impulse and
  staircase-timer outputs (sub-type `dto`) are never a switch nor a light, and
  their "Activate" button is refused unless allowed (the option is read again
  when the request leaves).
- **Failures**: µGateway unreachable → status message and `unreachable`
  badges, reconnection after 5 s doubling up to 60 s; token refused → stop,
  kept in `/data` across restarts, never tried again until a new token or the
  Test button; a 429 pauses every path (Retry-After, 1 min to 6 h, kept in
  `/data`). A reconnection to Gladys publishes the status, the Discovery and
  the badges again, without touching the client, the pause or the refusal.

## Reused work

- [Syonix/aiowiserbyfeller](https://github.com/Syonix/aiowiserbyfeller) 2.2.2
  (Apache-2.0), the Python client of the µGateway API: its paths, envelope,
  errors, claim, load types, kinds, scales and button events are **ported**
  to JavaScript (it cannot run in this Node container).
- [Syonix/ha-wiser-by-feller](https://github.com/Syonix/ha-wiser-by-feller)
  (Apache-2.0), its Home Assistant integration: the entity choices (lights,
  switches, covers, tilt, scenes through their job, button events) and the
  position conversions.
- Feller's [wiser-api](https://github.com/Feller-AG/wiser-api) and
  [wiser-tutorial](https://github.com/Feller-AG/wiser-tutorial) (MIT)
  documentation.
- [LM1LC3N7/gladys-hubitat](https://github.com/LM1LC3N7/gladys-hubitat), a
  local bridge of the same author: the app structure, the state publisher,
  the live socket handling and the test helpers.

Notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), copied into the
image. The only runtime dependency is the Gladys SDK (the WebSocket is the one
built into Node.js).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/helpers/fixtures.js` holds a small installation written from Feller's
documentation (not captured on a real µGateway). `test/helpers/fakeGateway.js`
serves it to the app tests (mocked timers); `test/helpers/gatewayServer.js` is
a simulated µGateway on 127.0.0.1 (REST API, claim and a minimal WebSocket),
against which `test/e2e.test.js` and `test/wiser.test.js` run the real client
and socket. See TODO.md, "To check on a real µGateway".

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store.

## License

Apache-2.0 (see [LICENSE](LICENSE)); ported logic under Apache-2.0, see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Wiser by Feller is a
trademark of Feller AG; this project is not affiliated with Feller AG.
