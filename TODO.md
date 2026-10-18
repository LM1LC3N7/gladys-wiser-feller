# TODO — Wiser by Feller v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test` (Node
  22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own, no forum post from a module session (lot 7,
  wave 3: one post per wave in /t/10385).

## Status

- [x] **Milestone 1 — core** (2026-10-18): REST client (info, loads, states,
      rooms, scenes, jobs, buttons, target_state, ctrl, job trigger), "Get the
      token" claim button, live WebSocket, lights, dimmers, outlets, blinds
      with slats, shutters, awnings, relay motors, impulse outputs behind an
      option, Wiser scenes as buttons, registered button presses, 3.5 s
      command deadline, refused token kept in /data, 429 pause, badges, test
      button, en/fr, docs, cover. Tested against simulated answers and a
      simulated µGateway only.
- [ ] **Milestone 2 — real µGateway**: run against a real µGateway (generation
      A and B) and compare with the Wiser Home app (see "To check"); turn the
      answers (anonymized) into fixtures.
- [ ] **Milestone 3 — more**: DALI tunable white (`ct`) and RGBW colours,
      HVAC groups (thermostats, read-only first), sensors of generation B
      (temperature, brightness, wind, rain, window), system flags as read-only
      states, a `scene_triggers` entry for button presses, telling impulse and
      staircase timer apart (it needs the device config, see Decisions).
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public.

## To check on a real µGateway

- The answer to a wrong or revoked token: HTTP 401, or 200 with
  `{"status": "error", "message": "api is locked…"}` (aiowiserbyfeller reads
  the second); both stop the integration.
- The claim: that `POST /api/account/claim` really holds the answer until a
  button is pressed (the request waits 45 s, the button 90 s), and the answer
  when no button is pressed ("no button pressed" expected, as for the
  SmartButtons notify).
- Whether claiming `gladys` again invalidates the previous token at once
  (aiowiserbyfeller says so): the integration restarts with the new token
  right away.
- The WebSocket: that `Authorization: Bearer` is accepted at the upgrade, that
  it stays open for days (aiowiserbyfeller's watchdog is 15 minutes of
  silence: does the gateway send pings?), and whether a partial load state
  (only the changed keys) is sent.
- Button events: their exact JSON on firmware ≥ 6.0.41 (`cmd.event`,
  `cmd.type`), and whether SmartButtons appear in `GET /api/buttons`.
- `PUT /api/loads/<id>/ctrl {"button": "on"}` on a dimmer (aiowiserbyfeller
  uses it; the tutorial uses `up` for dimmers).
- Whether `GET /api/jobs/<id>/trigger` answers before or after the target
  states are reached (the command budget is 4.5 s).
- Motor positions during a move (Home Assistant notes they are not updated
  while moving); the `learning` flag of a motor not calibrated.
- Generation A gateways (API 5): `/api/buttons` and `/api/rooms` answers.
- An output set as impulse or timer in the eSetup app after its first
  configuration: does its `sub_type` really become `dto` in `/api/loads`
  (and when: at once, after a restart of the gateway)?
- A tilt (`target_state {tilt}`) sent while the blind is moving: does it stop
  the move, wait for its end, or get lost?
- The awning level: does `level` 0 mean retracted or deployed (here, as for
  the other motors, 0 = "open" = Gladys 100 %)?
- The answer of the claim and of a command when the gateway is busy (5xx):
  told "sent, without confirmation".

## Decisions

- **Reference reused: Syonix/aiowiserbyfeller 2.2.2** (Apache-2.0, maintained,
  the library of the Home Assistant integration), cloned read-only in
  `_ref/aiowiserbyfeller`. Python, so its logic is ported to JavaScript (REST
  paths, envelope, errors, claim, load types/kinds/scales, button events).
  Its Home Assistant integration Syonix/ha-wiser-by-feller (Apache-2.0) gave
  the entity choices and conversions. Feller's wiser-api / wiser-tutorial
  (MIT) documentation gave the shapes of the fixtures. All credited in
  `THIRD_PARTY_NOTICES.md` (copied into the image, like `LICENSE`). Single
  runtime dependency: the Gladys SDK; the WebSocket is Node's (undici takes
  the `Authorization` header in its options, checked on Node 22 and 24).
- **Neighbour module: LM1LC3N7/gladys-hubitat** (app structure, publisher,
  live socket and watchdog, command deadline, test helpers).
