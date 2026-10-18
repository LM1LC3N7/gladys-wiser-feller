// -----------------------------------------------------------------------------
// The answers of the µGateway -> Gladys devices and routing tables (pure).
//
// Ported from aiowiserbyfeller (load/*.py, scene, button; Apache-2.0) and the
// entity choices of its Home Assistant integration (light, switch, cover,
// scene; Apache-2.0):
//   onoff, kind 0 (light)   light: on/off
//   onoff, kind 1 (switch)  switch: on/off (an outlet, a fan)
//   onoff, sub-type dto     impulse or staircase timer: state read only, and
//                           an "Activate" button refused unless allowed
//   dim, dali               light: on/off and brightness
//   motor                   shutter (curtain for an awning): open/close/stop
//                           and position; venetian blinds also the slats;
//                           a relay motor open/close/stop only
//   scene                   button "Run" (the job of the scene)
//   registered button       button presses (click, long press, release)
//
// External ids (frozen: never change one):
//   load    ext:<selector>:load:<device>_<channel>     (the physical output)
//   button  ext:<selector>:button:<device>_<channel>   (the physical input)
//   scene   ext:<selector>:scene:<gateway serial>_<scene id>
//   feature <device>:<key>
// Ids that come from the network are only used as Map keys, never as keys
// of plain objects.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { LIMITS, LOAD, SCALE } from './constants.js';
import { label } from './i18n.js';

/** Gladys BUTTON_STATUS values (server/utils/constants.js of the core). */
export const BUTTON_STATUS = {
  CLICK: 1,
  LONG_CLICK_PRESS: 3,
  LONG_CLICK_RELEASE: 4,
  RELEASE: 20,
  ON_PRESS: 39,
  ON_HOLD: 40,
  UP_PRESS: 41,
  UP_HOLD: 42,
  DOWN_PRESS: 43,
  DOWN_HOLD: 44,
  OFF_PRESS: 45,
  OFF_HOLD: 46,
  TOGGLE: 52,
  TOGGLE_HOLD: 53,
};

/** Gladys COVER_STATE values (shutter and curtain `state`). */
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };

/** Gladys BUTTON_PUSH.PRESSED: the one value of a `button/push` command. */
export const PRESSED = 1;

/** The state of a Wiser button event: [click, press, release] by button type. */
const PRESS_STATES = new Map([
  ['on', [BUTTON_STATUS.ON_PRESS, BUTTON_STATUS.ON_HOLD, BUTTON_STATUS.RELEASE]],
  ['off', [BUTTON_STATUS.OFF_PRESS, BUTTON_STATUS.OFF_HOLD, BUTTON_STATUS.RELEASE]],
  ['up', [BUTTON_STATUS.UP_PRESS, BUTTON_STATUS.UP_HOLD, BUTTON_STATUS.RELEASE]],
  ['down', [BUTTON_STATUS.DOWN_PRESS, BUTTON_STATUS.DOWN_HOLD, BUTTON_STATUS.RELEASE]],
  ['toggle', [BUTTON_STATUS.TOGGLE, BUTTON_STATUS.TOGGLE_HOLD, BUTTON_STATUS.RELEASE]],
]);
const GENERIC_PRESS = [
  BUTTON_STATUS.CLICK,
  BUTTON_STATUS.LONG_CLICK_PRESS,
  BUTTON_STATUS.LONG_CLICK_RELEASE,
];

/** A press of a Wiser button -> the Gladys button state. */
export function pressState(event, button) {
  const states = PRESS_STATES.get(button) ?? GENERIC_PRESS;
  return states[['click', 'press', 'release'].indexOf(event)];
}

// --- Answers -> plain records (only known keys are copied) ----------------------

const isId = (v) => Number.isSafeInteger(v) && v >= 0;
const intIn = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);
const text = (v) =>
  typeof v === 'string'
    ? [...v]
        .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
        .join('')
        .trim()
        .slice(0, LIMITS.name)
    : '';
