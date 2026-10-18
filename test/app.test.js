// -----------------------------------------------------------------------------
// The app through the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and an in-memory µGateway. Timers are mocked: the reads, the
// reconnections and the state flush run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WiserApp } from '../src/app.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { T } from '../src/i18n.js';
import { LiveError } from '../src/live.js';
import { BUTTON_STATUS, COVER_STATE } from '../src/model.js';
import { StateStore } from '../src/store.js';
import { WiserError } from '../src/wiser.js';
import { CONFIG, GATEWAY_URL, captureLogger, fakeGateway, settle } from './helpers/fakeGateway.js';
import { NEW_TOKEN, OFFERED, TOKEN } from './helpers/fixtures.js';

async function setup(t, { config = CONFIG, prepare = () => {}, store, devices, claim } = {}) {
  t.mock.timers.enable({
    apis: ['setTimeout', 'setInterval', 'Date'],
    now: Date.parse('2026-10-18T08:00:00.000Z'),
  });
  const gladys = createFakeGladys({ config, devices });
  const gw = fakeGateway();
  prepare(gw);
  const logger = captureLogger();
  const app = new WiserApp({
    gladys,
    connect: gw.connect,
    live: gw.openLive,
    claim,
    logger,
    store: store ?? new StateStore({ dir: null }),
  });
  registerHandlers(gladys, app, logger);
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  await gladys.connect();
  await settle();
  await tick(0); // the read that follows the opening of the socket
  t.after(() => {
    // The token never appears in a log line.
    for (const line of logger.lines) {
      assert.ok(!line.includes(TOKEN) && !line.includes(NEW_TOKEN), `token logged: ${line}`);
    }
  });
  return { gladys, app, gw, tick, logger };
}

const deviceNamed = (gladys, name) => gladys.fake.discoveredDevices.find((d) => d.name === name);

async function created(gladys, name) {
  const device = deviceNamed(gladys, name);
  assert.ok(device, `${name} is discovered`);
  await gladys.fake.deviceCreated(device);
  return device;
}

const featureOf = (device, key) => {
  const feature = device.features.find((f) => f.external_id === `${device.external_id}:${key}`);
  assert.ok(feature, `${device.name} has ${key}`);
  return feature;
};

const statesOf = (gladys, featureId) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === featureId);