- **Token**: claimed only by the "Get the token" action (one request per
  click, a second click while one waits is refused, never repeated by the
  code; a test counts the `this.claim(` calls). User `gladys`, `source` from
  the `import_user` select (`admin` by default, as Home Assistant: the Wiser
  Home app account, whose names, rooms and scenes are copied). Saved with
  `setConfig({ api_token })`, then the app starts again with it. Sent only to
  the address typed (`http://` only, no path, no query, no credentials, no
  `.local`), in the `Authorization: Bearer` header; redirections never
  followed (Node's `http.request` does not follow them); never logged (tests
  check every log line); the reason texts of the gateway are cleaned of
  tokens and UUIDs. A `secret` field is kept in clear in the Gladys database:
  the docs say "kept by Gladys in its database, never shown again", never
  "encrypted".
- **Refused token** (lesson: never retry refused credentials): 401/403, "api
  is locked", "unauthorized user" stop everything, with no timer. A
  fingerprint (SHA-256 of address + token, 24 hex) is kept in
  `/data/state.json`, so a restart does not try it again either. Lifted by a
  new token (claim or config), a new address, or the Test button when the
  gateway accepts it.
- **429**: pause of every path (Retry-After, 1 min to 6 h), kept in `/data`,
  bounded when read back; covers commands, read-backs, Scan and Test. Other
  failures: backoff 5 s doubling to 60 s, never faster than the read interval
  (30 s by default). Never left without a retry timer, except a refused token.
- **Reconnection to Gladys** (`connected`): `resume()` keeps the client, the
  pause and the refusal, and publishes the status, the Discovery and the
  badges again (their caches cleared). `start()` clears them too.