/** A K+ device address: hexadecimal, like "0000133a". */
const DEVICE_REF = /^[0-9a-f]{1,16}$/i;

/** The state of a load (REST or live): bri, level, tilt, moving, learning. */
export function stateOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const state = {};
  const bri = intIn(raw.bri, 0, SCALE.full);
  const level = intIn(raw.level, 0, SCALE.full);
  const tilt = intIn(raw.tilt, 0, SCALE.tilt);
  if (bri !== undefined) {
    state.bri = bri;
  }
  if (level !== undefined) {
    state.level = level;
  }
  if (tilt !== undefined) {
    state.tilt = tilt;
  }
  if (['up', 'down', 'stop'].includes(raw.moving)) {
    state.moving = raw.moving;
  }
  const learning = raw.flags?.learning;
  if (learning === 0 || learning === 1 || typeof learning === 'boolean') {
    state.learning = Boolean(learning);
  }
  return Object.keys(state).length > 0 ? state : undefined;
}

/** A load of GET /api/loads, or undefined when it is not usable. */
export function loadOf(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) {
    return undefined;
  }
  const device = typeof raw.device === 'string' ? raw.device.toLowerCase() : '';
  const channel = intIn(raw.channel, 0, 255);
  if (!DEVICE_REF.test(device) || channel === undefined || raw.unused === true) {
    return undefined;
  }
  return {
    id: raw.id,
    type: typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : '',
    // Normalized: " DTO" is "dto". Absent is "".
    subType: typeof raw.sub_type === 'string' ? raw.sub_type.trim().toLowerCase() : '',
    device,
    channel,
    name: text(raw.name),
    kind: intIn(raw.kind, 0, 99),
    room: isId(raw.room) ? raw.room : undefined,
  };
}

/** A scene of GET /api/scenes (with the id of its job). */
export function sceneOf(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.id) || !isId(raw.job)) {
    return undefined;
  }
  return { id: raw.id, job: raw.job, name: text(raw.name) };
}

/**
 * A job of GET /api/jobs: [id, { loads, scripts }]: the load ids it acts on
 * (target states, button control), and whether it runs scripts (which may
 * drive any output).
 */
export function jobOf(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) {
    return undefined;
  }
  const loads = new Set();
  for (const target of Array.isArray(raw.target_states) ? raw.target_states : []) {
    if (isId(target?.load)) {
      loads.add(target.load);
    }
  }
  const ctrl = raw.button_ctrl;
  for (const id of Array.isArray(ctrl?.loads) ? ctrl.loads : []) {
    if (isId(id)) {
      loads.add(id);
    }
  }
  const scripts = Array.isArray(raw.scripts) && raw.scripts.length > 0;
  return [raw.id, { loads, scripts }];
}

/** A REGISTERED button of GET /api/buttons (only those send their presses). */
export function buttonOf(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) {
    return undefined;
  }
  const device = typeof raw.device === 'string' ? raw.device.toLowerCase() : '';
  const channel = intIn(raw.channel, 0, 255);
  if (!DEVICE_REF.test(device) || channel === undefined) {
    return undefined;
  }
  return {
    id: raw.id,
    device,
    channel,
    subType: text(raw.sub_type),
  };
}

/** A room of GET /api/rooms: [id, name]. */
export function roomOf(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.id) || !text(raw.name)) {
    return undefined;
  }
  return [raw.id, text(raw.name)];
}

// --- What each load becomes --------------------------------------------------------

/**
 * The role of a load: light, dimmer, switch, impulse, shutter, blind, awning,
 * relay, or undefined (hvac, unknown types: not offered).
 */
