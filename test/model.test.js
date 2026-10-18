// -----------------------------------------------------------------------------
// The pure mapping of src/model.js and the parser of src/live.js.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageOf } from '../src/live.js';
import {
  BUTTON_STATUS,
  buildModel,
  buttonOf,
  jobOf,
  levelOf,
  loadOf,
  positionOf,
  pressState,
  roleOf,
  sceneOf,
  stateOf,
  tiltOf,
  tiltPercentOf,
} from '../src/model.js';
import * as F from './helpers/fixtures.js';

const idsOf = (type, id) => ({
  device: `ext:x:${type}:${id}`,
  feature: (key) => `ext:x:${type}:${id}:${key}`,
});

test('positions: Wiser 0 is open, Gladys 100 is open', () => {
  assert.equal(positionOf(0), 100);
  assert.equal(positionOf(10000), 0);
  assert.equal(positionOf(8160), 18);
  assert.equal(levelOf(100), 0);
  assert.equal(levelOf(25), 7500);
  assert.equal(tiltPercentOf(9), 100);
  assert.equal(tiltOf(100), 9);
  assert.equal(tiltOf(50), 5);
});

test('roles of the loads', () => {
  const roles = F.loads()
    .map(loadOf)
    .filter(Boolean)
    .map((l) => [l.name, roleOf(l)]);
  assert.deepEqual(roles, [
    ['Plafonnier', 'light'],
    ['Spots', 'dimmer'],
    ['Store salon', 'blind'],
    ['Volet', 'shutter'],
    ['Store banne', 'awning'],
    ['Prise terrasse', 'switch'],
    ['Porte garage', 'impulse'],
    ['Velux', 'relay'],
    ['Chauffage', undefined],
    ['Bandeau', 'dimmer'],
  ]);
});

test('an on/off output is a light or a switch only without any sub-type', () => {
  const role = (sub_type, kind = 0) =>
    roleOf(loadOf({ id: 1, type: 'onoff', sub_type, device: '0000133a', channel: 0, kind }));
  assert.equal(role(''), 'light');
  assert.equal(role(undefined), 'light');
  assert.equal(role('', 1), 'switch');
  for (const variant of ['dto', 'DTO', ' dto', 'dto ', 'impulse', 'minuterie']) {
    assert.equal(role(variant), 'impulse', JSON.stringify(variant));
    assert.equal(role(variant, 1), 'impulse', JSON.stringify(variant));
  }
  assert.equal(
    roleOf(loadOf({ id: 1, type: 'motor', sub_type: ' Relay', device: '0000133a', channel: 0 })),
    'relay',
  );
});

test('the slats are a device of their own, only on request', () => {
  const loads = F.loads().map(loadOf).filter(Boolean);
  const off = buildModel(idsOf, { loads, serial: F.SERIAL });
  assert.ok(!off.devices.some((d) => d.external_id.startsWith('ext:x:tilt:')));
  const on = buildModel(idsOf, { loads, serial: F.SERIAL }, { publishTilt: true });
  const slats = on.devices.filter((d) => d.external_id.startsWith('ext:x:tilt:'));
  assert.deepEqual(
    slats.map((d) => [d.name, d.external_id]),
    [['Store salon – Lamelles', 'ext:x:tilt:0000155c_0']],
  );
  assert.deepEqual(on.loadDevices.get(3), ['ext:x:load:0000155c_0', 'ext:x:tilt:0000155c_0']);
});

test('a job: the loads it acts on', () => {
  assert.deepEqual(
    jobOf({
      id: 3,
      target_states: [{ load: 1 }, { load: 'x' }, { load: 7 }],
      button_ctrl: { event: 'click', button: 'on', loads: [8, -1] },
    }),
    [3, { loads: new Set([1, 7, 8]), scripts: false }],
  );
  assert.equal(jobOf({ id: 4, scripts: ['garage.py'] })[1].scripts, true);
  assert.equal(jobOf({ id: 4, scripts: [] })[1].scripts, false);
  assert.equal(jobOf({ id: 'a' }), undefined);
});

