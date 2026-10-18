// -----------------------------------------------------------------------------
// A small Wiser installation, in the shapes of Feller's API documentation
// (wiser-api OpenAPI 6.0.47, wiser-tutorial) and of aiowiserbyfeller's tests.
// -----------------------------------------------------------------------------

export const TOKEN = '61b096f3-9f20-46db-932c-c8bbf7f6011d';
export const NEW_TOKEN = '60650cf4-5d26-4294-b1f2-6c06adc9d0d8';
export const SERIAL = '19100018';

export const info = () => ({
  product: '9020.001.002',
  instance_id: 1800,
  sn: SERIAL,
  api: '6.0',
  sw: '6.0.47',
  boot: '1.3.0',
  hw: '2',
});

export const loads = () => [
  {
    id: 1,
    name: 'Plafonnier',
    type: 'onoff',
    sub_type: '',
    device: '0000133a',
    channel: 0,
    unused: false,
    room: 1,
    kind: 0,
  },
  {
    id: 2,
    name: 'Spots',
    type: 'dim',
    sub_type: '',
    device: '0000144b',
    channel: 0,
    unused: false,
    room: 1,
    kind: 0,
  },
  {
    id: 3,
    name: 'Store salon',
    type: 'motor',
    sub_type: '',
    device: '0000155c',
    channel: 0,
    unused: false,
    room: 1,
    kind: 1,
  },
  {
    id: 4,
    name: 'Volet',
    type: 'motor',
    sub_type: '',
    device: '0000155d',
    channel: 0,
    unused: false,
    room: 2,
    kind: 2,
  },
  {
    id: 5,
    name: 'Store banne',
    type: 'motor',
    sub_type: '',
    device: '0000155e',
    channel: 0,
    unused: false,
    kind: 3,
  },
  {
    id: 6,
    name: 'Prise terrasse',
    type: 'onoff',
    sub_type: '',
    device: '0000133a',
    channel: 1,
    unused: false,
    kind: 1,
  },
  {
    id: 7,
    name: 'Porte garage',
    type: 'onoff',
    sub_type: 'dto',
    device: '0000166f',
    channel: 0,
    unused: false,
    kind: 0,
  },
  {
    id: 8,
    name: 'Velux',
    type: 'motor',
    sub_type: 'relay',
    device: '00001770',
    channel: 0,
    unused: false,
  },
  {
    id: 9,
    name: 'Chauffage',
    type: 'hvac',
    sub_type: '',
    device: '00001881',
    channel: 0,
    unused: false,
  },
  {
    id: 10,
    name: 'Bandeau',
    type: 'dali',
    sub_type: 'tw',
    device: '00001992',
    channel: 0,
    unused: false,
  },
  {
    id: 11,
    name: 'Libre',
    type: 'onoff',
    sub_type: '',
    device: '00001aa3',
    channel: 0,
    unused: true,
  },
];

export const states = () => [
  { id: 1, state: { bri: 10000 } },
  { id: 2, state: { bri: 5000, flags: { over_current: 0, fading: 0 } } },
  { id: 3, state: { level: 8160, tilt: 3, moving: 'stop', flags: { learning: 0 } } },
  { id: 4, state: { level: 0, tilt: 0, moving: 'stop', flags: { learning: 0 } } },
  { id: 5, state: { level: 10000, moving: 'stop', flags: { learning: 1 } } },
  { id: 6, state: { bri: 0 } },
  { id: 7, state: { bri: 0 } },
  { id: 8, state: { moving: 'stop' } },
  { id: 9, state: { heating: true } },
  { id: 10, state: { bri: 2000, ct: 3000 } },
];

export const rooms = () => [
  { id: 1, name: 'Salon' },
  { id: 2, name: 'Chambre' },
];

export const scenes = () => [
  {
    job: 14,
    type: 0,
    name: 'Absent',
    kind: 1,
    id: 15,
    sceneButtons: [{ id: 13, title: 'Szenentaste 1', description: 'ID • 13' }],
  },
  // Its job is not in /api/jobs: not offered.
  { job: 99, type: 0, name: 'Orpheline', kind: 1, id: 16, sceneButtons: [] },
];

export const jobs = () => [{ id: 14, target_states: [{ load: 1, bri: 0 }], triggers: [15] }];

export const buttons = () => [
  { id: 53, device: '0000144b', channel: 0, type: 'button', sub_type: 'up down' },
  // Available but not registered: sends no events, not offered.
  { id: null, device: '0000133a', channel: 0, type: 'button', sub_type: 'toggle' },
];

/** Devices offered: 9 outputs (hvac and unused left out), 1 scene, 1 button. */
export const OFFERED = 11;
