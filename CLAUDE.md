# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
It bridges a Wiser by Feller µGateway through its local REST API and
WebSocket (logic ported from aiowiserbyfeller, Apache-2.0).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "impulse" # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js registers before connect())
src/app.js                        WiserApp: lifecycle, reads, live, commands, badges, claim, test
src/wiser.js                      REST client (Bearer token, envelope, errors by kind), claim
src/live.js                       ws://<gateway>/api, the live messages (parsed, known keys only)
src/model.js                      answers -> Gladys devices, readers, writers (pure)
src/publisher.js                  states within 300/min, button presses as events
src/store.js                      /data/state.json: refused token fingerprint, 429 pause
src/config.js                     DEFAULTS (mirrors the manifest defaults) + normalization
src/i18n.js                       texts in English and French
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys, an in-memory
                                  gateway and a simulated gateway on 127.0.0.1 (never the network)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Safety rules of this integration

- The token is claimed **only** from the "Get the token" button, one request
  per click, never in a loop; it goes only to the address of the
  configuration, in the `Authorization` header; never log it nor put it in a
  message.
- A refused token (401/403, "api is locked", "unauthorized user") stops
  everything and is never tried again automatically, even after a restart
  (`src/store.js`); only a new token, a new address or the Test button lift it.
- Blinds, shutters and awnings are never `switch`/`binary`. Impulse and
  staircase-timer outputs (`onoff`/`dto`) are never a switch nor a light; their
  "Activate" button is refused unless `allow_impulse_outputs`, read again
  when the request leaves.
- A reconnection to Gladys (`connected`) must not clear a 429 pause, a refused
  token, nor the client (`app.resume`), and publishes the status, the
  Discovery and the badges again.
- Commands are serialized per output and sent within 3.5 s or refused; their
  ack never waits for a publication to Gladys.
- Ids from the network are only Map keys; answers are copied key by key.
- Never add a call that changes the configuration of the µGateway (devices,
  buttons, network, accounts, reboot).

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the physical
  address of the output or input (`<device>_<channel>`), or the gateway serial
  and the scene id; never a load id nor a label. Gladys keys devices, their
  history, scenes and dashboards on them: changing one creates a new device
  and orphans the old one. The same goes for every key users store: manifest
  `config_schema`, `actions`, feature keys.
- **A device published again never loses a feature** (`app.publishDevices`
  merges the features of `gladys.devices`).
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code (defaults, actions):
  change both sides together. A `secret` field is not encrypted by Gladys:
  never write that it is.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