- **External ids**: `load:<device>_<channel>` and `button:<device>_<channel>`
  (the physical output / input, stable when the gateway renumbers its load
  ids, as Home Assistant's unique ids), `scene:<gateway serial>_<scene id>`
  (scene ids are local to a gateway). Feature keys: `on`, `brightness`,
  `state`, `position`, `tilt`, `impulse`, `run`, `press`. Never change one.
- **No lost feature**: a device published again merges the features of the
  device created in Gladys (`gladys.devices`, kept up to date by the SDK) and
  those published earlier in the run.
- **Lights**: `onoff` kind 0 (or none) → `light/binary`; `onoff` kind 1 →
  `switch/binary` (an outlet or a fan, not sensitive); `dim` and `dali`
  (whatever the sub-type) → `light/binary` + `light/brightness` 0–100. On/off
  by a simulated button click (`ctrl on/off click`), as aiowiserbyfeller, so
  the turn-on behaviour set on the device is kept; brightness by
  `target_state {bri: n*100}`.
- **Blinds** (brief: never a switch): `motor` kind 1 venetian blind →
  `shutter/state` + `shutter/position`; its slats (the core has no tilt type
  for shutters) are a device of their own, "<blind> – Slats"
  (`ext:<selector>:tilt:<device>_<channel>`, one `shutter/position` feature
  `tilt`), published only when the `publish_tilt` option is on (off by
  default; review I4, coordinator decision): a "close all blinds" of Google,
  Alexa, HomeKit or MCP may target it too, the docs say so; kind 2 roller / kind 0
  motor → shutter; kind 3 awning → `curtain`; sub-type `relay` → `shutter/state`
  only. Position 100 = open (Gladys and zigbee2mqtt convention) = Wiser level 0;
  tilt 0–9 ↔ 0–100 %. State OPEN → level 0, CLOSE → level 10000, STOP →
  `ctrl stop click`. Read: `moving` up/down/stop → OPEN/CLOSE/STOP; no position
  while `flags.learning` is set. No unit (the core lists none for these
  categories).
- **Sub-types** (review I2): `type` and `sub_type` are trimmed and lower-cased;
  an `onoff` output is a light or a switch only with an empty or absent
  sub-type, any other one (`dto`, `DTO`, ` dto`, `impulse`, unknown) is an
  impulse output. An output re-set as impulse after its creation: Scan, then
  delete and add the device again (docs); until then its light commands are
  refused (no writer for them).
- **Scenes touching an impulse output** (review I3): a scene whose job
  (`target_states[].load`, `button_ctrl.loads`) drives an impulse output gets
  `safety: 'impulse'`: refused without the option, the option read again in
  the guard. Its writer lists the impulse outputs it drives (`impulseLoads`):
  the 3 s spacing is shared by the scene and those outputs (checked and set
  in the same synchronous step, so a scene and a direct impulse a few ms
  apart cannot both leave; approval round 2). When `/api/jobs` cannot be read,
  or the job runs scripts, every impulse output counts.
- **Impulse outputs** (`onoff` sub-type `dto`, impulse or staircase timer;
  telling them apart needs `GET /devices/<id>/config`, which puts the device
  in configuration mode: not done): never a switch nor a light (a garage door
  opener is often on an impulse output, and an "everything on" must not pulse
  it). State `unknown/binary` read-only, plus `button/push` "Activate" refused
  unless `allow_impulse_outputs` (off by default); the option is checked on
  arrival, when the command gets its turn, and in the guard run when the
  request leaves its socket. Two impulses of a same output at least 3 s apart
  (a double tap), set before the request.
- **Scenes**: `GET /api/scenes`, offered only when their job is in
  `GET /api/jobs` (as Home Assistant; when `/jobs` cannot be read they are all
  offered); `button/push` "Run" → `GET /api/jobs/<job>/trigger`.
- **Buttons** (brief: scene triggers if the API reports them): only the
  buttons registered on the gateway (`GET /api/buttons`, `id` not null) send
  events; one device each, `button/click` read-only, a state per press via
  `publishStates` (two presses are two events). States by button type: up →
  UP_PRESS / UP_HOLD / RELEASE, down, on, off likewise, toggle → TOGGLE /
  TOGGLE_HOLD / RELEASE, others (scene, stop) → CLICK / LONG_CLICK_PRESS /
  LONG_CLICK_RELEASE. The integration never registers a button (it would
  change the gateway configuration); no other write path exists (a test greps
  the client for config, reboot, reset, delete, DELETE, PATCH).
- **Live updates**: `ws://<gateway>/api` with the Bearer header; `load` and
  `button` messages only, parsed key by key (`Object.hasOwn`, known keys
  copied: no prototype pollution); partial states merged. States read again
  every 5 minutes, inventory every 30 minutes. Watchdog: a states read whose
  baseline was read after the socket opened, finding `bri` or `level`
  changed for a load no message touched since the read began, reopens the
  socket at once (staying "live"). Socket retried 5 s doubling to 2 min;
  without it the states are read at `poll_interval`. Review I1: the failure
  count is forgotten only after a socket stayed open 60 s, so a gateway that
  accepts then cuts at once keeps growing delays (test: reopened at 5, 16, 37,
  78, 159, 280, 401, 522 s over 10 min); at its opening the states are read
  only when the last read is older than `poll_interval`, and a loss never
  brings a planned read sooner (test: 20 reads in 10 min at 30 s). Minor 1: no
  message at all for 10 minutes (any message counts, even one dropped) → the
  socket is opened again (logged at info: a quiet house only costs a
  reopening). Minor 2: undici's WebSocket has no `maxPayload` option; a
  message over 64 KB is dropped after receipt (`LIMITS.eventBytes`), undici
  itself bounds frames.
- **Secondary endpoints** (lesson): rooms, scenes, jobs and buttons may fail
  (404 on older firmware, 5xx) without blocking the outputs; the last list
  read is kept; only a refused token or a 429 stops.
- **Commands**: serialized per output (or scene); refused unless sent within
  3.5 s (guard run again when the request leaves its socket, 1 s more for the
  request; "the command waited too long in the queue of this output").
  Failures (review I5): refused at the socket, connection refused, no route,
  or a timeout before the connection (the client marks `sent: false`) → "not
  sent"; a 4xx or an envelope `status: error` → "refused" with its reason; a
  5xx, an answer not understood or too large, a reset or a timeout once sent
  → "sent, without confirmation", read back and degraded badge (for a scene,
  without "state read again", minor 5). The ack never awaits a
  publication to Gladys (a test hangs every publication). Values validated
  strictly (null, '' and out-of-range refused). Without live updates, a load
  is read back 1.5 s after a command, a motor at 1.5, 10, 30 and 70 s.
- **Rates**: states through `publishChangedStates` (30-min heartbeat) within
  250 states a minute; each second up to 50 slots are kept for the pending
  states before the button presses (minor 8).
- **Second review round (2026-10-18)**, minor points: the auth words of the
  gateway restricted to "api is locked", "unauthorized", "invalid token", and
  read only after 404, 429 and 5xx (minor 3); the token of the configuration
  must match `TOKEN_PATTERN`, else a clear status and nothing is sent (minor
  4); a claimed token that `setConfig` could not save is used from memory,
  kept across reconnections to Gladys, and told in the status (minor 6); the
  ids of the created devices cached, refreshed on their events (minor 9); a
  new address clears what was published for the previous gateway (minor 11).
- **Approval round 2** (minor): the empty Discovery published at once after
  a change of address; 10 slots a second always left to the presses during a
  flood of states; a form saved with the old, invalidated token while a
  claimed token is unsaved keeps the token in memory (a token typed by the
  user wins).
- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json` and the
  manifest (with the `docker_image` tag
  `ghcr.io/lm1lc3n7/gladys-wiser-feller:0.1.0`): the one-time exception to
  "versions belong to the Release workflow"; the first patch release gives
  0.1.1.
- **LICENSE**: Apache-2.0 text with its appendix placeholders, no name
  (Louis's rule, checked by a test).
- **Not checked by this session**: the forum thread, Will_71's list, the store,
  the core and GitHub for duplicates (done by the pipeline before the wave);
  Docker build (no Docker on this PC); a real µGateway.