export function roleOf(load) {
  switch (load.type) {
    case LOAD.ONOFF:
      // A light or a switch only with no sub-type at all: "dto" (impulse,
      // staircase timer) and any sub-type unknown today are impulse outputs,
      // read-only with their button behind the option.
      if (load.subType !== '') {
        return 'impulse';
      }
      return load.kind === LOAD.KIND_SWITCH ? 'switch' : 'light';
    case LOAD.DIM:
    case LOAD.DALI:
      return 'dimmer';
    case LOAD.MOTOR:
      if (load.subType === LOAD.RELAY) {
        return 'relay';
      }
      if (load.kind === LOAD.KIND_VENETIAN) {
        return 'blind';
      }
      return load.kind === LOAD.KIND_AWNING ? 'awning' : 'shutter';
    default:
      return undefined;
  }
}

/** Wiser level (0 open .. 10000 closed) -> Gladys position (0 closed .. 100 open). */
export const positionOf = (level) => 100 - Math.round(level / 100);
/** Gladys position -> Wiser level. */
export const levelOf = (position) => (100 - position) * 100;
/** Wiser tilt (0..9) -> percent. */
export const tiltPercentOf = (tilt) => Math.round((tilt / SCALE.tilt) * 100);
/** Percent -> Wiser tilt. */
export const tiltOf = (percent) => Math.round((percent / 100) * SCALE.tilt);

