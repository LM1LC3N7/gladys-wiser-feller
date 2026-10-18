# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the projects below, under their own licences.

## aiowiserbyfeller

- Project: [Syonix/aiowiserbyfeller](https://github.com/Syonix/aiowiserbyfeller),
  version 2.2.2, by Michael Burri (Syonix): the asynchronous Python client of
  the Wiser by Feller µGateway API.
- What is ported (rewritten in JavaScript in `src/wiser.js`, `src/live.js`,
  `src/model.js` and `src/constants.js`): the REST paths (`info`,
  `account/claim`, `account`, `loads`, `loads/state`, `loads/<id>/state`,
  `loads/<id>/target_state`, `loads/<id>/ctrl`, `scenes`, `jobs`,
  `jobs/<id>/trigger`, `buttons`, `rooms`), the answer envelope and the
  refusals it tells apart ("api is locked", "unauthorized user", "no button
  pressed"), the claim of a token by a press on the µGateway (`user`,
  `source`), the `Authorization: Bearer` header of the REST API and of the
  WebSocket on `/api`, the load types, sub-types and kinds, the scales of
  `bri`, `level` and `tilt`, the button types and events, and switching a
  light on by a simulated `on` click.
- Changes: rewritten in JavaScript for Node.js, without its classes, aiohttp
  and websockets dependencies; only the paths above are kept.
- Licence: Apache License 2.0 (the full text is the one of `LICENSE`).

## ha-wiser-by-feller

- Project: [Syonix/ha-wiser-by-feller](https://github.com/Syonix/ha-wiser-by-feller),
  version 1.0.0 (commit 855a797), the Home Assistant integration built on
  aiowiserbyfeller.
- What is reused (rewritten in JavaScript in `src/model.js` and `src/app.js`):
  the choice of entity per load (on/off lights and switches by `kind`, dimmers,
  covers with tilt for venetian blinds, awnings, relay motors without
  position), the position and tilt conversions, the scenes run through their
  job and only when the job exists, the shape of the live button events
  (`{"button": {"id", "cmd": {"event", "type"}}}`) and of the live load
  states, the `admin` account copied by default when claiming.
- Changes: rewritten in JavaScript for the Gladys device model.
- Licence: Apache License 2.0 (the full text is the one of `LICENSE`).

## Feller wiser-api and wiser-tutorial

- Projects: [Feller-AG/wiser-api](https://github.com/Feller-AG/wiser-api) (the
  OpenAPI description of the µGateway API) and
  [Feller-AG/wiser-tutorial](https://github.com/Feller-AG/wiser-tutorial)
  (its tutorial). The test fixtures of `test/helpers/fixtures.js` follow
  their examples.
- Licence: MIT.

```
MIT License

Copyright (c) 2021 Feller AG, Switzerland

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

(The wiser-api repository carries the same notice, "Copyright (c) 2022 Feller
AG, Switzerland".)