test('hostile answers: only known keys, ids checked', () => {
  assert.equal(loadOf({ id: '1', device: '0000133a', channel: 0 }), undefined);
  assert.equal(loadOf({ id: 1, device: '../x', channel: 0 }), undefined);
  assert.equal(loadOf({ id: 1, device: '0000133a', channel: -1 }), undefined);
  const state = stateOf(
    JSON.parse('{"__proto__":{"x":1},"bri":20000,"level":5000,"moving":"sideways"}'),
  );
  assert.deepEqual(state, { level: 5000 });
  assert.equal(Object.getPrototypeOf(state), Object.prototype);
  assert.equal(stateOf({ bri: '100' }), undefined);
  assert.equal(sceneOf({ id: 1 }), undefined);
  assert.equal(buttonOf({ id: null, device: '0000133a', channel: 0 }), undefined);
  assert.equal(loadOf({ id: 1, device: '0000133A', channel: 0, name: 'a\u0000b' }).name, 'a b');
});

test('the live messages', () => {
  assert.deepEqual(
    messageOf({ load: { id: 3, state: { moving: 'stop', tilt: 0, level: 8160 } } }),
    {
      type: 'load',
      id: 3,
      state: { moving: 'stop', tilt: 0, level: 8160 },
    },
  );
  assert.deepEqual(messageOf({ button: { id: 53, cmd: { event: 'click', type: 'down' } } }), {
    type: 'button',
    id: 53,
    event: 'click',
    button: 'down',
  });
  assert.equal(messageOf({ sensor: { id: 1, value: 20 } }), undefined);
  assert.equal(messageOf({ findme: { button: 345 } }), undefined);
  assert.equal(
    messageOf(JSON.parse('{"__proto__":{"load":{"id":1,"state":{"bri":1}}}}')),
    undefined,
  );
  assert.equal(messageOf({ load: { id: -1, state: { bri: 1 } } }), undefined);
  assert.equal(messageOf([1]), undefined);
});

test('presses: the type of the button picks the state', () => {
  assert.equal(pressState('click', 'up'), BUTTON_STATUS.UP_PRESS);
  assert.equal(pressState('press', 'on'), BUTTON_STATUS.ON_HOLD);
  assert.equal(pressState('release', 'off'), BUTTON_STATUS.RELEASE);
  assert.equal(pressState('click', 'toggle'), BUTTON_STATUS.TOGGLE);
  assert.equal(pressState('click', 'scene'), BUTTON_STATUS.CLICK);
  assert.equal(pressState('press', undefined), BUTTON_STATUS.LONG_CLICK_PRESS);
  assert.equal(pressState('release', 'stop'), BUTTON_STATUS.LONG_CLICK_RELEASE);
  assert.equal(pressState('nope', 'up'), undefined);
});

test('the model: external ids from the physical output, never the load id', () => {
  const loads = F.loads().map(loadOf).filter(Boolean);
  const model = buildModel(idsOf, {
    loads,
    scenes: F.scenes().map(sceneOf).filter(Boolean),
    jobs: new Map(F.jobs().map(jobOf)),
    buttons: F.buttons().map(buttonOf).filter(Boolean),
    rooms: new Map([[1, 'Salon']]),
    serial: F.SERIAL,
  });
  assert.equal(model.devices.length, F.OFFERED);
  assert.deepEqual(
    model.devices.map((d) => d.external_id),
    [
      'ext:x:load:0000133a_0',
      'ext:x:load:0000144b_0',
      'ext:x:load:0000155c_0',
      'ext:x:load:0000155d_0',
      'ext:x:load:0000155e_0',
      'ext:x:load:0000133a_1',
      'ext:x:load:0000166f_0',
      'ext:x:load:00001770_0',
      'ext:x:load:00001992_0',
      `ext:x:scene:${F.SERIAL}_15`,
      'ext:x:button:0000144b_0',
    ],
  );
  // The same output renumbered by the gateway keeps its external id.
  const renumbered = buildModel(idsOf, {
    loads: loads.map((l) => ({ ...l, id: l.id + 100 })),
    serial: F.SERIAL,
  });
  assert.equal(renumbered.devices[0].external_id, 'ext:x:load:0000133a_0');
  assert.ok(renumbered.readers.has(101));
  for (const device of model.devices) {
    for (const f of device.features) {
      assert.equal(f.unit, undefined, 'no unit on lights, shutters, buttons');
      assert.ok(!('write' in f) && !('read' in f));
    }
  }
});