/** A value of a command: a finite number, never null nor '' (they are not 0). */
function numberIn(value, min, max) {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  if (value === null || value === undefined || typeof value === 'boolean') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

const refuse = (refusal) => {
  const err = new Error(refusal);
  err.refusal = refusal;
  throw err;
};

/** The writes: value -> one call `{ ctrl: [button, event] } | { target } | { job }`. */
const WRITE = {
  onOff(value) {
    const v = numberIn(value, 0, 1);
    if (v !== 0 && v !== 1) {
      refuse('badValue');
    }
    // A button press, as the Wiser switches do: the turn-on behaviour set on
    // the device (full or last brightness) is respected (aiowiserbyfeller).
    return { ctrl: [v === 1 ? 'on' : 'off', 'click'] };
  },
  brightness(value) {
    const v = numberIn(value, 0, 100);
    if (v === undefined) {
      refuse('badValue');
    }
    return { target: { bri: Math.round(v) * 100 } };
  },
  impulse(value) {
    if (numberIn(value, PRESSED, PRESSED) !== PRESSED) {
      refuse('badValue');
    }
    return { ctrl: ['on', 'click'] };
  },
  coverState(value) {
    const v = numberIn(value, -1, 1);
    if (v === COVER_STATE.OPEN) {
      return { target: { level: 0 } };
    }
    if (v === COVER_STATE.CLOSE) {
      return { target: { level: SCALE.full } };
    }
    if (v === COVER_STATE.STOP) {
      return { ctrl: ['stop', 'click'] };
    }
    return refuse('badValue');
  },
  position(value) {
    const v = numberIn(value, 0, 100);
    if (v === undefined) {
      refuse('badValue');
    }
    return { target: { level: levelOf(Math.round(v)) } };
  },
  tilt(value) {
    const v = numberIn(value, 0, 100);
    if (v === undefined) {
      refuse('badValue');
    }
    return { target: { tilt: tiltOf(v) } };
  },
};

/** The reads: state -> value (undefined when the state does not tell it). */
const READ = {
  onOff: (s) => (s.bri === undefined ? undefined : s.bri > 0 ? 1 : 0),
  brightness: (s) => (s.bri === undefined ? undefined : Math.round(s.bri / 100)),
  coverState: (s) =>
    s.moving === 'up'
      ? COVER_STATE.OPEN
      : s.moving === 'down'
        ? COVER_STATE.CLOSE
        : s.moving === 'stop'
          ? COVER_STATE.STOP
          : undefined,
  // A motor learning its end positions (not calibrated) has no known position.
  position: (s) => (s.level === undefined || s.learning ? undefined : positionOf(s.level)),
  tilt: (s) => (s.tilt === undefined || s.learning ? undefined : tiltPercentOf(s.tilt)),
};

const feature = (key, language, category, type, { min = 0, max = 1, write, read, feedback }) => ({
  key,
  name: label(key, language),
  category,
  type,
  min,
  max,
  read_only: !write,
  has_feedback: feedback ?? Boolean(write && read),
  keep_history: true,
  write,
  read,
});

/** The features of a load by role. */
function featuresOf(role, language) {
  const cover = (category) => [
    feature('state', language, category, T.SHUTTER.STATE, {
      min: -1,
      max: 1,
      write: WRITE.coverState,
      read: READ.coverState,
      feedback: false,
    }),
  ];
  const positioned = (category) => [
    ...cover(category),
    feature('position', language, category, T.SHUTTER.POSITION, {
      max: 100,
      write: WRITE.position,
      read: READ.position,
    }),
  ];
  switch (role) {
    case 'light':
      return [
        feature('on', language, C.LIGHT, T.LIGHT.BINARY, { write: WRITE.onOff, read: READ.onOff }),
      ];
    case 'dimmer':
      return [
        feature('on', language, C.LIGHT, T.LIGHT.BINARY, { write: WRITE.onOff, read: READ.onOff }),
        feature('brightness', language, C.LIGHT, T.LIGHT.BRIGHTNESS, {
          max: 100,
          write: WRITE.brightness,
          read: READ.brightness,
        }),
      ];
    case 'switch':
      return [
        feature('on', language, C.SWITCH, T.SWITCH.BINARY, {
          write: WRITE.onOff,
          read: READ.onOff,
        }),
      ];
    case 'impulse':
      // Never a switch nor a light: an "everything on/off" must not pulse a
      // garage door opener wired to an impulse output.
      return [
        feature('state', language, C.UNKNOWN, T.SENSOR.BINARY, { read: READ.onOff }),
        feature('impulse', language, C.BUTTON, T.BUTTON.PUSH, {
          min: PRESSED,
          max: PRESSED,
          write: WRITE.impulse,
          feedback: false,
        }),
      ];
    case 'relay':
      return cover(C.SHUTTER);
    case 'shutter':
      return positioned(C.SHUTTER);
    case 'awning':
      return positioned(C.CURTAIN);
    case 'blind':
      // The slats are a device of their own (option publish_tilt), see buildModel.
      return positioned(C.SHUTTER);
    default:
      return [];
  }
}

const withRoom = (name, room) => (room && !name.includes(room) ? `${name} (${room})` : name);

const params = (list) =>
  list
    .filter((p) => p.value !== undefined && p.value !== null && String(p.value) !== '')
    .map((p) => ({ name: p.name, value: String(p.value).slice(0, 255) }));

export function emptyModel() {
  return {
    devices: [],
    /** load id -> [{ featureId, read }] */
    readers: new Map(),
    /** feature id -> { write, loadId?, job?, role, safety? } */
    writers: new Map(),
    /** load id -> [Gladys device ids] (a venetian blind and its slats) */
    loadDevices: new Map(),
    /** Gladys device id -> load id */
    deviceLoads: new Map(),
    /** button id -> { featureId, deviceId } */
    buttons: new Map(),
    /** load ids of motors (read back longer after a command) */
    motors: new Set(),
    counts: { loads: 0, offered: 0, skipped: 0, scenes: 0, buttons: 0, overflow: 0 },
  };
}

/**
 * @param {(type: string, id: string) => { device: string, feature: (key: string) => string }} idsOf
 *   gladys.externalIds
 * @param {{ loads: object[], scenes?: object[], jobs?: Map<number, Set<number>>, buttons?: object[],
 *   rooms?: Map<number, string>, serial: string }} inventory records of the functions above
 *   (jobs: job id -> the load ids it acts on; undefined when not read)
 * @param {{ language?: 'fr'|'en', publishTilt?: boolean }} [options]
 */
export function buildModel(idsOf, inventory, { language = 'fr', publishTilt = false } = {}) {
  const model = emptyModel();
  const rooms = inventory.rooms ?? new Map();
  /** every impulse output, offered or not (the scenes touching one are guarded) */
  const impulses = new Set(
    (inventory.loads ?? []).filter((l) => roleOf(l) === 'impulse').map((l) => l.id),
  );
  const full = () => {
    if (model.devices.length >= LIMITS.devices) {
      model.counts.overflow += 1;
      return true;
    }
    return false;
  };
  /** device ref -> [load] (to name the buttons after the loads of their device) */
  const byDevice = new Map();
  const seen = new Set();
  for (const load of inventory.loads ?? []) {
    model.counts.loads += 1;
    const role = roleOf(load);
    const platformId = `${load.device}_${load.channel}`;
    if (!role || seen.has(platformId)) {
      model.counts.skipped += 1;
      continue;
    }
    seen.add(platformId);
    if (!byDevice.has(load.device)) {
      byDevice.set(load.device, []);
    }
    byDevice.get(load.device).push(load);
    if (full()) {
      continue;
    }
    const ids = idsOf('load', platformId);
    const features = featuresOf(role, language);
    const name = withRoom(load.name || `Wiser ${platformId}`, rooms.get(load.room));
    model.devices.push({
      name: name.slice(0, 100),
      external_id: ids.device,
      should_poll: false,
      params: params([
        { name: 'WISER_LOAD_ID', value: load.id },
        { name: 'WISER_DEVICE', value: load.device },
        { name: 'WISER_CHANNEL', value: load.channel },
        { name: 'WISER_TYPE', value: [load.type, load.subType].filter(Boolean).join('/') },
        { name: 'WISER_ROOM', value: rooms.get(load.room) },
      ]),
      features: features.map(({ key, write: _w, read: _r, ...f }) => ({
        ...f,
        external_id: ids.feature(key),
      })),
    });
    model.counts.offered += 1;
    model.loadDevices.set(load.id, [ids.device]);
    model.deviceLoads.set(ids.device, load.id);
    if (['shutter', 'blind', 'awning', 'relay'].includes(role)) {
      model.motors.add(load.id);
    }
    const readers = features
      .filter((f) => f.read)
      .map((f) => ({ featureId: ids.feature(f.key), read: f.read }));
    for (const f of features.filter((x) => x.write)) {
      model.writers.set(ids.feature(f.key), {
        write: f.write,
        loadId: load.id,
        role,
        safety: role === 'impulse' ? 'impulse' : undefined,
      });
    }
    if (role === 'blind' && publishTilt && !full()) {
      // The slats as their own device (review I4): a "close all blinds" of a
      // voice assistant may target it too, so it is published on request only.
      const tiltIds = idsOf('tilt', platformId);
      const tilt = feature('tilt', language, C.SHUTTER, T.SHUTTER.POSITION, {
        max: 100,
        write: WRITE.tilt,
        read: READ.tilt,
      });
      model.devices.push({
        name: `${name} – ${label('tilt', language)}`.slice(0, 100),
        external_id: tiltIds.device,
        should_poll: false,
        params: params([
          { name: 'WISER_LOAD_ID', value: load.id },
          { name: 'WISER_DEVICE', value: load.device },
          { name: 'WISER_CHANNEL', value: load.channel },
        ]),
        features: [
          (({ key, write: _w, read: _r, ...rest }) => ({
            ...rest,
            external_id: tiltIds.feature(key),
          }))(tilt),
        ],
      });
      model.loadDevices.get(load.id).push(tiltIds.device);
      model.deviceLoads.set(tiltIds.device, load.id);
      readers.push({ featureId: tiltIds.feature('tilt'), read: tilt.read });
      model.writers.set(tiltIds.feature('tilt'), { write: tilt.write, loadId: load.id, role });
    }
    model.readers.set(load.id, readers);
  }

  const scenesSeen = new Set();
  for (const scene of inventory.scenes ?? []) {
    // A scene without its job (another user's, or deleted) cannot run.
    if (scenesSeen.has(scene.id) || (inventory.jobs && !inventory.jobs.has(scene.job))) {
      continue;
    }
    scenesSeen.add(scene.id);
    if (full()) {
      continue;
    }
    const ids = idsOf('scene', `${inventory.serial}_${scene.id}`);
    const f = feature('run', language, C.BUTTON, T.BUTTON.PUSH, {
      min: PRESSED,
      max: PRESSED,
      write: true,
      feedback: false,
    });
    model.devices.push({
      name: `${label('scene', language)} ${scene.name || scene.id}`.slice(0, 100),
      external_id: ids.device,
      should_poll: false,
      params: params([
        { name: 'WISER_SCENE_ID', value: scene.id },
        { name: 'WISER_JOB_ID', value: scene.job },
      ]),
      features: [
        (({ key, write: _w, read: _r, ...rest }) => ({ ...rest, external_id: ids.feature(key) }))(
          f,
        ),
      ],
    });
    model.counts.scenes += 1;
    // A scene that drives an impulse output is guarded like it, and shares
    // its 3 s spacing (review I3 and round 2); when the jobs could not be
    // read, or the job runs scripts, any impulse output may be in it.
    const job = inventory.jobs?.get(scene.job);
    const impulseLoads =
      !inventory.jobs || job?.scripts
        ? [...impulses]
        : [...(job?.loads ?? [])].filter((id) => impulses.has(id));
    const touchesImpulse = impulseLoads.length > 0;
    model.writers.set(ids.feature('run'), {
      write(value) {
        if (numberIn(value, PRESSED, PRESSED) !== PRESSED) {
          refuse('badValue');
        }
        return { job: scene.job };
      },
      role: 'scene',
      sceneId: scene.id,
      safety: touchesImpulse ? 'impulse' : undefined,
      impulseLoads,
    });
  }

  const buttonsSeen = new Set();
  for (const button of inventory.buttons ?? []) {
    const platformId = `${button.device}_${button.channel}`;
    if (buttonsSeen.has(platformId) || model.buttons.has(button.id)) {
      continue;
    }
    buttonsSeen.add(platformId);
    if (full()) {
      continue;
    }
    const ids = idsOf('button', platformId);
    const loads = byDevice.get(button.device) ?? [];
    const owner = loads.find((l) => l.channel === button.channel) ?? loads[0];
    const base = owner?.name
      ? withRoom(owner.name, rooms.get(owner.room))
      : `Wiser ${button.device}`;
    model.devices.push({
      name: `${label('buttonOf', language)} ${button.channel + 1} – ${base}`.slice(0, 100),
      external_id: ids.device,
      should_poll: false,
      params: params([
        { name: 'WISER_BUTTON_ID', value: button.id },
        { name: 'WISER_DEVICE', value: button.device },
        { name: 'WISER_CHANNEL', value: button.channel },
        { name: 'WISER_BUTTON_TYPE', value: button.subType },
      ]),
      features: [
        {
          name: label('press', language),
          external_id: ids.feature('press'),
          category: C.BUTTON,
          type: T.BUTTON.CLICK,
          min: 0,
          max: 200,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
      ],
    });
    model.counts.buttons += 1;
    model.buttons.set(button.id, { featureId: ids.feature('press'), deviceId: ids.device });
  }
  return model;
}

/** The values of one load's state: [{ featureId, state }]. */
export function valuesOf(model, loadId, state) {
  const out = [];
  for (const reader of model.readers.get(loadId) ?? []) {
    const value = reader.read(state);
    if (value !== undefined) {
      out.push({ featureId: reader.featureId, state: value });
    }
  }
  return out;
}