test('the outputs, scenes and buttons become Gladys devices, their values sent once created', async (t) => {
  const { gladys, app, gw, tick } = await setup(t);
  assert.equal(gw.clients.at(-1).url, GATEWAY_URL);
  assert.equal(gladys.fake.discoveredDevices.length, OFFERED);
  assert.equal(app.liveState, 'live');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    T.connected({ loads: 9, scenes: 1, buttons: 1 }, 'live', 30).en,
  );
  const lamp = deviceNamed(gladys, 'Plafonnier (Salon)');
  assert.equal(lamp.external_id, 'ext:test-integration:load:0000133a_0');
  assert.ok(deviceNamed(gladys, 'Scène Wiser Absent'));
  assert.equal(deviceNamed(gladys, 'Scène Wiser Orpheline'), undefined, 'its job is unknown');
  assert.ok(deviceNamed(gladys, 'Bouton 1 – Spots (Salon)'));
  assert.equal(deviceNamed(gladys, 'Chauffage'), undefined, 'hvac is not offered');
  assert.equal(deviceNamed(gladys, 'Libre'), undefined, 'unused outputs are not offered');

  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.states.length, 0, 'nothing is sent for a device not created');

  await created(gladys, 'Plafonnier (Salon)');
  const spots = await created(gladys, 'Spots (Salon)');
  const blind = await created(gladys, 'Store salon (Salon)');
  const awning = await created(gladys, 'Store banne');
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${lamp.external_id}:on`), 1);
  assert.equal(gladys.fake.lastState(`${spots.external_id}:brightness`), 50);
  assert.equal(
    gladys.fake.lastState(`${blind.external_id}:position`),
    18,
    '8160 closed -> 18 % open',
  );
  assert.equal(gladys.fake.lastState(`${blind.external_id}:state`), COVER_STATE.STOP);
  assert.equal(
    deviceNamed(gladys, 'Store salon (Salon) – Lamelles'),
    undefined,
    'slats off by default',
  );
  assert.equal(
    gladys.fake.lastState(`${awning.external_id}:position`),
    undefined,
    'a motor still learning has no known position',
  );
  const badge = gladys.fake.transports
    .filter((e) => e.device_external_id === lamp.external_id)
    .at(-1);
  assert.deepEqual(badge, {
    device_external_id: lamp.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('blinds are shutters or curtains, never switches; impulse outputs are neither switches nor lights', async (t) => {
  const { gladys } = await setup(t, {
    prepare: (g) => {
      // Sub-types written otherwise, or unknown today: all impulse outputs.
      const variant = (id, name, sub_type) => ({
        id,
        name,
        type: 'onoff',
        sub_type,
        device: `000020${id}`,
        channel: 0,
        unused: false,
        kind: 0,
      });
      g.loads.push(variant(21, 'Minuterie', 'DTO'), variant(22, 'Gâche', ' dto'));
      g.loads.push(variant(23, 'Impulsion', 'impulse'));
    },
  });
  const categories = (name) =>
    deviceNamed(gladys, name).features.map((f) => `${f.category}/${f.type}`);
  assert.deepEqual(categories('Store salon (Salon)'), ['shutter/state', 'shutter/position']);
  assert.deepEqual(categories('Volet (Chambre)'), ['shutter/state', 'shutter/position']);
  assert.deepEqual(categories('Store banne'), ['curtain/state', 'curtain/position']);
  assert.deepEqual(categories('Velux'), ['shutter/state']);
  assert.deepEqual(categories('Prise terrasse'), ['switch/binary']);
  assert.deepEqual(categories('Porte garage'), ['unknown/binary', 'button/push']);
  assert.deepEqual(categories('Bandeau'), ['light/binary', 'light/brightness']);
  assert.deepEqual(categories('Minuterie'), ['unknown/binary', 'button/push']);
  assert.deepEqual(categories('Gâche'), ['unknown/binary', 'button/push']);
  assert.deepEqual(categories('Impulsion'), ['unknown/binary', 'button/push']);
  for (const device of gladys.fake.discoveredDevices) {
    for (const f of device.features) {
      if (f.category === 'switch' || f.category === 'light') {
        assert.ok(!/Store|Volet|Velux|Porte/.test(device.name), `${device.name}: ${f.category}`);
      }
    }
  }
  const garage = deviceNamed(gladys, 'Porte garage');
  assert.equal(featureOf(garage, 'state').read_only, true);
});

test('live messages reach Gladys at once; every press is an event; foreign and hostile ids are ignored', async (t) => {
  const { gladys, app, gw, tick } = await setup(t);
  const lamp = await created(gladys, 'Plafonnier (Salon)');
  const blind = await created(gladys, 'Store salon (Salon)');
  const button = await created(gladys, 'Bouton 1 – Spots (Salon)');
  await tick(TIMINGS.flushInterval);

  gw.emit({ load: { id: 1, state: { bri: 0 } } });
  gw.emit({ load: { id: 3, state: { moving: 'down' } } });
  gw.emit({ load: { id: 999, state: { bri: 10000 } } });
  gw.emit(JSON.parse('{"load":{"id":1,"state":{"__proto__":{"polluted":1},"bri":10000}}}'));
  gw.emit(JSON.parse('{"__proto__":{"load":{"id":1,"state":{"bri":0}}}}'));
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${lamp.external_id}:on`), 1);
  assert.equal(gladys.fake.lastState(`${blind.external_id}:state`), COVER_STATE.CLOSE);
  assert.equal(gladys.fake.lastState(`${blind.external_id}:position`), 18, 'the level is kept');
  assert.equal({}.polluted, undefined);
  assert.ok(!app.states.has(999));

  gw.emit({ button: { id: 53, cmd: { event: 'click', type: 'up' } } });
  gw.emit({ button: { id: 53, cmd: { event: 'click', type: 'up' } } });
  gw.emit({ button: { id: 53, cmd: { event: 'press', type: 'down' } } });
  gw.emit({ button: { id: 53, cmd: { event: 'release', type: 'down' } } });
  gw.emit({ button: { id: 53, cmd: { event: 'click', type: 'scene' } } });
  gw.emit({ button: { id: 54, cmd: { event: 'click', type: 'up' } } });
  gw.emit({ button: { id: 53, cmd: { event: 'nope', type: 'up' } } });
  await tick(TIMINGS.flushInterval);
  assert.deepEqual(
    statesOf(gladys, `${button.external_id}:press`).map((s) => s.state),
    [
      BUTTON_STATUS.UP_PRESS,
      BUTTON_STATUS.UP_PRESS,
      BUTTON_STATUS.DOWN_HOLD,
      BUTTON_STATUS.RELEASE,
      BUTTON_STATUS.CLICK,
    ],
    'two presses in a row are two events',
  );
});

test('commands: lights by a button press, brightness, blinds, slats, stop, scenes', async (t) => {
  const { gladys, gw, tick } = await setup(t, { config: { ...CONFIG, publish_tilt: true } });
  const lamp = await created(gladys, 'Plafonnier (Salon)');
  const spots = await created(gladys, 'Spots (Salon)');
  const blind = await created(gladys, 'Store salon (Salon)');
  const slats = await created(gladys, 'Store salon (Salon) – Lamelles');
  assert.equal(slats.external_id, 'ext:test-integration:tilt:0000155c_0');
  assert.deepEqual(
    slats.features.map((f) => `${f.category}/${f.type}`),
    ['shutter/position'],
  );
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${slats.external_id}:tilt`), 33, 'tilt 3 of 9');
  const velux = await created(gladys, 'Velux');
  const scene = await created(gladys, 'Scène Wiser Absent');
  const ok = async (device, key, value) => {
    const ack = await gladys.fake.setValue(device, featureOf(device, key), value);
    assert.equal(ack.success, true, ack.error);
    return gw.calls.at(-1);
  };
  assert.deepEqual((await ok(lamp, 'on', 0)).args, [1, 'off', 'click']);
  assert.deepEqual((await ok(lamp, 'on', 1)).args, [1, 'on', 'click']);
  assert.deepEqual((await ok(spots, 'brightness', 30)).args, [2, { bri: 3000 }]);
  assert.deepEqual((await ok(blind, 'position', 100)).args, [3, { level: 0 }], '100 % open');
  assert.deepEqual((await ok(blind, 'position', 25)).args, [3, { level: 7500 }]);
  assert.deepEqual((await ok(slats, 'tilt', 100)).args, [3, { tilt: 9 }]);
  assert.deepEqual((await ok(blind, 'state', COVER_STATE.CLOSE)).args, [3, { level: 10000 }]);
  assert.deepEqual((await ok(blind, 'state', COVER_STATE.OPEN)).args, [3, { level: 0 }]);
  assert.deepEqual((await ok(blind, 'state', COVER_STATE.STOP)).args, [3, 'stop', 'click']);
  assert.deepEqual((await ok(velux, 'state', COVER_STATE.CLOSE)).args, [8, { level: 10000 }]);
  const run = await ok(scene, 'run', 1);
  assert.equal(run.name, 'triggerJob');
  assert.deepEqual(run.args, [14]);
  assert.ok(gw.calls.filter((c) => c.name !== 'live').every((c) => c.token === TOKEN));

  const before = gw.calls.length;
  for (const [device, key, value] of [
    [spots, 'brightness', null],
    [spots, 'brightness', ''],
    [spots, 'brightness', 101],
    [lamp, 'on', 2],
    [blind, 'state', 5],
    [scene, 'run', 0],
  ]) {
    const ack = await gladys.fake.setValue(device, featureOf(device, key), value);
    assert.equal(ack.success, false, `${key} ${value}`);
    assert.equal(ack.error, T.denied.badValue.fr);
  }
  assert.equal(gw.calls.length, before, 'nothing sent for a bad value');
});

test('the ack of a command never waits for a publication to Gladys', async (t) => {
  const { gladys, app } = await setup(t);
  const lamp = await created(gladys, 'Plafonnier (Salon)');
  app.publisher.flush = () => new Promise(() => {});
  gladys.publishTransports = () => new Promise(() => {});
  gladys.publishChangedStates = () => new Promise(() => {});
  const ack = await gladys.fake.setValue(lamp, featureOf(lamp, 'on'), 0);
  assert.equal(ack.success, true, ack.error);
});

test('impulse outputs: refused while not allowed, the option read again when the request leaves', async (t) => {
  const { gladys, app, gw, tick } = await setup(t);
  const garage = await created(gladys, 'Porte garage');
  const impulse = featureOf(garage, 'impulse');
  let ack = await gladys.fake.setValue(garage, impulse, 1);
  assert.equal(ack.success, false);
  assert.equal(ack.error, T.denied.impulseOff.fr);
  assert.equal(gw.callsOf('ctrl').length, 0);

  app.config = { ...app.config, allowImpulse: true };
  ack = await gladys.fake.setValue(garage, impulse, 1);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(gw.callsOf('ctrl').at(-1).args, [7, 'on', 'click']);
  ack = await gladys.fake.setValue(garage, impulse, 1);
  assert.equal(ack.error, T.denied.impulseBusy.fr, 'a double tap is not a second impulse');

  // Allowed when the command arrives, turned off before the request leaves.
  await tick(TIMINGS.impulseSpacing);
  let release;
  gw.gates.set('ctrl', new Promise((resolve) => (release = resolve)));
  const pending = gladys.fake.setValue(garage, impulse, 1);
  await settle();
  app.config = { ...app.config, allowImpulse: false };
  release();
  ack = await pending;
  assert.equal(ack.success, false);
  assert.equal(ack.error, T.denied.impulseOff.fr);
  assert.equal(gw.callsOf('ctrl').length, 1, 'the second impulse never left');
});

test('a command that may have left is "sent, without confirmation" and read back', async (t) => {
  const { gladys, gw, tick, app } = await setup(t);
  const spots = await created(gladys, 'Spots (Salon)');
  gw.failures.set('setTargetState', new WiserError('timeout', 'no answer within 4 s'));
  const ack = await gladys.fake.setValue(spots, featureOf(spots, 'brightness'), 70);
  assert.equal(ack.success, false);
  assert.equal(ack.error, T.denied.unconfirmed.fr);
  assert.ok(app.unconfirmed.has(2));
  gw.failures.delete('setTargetState');
  await tick(TIMINGS.commandEcho);
  assert.equal(gw.callsOf('loadState').at(-1).args[0], 2);
  assert.ok(!app.unconfirmed.has(2));

  // The gateway answered and refused: said so, nothing to confirm.
  gw.failures.set(
    'setTargetState',
    new WiserError('api', 'invalid value (HTTP 400)', { status: 400 }),
  );
  const refused = await gladys.fake.setValue(spots, featureOf(spots, 'brightness'), 70);
  assert.match(refused.error, /a refusé la commande : invalid value/);
});

test('a refused token is never tried again alone, even after a restart; a new token lifts it', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wiser-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new StateStore({ dir });
  const { gladys, app, gw, tick } = await setup(t, {
    store,
    prepare: (g) => g.tokens.clear(),
    claim: async ({ url, source }) => {
      assert.equal(url, GATEWAY_URL);
      assert.equal(source, 'admin');
      return NEW_TOKEN;
    },
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /a refusé le jeton/);
  const calls = gw.calls.length;
  await tick(24 * 60 * 60_000);
  assert.equal(gw.calls.length, calls, 'no request for a day');
  const saved = readFileSync(join(dir, 'state.json'), 'utf8');
  assert.ok(!saved.includes(TOKEN), 'only a fingerprint is kept');

  // A restart of the container: still blocked, still silent.
  const again = new WiserApp({
    gladys,
    connect: gw.connect,
    live: gw.openLive,
    store: new StateStore({ dir }),
    logger: captureLogger(),
  });
  t.after(() => again.stop());
  await again.start(CONFIG);
  assert.equal(gw.calls.length, calls);
  assert.ok(again.blocked);
  again.stop();

  // "Get the token": one claim, saved in the secret field, then connected.
  gw.tokens.add(NEW_TOKEN);
  const answer = await gladys.fake.action(ACTIONS.CLAIM, {});
  assert.equal(answer.success, true);
  assert.equal(answer.data.message.fr, T.claim.ok.fr);
  assert.deepEqual(gladys.fake.bodies('POST', '/config').at(-1), {
    config: { api_token: NEW_TOKEN },
  });
  await settle();
  await tick(0);
  assert.equal(app.online, true);
  assert.equal(gw.clients.at(-1).token, NEW_TOKEN);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the claim: one request per click, a busy click refused, no button pressed told', async (t) => {
  let release;
  let calls = 0;
  const { gladys } = await setup(t, {
    claim: () => {
      calls += 1;
      return new Promise((resolve, reject) => {
        release = () => reject(new WiserError('nobutton', 'no button pressed', { status: 200 }));
      });
    },
  });
  const first = gladys.fake.action(ACTIONS.CLAIM, {});
  await settle();
  const second = await gladys.fake.action(ACTIONS.CLAIM, {});
  assert.equal(second.data.message.fr, T.claim.busy.fr);
  release();
  assert.equal((await first).data.message.fr, T.claim.noButton.fr);
  assert.equal(calls, 1, 'never repeated by the integration');
  assert.equal(gladys.fake.bodies('POST', '/config').length, 0);
});

test('a reconnection to Gladys publishes the status and the Discovery again, keeps the client', async (t) => {
  const { gladys, gw } = await setup(t);
  const statuses = gladys.fake.connectionStatuses.length;
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  const clients = gw.clients.length;
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
  assert.equal(gw.clients.length, clients, 'the client is kept');
});

test('a 429 pauses every path, outlives a reconnection to Gladys, then reconnects', async (t) => {
  const { gladys, app, gw, tick } = await setup(t);
  const lamp = await created(gladys, 'Plafonnier (Salon)');
  gw.failures.set(
    'loadsState',
    new WiserError('rate', 'too many requests (HTTP 429)', { status: 429, retryAfter: 120_000 }),
  );
  await tick(TIMINGS.resync);
  assert.equal(app.online, false);
  assert.ok(app.paused());
  const ack = await gladys.fake.setValue(lamp, featureOf(lamp, 'on'), 0);
  assert.equal(ack.error, T.denied.paused.fr);
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.ok(app.paused(), 'the pause is kept');
  gw.failures.delete('loadsState');
  const calls = gw.callsOf('loads').length;
  await tick(60_000);
  assert.equal(gw.callsOf('loads').length, calls, 'nothing during the pause');
  await tick(60_000);
  assert.equal(app.online, true);
});

test('a secondary list that fails never blocks the outputs', async (t) => {
  const { gladys } = await setup(t, {
    prepare: (gw) => {
      gw.failures.set(
        'scenes',
        new WiserError('notfound', 'not found (HTTP 404)', { status: 404 }),
      );
      gw.failures.set('buttons', new WiserError('server', 'HTTP 500', { status: 500 }));
    },
  });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.discoveredDevices.length, 9);
});

test('a device published again never loses a feature it was created with', async (t) => {
  const devices = [
    {
      name: 'Store salon',
      external_id: 'ext:test-integration:load:0000155c_0',
      features: [
        {
          name: 'Ancienne',
          external_id: 'ext:test-integration:load:0000155c_0:legacy',
          category: 'shutter',
          type: 'position',
          min: 0,
          max: 100,
          read_only: false,
          has_feedback: true,
          keep_history: true,
        },
      ],
    },
  ];
  const { gladys } = await setup(t, { devices });
  const blind = gladys.fake.discoveredDevices.find((d) => d.external_id === devices[0].external_id);
  const keys = blind.features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys.sort(), ['legacy', 'position', 'state']);
});

test('without live updates the states are read at the interval, and after a command', async (t) => {
  const { gladys, gw, tick, app } = await setup(t, {
    config: { ...CONFIG, live_updates: false, poll_interval: 20 },
  });
  assert.equal(app.liveState, 'off');
  assert.equal(gw.liveOpens, 0);
  const reads = gw.callsOf('loadsState').length;
  await tick(20_000);
  assert.equal(gw.callsOf('loadsState').length, reads + 1);
  const blind = await created(gladys, 'Store salon (Salon)');
  await gladys.fake.setValue(blind, featureOf(blind, 'position'), 0);
  for (const delay of [1500, 8500, 20_000, 40_000]) {
    await tick(delay);
  }
  assert.equal(gw.callsOf('loadState').length, 4, 'a motor is read back as it moves');
});

test('a lost socket: degraded badges, reads at the interval, the socket again', async (t) => {
  const { gladys, app, gw, tick } = await setup(t);
  const lamp = await created(gladys, 'Plafonnier (Salon)');
  gw.liveFailure = new LiveError('network', 'connection refused or failed');
  gw.drop();
  await settle();
  assert.equal(app.liveState, 'down');
  const badge = gladys.fake.transports
    .filter((e) => e.device_external_id === lamp.external_id)
    .at(-1);
  assert.equal(badge.degraded, true);
  gw.liveFailure = undefined;
  await tick(TIMINGS.liveRetryMin);
  assert.equal(app.liveState, 'live');
});

test('the watchdog: a read that finds a change no message told opens the socket again', async (t) => {
  const { gw, tick, app } = await setup(t);
  assert.equal(gw.liveOpens, 1);
  await tick(TIMINGS.resync); // a baseline read after the socket opened
  assert.equal(gw.liveOpens, 1, 'nothing missed');
  gw.emit({ sensor: { id: 1, value: 21 } }); // a message dropped, but the socket is alive
  gw.states.set(1, { bri: 0 });
  await tick(TIMINGS.resync);
  assert.equal(gw.liveOpens, 2);
  assert.equal(app.liveState, 'live');
});

test('a socket silent for 10 minutes is opened again', async (t) => {
  const { gw, tick } = await setup(t);
  await tick(TIMINGS.resync);
  assert.equal(gw.liveOpens, 1);
  await tick(TIMINGS.resync);
  assert.equal(gw.liveOpens, 2, '10 minutes without any message');
});

test('a gateway that accepts the socket then cuts it at once: spaced retries, one read per interval', async (t) => {
  const { gw, tick, app } = await setup(t, {
    prepare: (g) => {
      const open = g.openLive;
      g.openLive = async (options) => {
        const session = await open(options);
        // Cut 1 s after it opened, every time.
        setTimeout(() => {
          if (!session.closed) {
            session.closed = true;
            session.onClose('connection closed');
          }
        }, 1000);
        return session;
      };
    },
  });
  const opens = [];
  const reads = gw.callsOf('loadsState').length;
  let last = gw.liveOpens;
  for (let s = 0; s < 600; s += 1) {
    await tick(1000);
    if (gw.liveOpens !== last) {
      opens.push(s);
      last = gw.liveOpens;
    }
  }
  assert.ok(opens.length <= 10, `${opens.length} reopenings in 10 min`);
  const gaps = opens.slice(1).map((s, i) => s - opens[i]);
  assert.ok(
    gaps.every((g, i) => i === 0 || g >= gaps[i - 1]),
    `growing delays: ${gaps.join(', ')}`,
  );
  assert.ok(gaps.at(-1) >= 100, 'up to 2 minutes');
  const done = gw.callsOf('loadsState').length - reads;
  t.diagnostic(`reopened at ${opens.join(', ')} s; ${done} reads`);
  assert.ok(opens.length >= 5, 'the socket is tried again');
  assert.ok(done <= 600 / 30 + 1, `${done} reads in 10 min, at most one per 30 s`);
  assert.ok(app.liveFailures >= opens.length, 'failures not forgotten for a short-lived socket');
});

test('command failures: refused, sent without confirmation, or not sent', async (t) => {
  const { gladys, gw, app } = await setup(t);
  const spots = await created(gladys, 'Spots (Salon)');
  const scene = await created(gladys, 'Scène Wiser Absent');
  const brightness = featureOf(spots, 'brightness');
  const cases = [
    [new WiserError('server', 'HTTP 500', { status: 500 }), T.denied.unconfirmed.fr, true],
    [
      new WiserError('format', 'not an answer of a Wiser µGateway', { status: 200 }),
      T.denied.unconfirmed.fr,
      true,
    ],
    [new WiserError('size', 'answer too large'), T.denied.unconfirmed.fr, true],
    [new WiserError('network', 'connection reset', { sent: true }), T.denied.unconfirmed.fr, true],
    [
      new WiserError('network', 'connection refused', { sent: false }),
      T.denied.notSent('connection refused').fr,
      false,
    ],
    [
      new WiserError('network', 'host unreachable', { sent: false }),
      T.denied.notSent('host unreachable').fr,
      false,
    ],
    [
      new WiserError('timeout', 'no answer within 4 s', { sent: false }),
      T.denied.notSent('no answer within 4 s').fr,
      false,
    ],
    [
      new WiserError('api', 'bad request (HTTP 400)', { status: 400 }),
      T.denied.refused('bad request (HTTP 400)').fr,
      false,
    ],
    [
      new WiserError('api', 'value out of range', { status: 200 }),
      T.denied.refused('value out of range').fr,
      false,
    ],
  ];
  for (const [error, message, unconfirmed] of cases) {
    app.unconfirmed.clear();
    gw.failures.set('setTargetState', error);
    const ack = await gladys.fake.setValue(spots, brightness, 40);
    assert.equal(ack.error, message, error.message);
    assert.equal(app.unconfirmed.has(2), unconfirmed, error.message);
  }
  gw.failures.set('triggerJob', new WiserError('server', 'HTTP 503', { status: 503 }));
  const ack = await gladys.fake.setValue(scene, featureOf(scene, 'run'), 1);
  assert.equal(ack.error, T.denied.unconfirmedScene.fr, 'a scene has no state to read again');
});

test('a Wiser scene that drives an impulse output is guarded like it', async (t) => {
  const { gladys, gw, app, tick } = await setup(t, {
    prepare: (g) => {
      g.scenes.push({ id: 17, job: 20, name: 'Garage', kind: 1, type: 0, sceneButtons: [] });
      g.jobs.push({ id: 20, target_states: [{ load: 7, bri: 10000 }] });
    },
  });
  const garage = await created(gladys, 'Scène Wiser Garage');
  const away = await created(gladys, 'Scène Wiser Absent');
  const run = featureOf(garage, 'run');
  let ack = await gladys.fake.setValue(garage, run, 1);
  assert.equal(ack.error, T.denied.impulseOff.fr);
  ack = await gladys.fake.setValue(away, featureOf(away, 'run'), 1);
  assert.equal(ack.success, true, 'a scene without impulse output is not guarded');

  app.config = { ...app.config, allowImpulse: true };
  ack = await gladys.fake.setValue(garage, run, 1);
  assert.equal(ack.success, true, ack.error);
  ack = await gladys.fake.setValue(garage, run, 1);
  assert.equal(ack.error, T.denied.impulseBusy.fr);

  await tick(TIMINGS.impulseSpacing);
  let release;
  gw.gates.set('triggerJob', new Promise((resolve) => (release = resolve)));
  const pending = gladys.fake.setValue(garage, run, 1);
  await settle();
  app.config = { ...app.config, allowImpulse: false };
  release();
  ack = await pending;
  assert.equal(ack.error, T.denied.impulseOff.fr, 'the option read again when the request leaves');
  assert.equal(gw.callsOf('triggerJob').filter((c) => c.args[0] === 20).length, 1);
});

test('a token that does not look like one is never sent', async (t) => {
  const { gladys, gw } = await setup(t, {
    config: { gateway_address: '192.168.1.20', api_token: 'abc def\nghi' },
  });
  assert.equal(gw.calls.length, 0);
  assert.equal(gladys.fake.connectionStatus.message.fr, T.configError('bad-token').fr);
});

test('a claimed token Gladys cannot save is used from memory, and the status says so', async (t) => {
  const { gladys, gw, app, tick } = await setup(t, { claim: async () => NEW_TOKEN });
  gw.tokens.add(NEW_TOKEN);
  gladys.setConfig = async () => {
    throw new Error('HTTP 500');
  };
  const answer = await gladys.fake.action(ACTIONS.CLAIM, {});
  assert.equal(answer.data.message.fr, T.claim.saveFailed.fr);
  await settle();
  await tick(0);
  assert.equal(app.online, true);
  assert.equal(gw.clients.at(-1).token, NEW_TOKEN);
  assert.match(gladys.fake.connectionStatus.message.fr, /n'a pas pu être enregistré/);
  // A reconnection to Gladys keeps the token in memory.
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.equal(app.config.token, NEW_TOKEN);
});

test('another address: nothing of the previous gateway stays published', async (t) => {
  const { gladys, app } = await setup(t);
  assert.equal(gladys.fake.discoveredDevices.length, OFFERED);
  await app.configUpdated({ ...CONFIG, gateway_address: '192.168.1.21' });
  await settle();
  assert.equal(app.known.size, OFFERED, 'the new gateway (same fake) publishes its own');
  await app.configUpdated({ ...CONFIG, gateway_address: '' });
  assert.equal(app.known.size, 0);
});

test('the publisher keeps a share of the budget for the states during a burst of presses', async () => {
  const sent = { states: 0, events: 0 };
  const gladys = {
    publishStates: async (list) => {
      sent.events += list.length;
    },
    publishChangedStates: async (list) => {
      sent.states += list.length;
      return { count: list.length };
    },
  };
  const { StatePublisher } = await import('../src/publisher.js');
  const publisher = new StatePublisher({ gladys, logger: captureLogger(), budget: 100 });
  publisher.configure({ intervalSeconds: 0 });
  for (let i = 0; i < 300; i += 1) {
    publisher.pushEvent('ext:x:button:1:press', { state: 1 });
  }
  for (let i = 0; i < 30; i += 1) {
    publisher.push(`ext:x:load:${i}:on`, { state: 1 });
  }
  await publisher.flush();
  assert.equal(sent.states, 30, 'every pending state sent');
  assert.equal(sent.events, 70);
});

test('the test button: counts, and lifts a refusal when the token is accepted again', async (t) => {
  const { gladys, app, gw, tick } = await setup(t, { prepare: (g) => g.tokens.clear() });
  assert.ok(app.blocked);
  gw.tokens.add(TOKEN);
  const answer = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(
    answer.data.message.en,
    /^Connection OK: µGateway 9020\.001\.002 \(firmware 6\.0\.47, API 6\.0\), 9 outputs, 2 scenes, 1 registered button\. Live updates: OK\.$/,
  );
  await settle();
  await tick(0);
  assert.equal(app.online, true);
});
