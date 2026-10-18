// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration) and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  CLAIM: 'claim_token',
  TEST: 'test_connection',
};

/** Languages of the feature names (manifest `language` options). */
export const LANGUAGES = ['fr', 'en'];

/**
 * The Wiser user whose data (load names, rooms, scenes) the token of
 * Gladys copies when it is claimed (manifest `import_user` options). The
 * Wiser Home app uses `admin`, the eSetup app `installer`.
 */
export const IMPORT_USERS = ['admin', 'installer', 'enduser'];

/** The Wiser user name Gladys claims (claiming it again replaces its token). */
export const CLAIM_USER = 'gladys';

/** Bounds of the number fields (seconds), mirrored by the manifest. */
export const POLL_INTERVAL = { min: 10, max: 3600, default: 30 };

/**
 * The REST API of the µGateway (Feller's documentation, wiser-api and
 * wiser-tutorial; the paths are those of aiowiserbyfeller). Every path is
 * under http://<gateway>/api/ and carries `Authorization: Bearer <token>`.
 */
export const API = {
  info: '/api/info',
  claim: '/api/account/claim',
  account: '/api/account',
  loads: '/api/loads',
  loadsState: '/api/loads/state',
  loadState: (id) => `/api/loads/${encodeURIComponent(id)}/state`,
  targetState: (id) => `/api/loads/${encodeURIComponent(id)}/target_state`,
  ctrl: (id) => `/api/loads/${encodeURIComponent(id)}/ctrl`,
  scenes: '/api/scenes',
  jobs: '/api/jobs',
  triggerJob: (id) => `/api/jobs/${encodeURIComponent(id)}/trigger`,
  buttons: '/api/buttons',
  rooms: '/api/rooms',
};

/** The live state changes: a WebSocket on ws://<gateway>/api (same token). */
export const LIVE_PATH = '/api';

/** Load types and kinds of the API (aiowiserbyfeller const.py). */
export const LOAD = {
  ONOFF: 'onoff',
  DIM: 'dim',
  DALI: 'dali',
  MOTOR: 'motor',
  /** onoff sub-type: impulse or delayed off (staircase timer), told apart only by the device config. */
  DTO: 'dto',
  /** motor sub-type: a plain relay, no position. */
  RELAY: 'relay',
  KIND_LIGHT: 0,
  KIND_SWITCH: 1,
  KIND_MOTOR: 0,
  KIND_VENETIAN: 1,
  KIND_ROLLER: 2,
  KIND_AWNING: 3,
};

/** Scales of the API. */
export const SCALE = {
  /** bri and level: 0..10000 */
  full: 10000,
  /** tilt of venetian blinds: 0..9 */
  tilt: 9,
};

/** Wiser button types and events (aiowiserbyfeller const.py). */
export const BUTTON_TYPES = ['on', 'off', 'up', 'down', 'toggle', 'stop', 'scene'];
export const BUTTON_EVENTS = ['click', 'press', 'release'];

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Size of an answer read (bytes): a big installation lists a few hundred loads. */
  responseBytes: 4 * 1024 * 1024,
  /** Size of one live message (bytes): a few dozen in practice. */
  eventBytes: 64 * 1024,
  /** Devices published at once (a µGateway handles 100 devices, a few loads each). */
  devices: 1000,
  /** Characters of a transport badge message (SDK limit). */
  badgeMessage: 200,
  /** Characters of a name from the gateway kept in Gladys. */
  name: 80,
  /** States kept out of the budget of the button presses each second (pending states first). */
  statesReserve: 50,
  /** Presses always given this many slots when the budget allows (a flood of states). */
  eventsReserve: 10,
};

/** The shape of a token of the gateway (a UUID in practice): no space, no control character. */
export const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{8,256}$/;

export const TIMINGS = {
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** One request. */
  requestTimeout: 10_000,
  /** One request of the connection test (the button waits 60 s). */
  testTimeout: 15_000,
  /**
   * The claim: the gateway answers once one of its buttons is pressed, within
   * 30 s. The request waits a bit more; the action button waits 90 s.
   */
  claimTimeout: 45_000,
  /** Opening the live socket. */
  liveTimeout: 10_000,
  /** With the live socket, the states are read again this often (missed messages). */
  resync: 5 * 60_000,
  /** The loads, scenes and buttons are read again this often (renamed, added). */
  inventory: 30 * 60_000,
  /** A socket open this long counts as stable: its failures are forgotten. */
  liveStable: 60_000,
  /** No message at all on the socket this long: it is opened again (watchdog). */
  liveSilence: 10 * 60_000,
  /** The live socket is opened again after a loss: this delay, doubled up to the max. */
  liveRetryMin: 5000,
  liveRetryMax: 2 * 60_000,
  /** A refused socket is logged for its first failures, then once in this many. */
  liveWarnFirst: 3,
  liveWarnEvery: 10,
  /** Reconnection delays after a failure (doubled each time, up to the max). */
  retryMin: 5000,
  retryMax: 60_000,
  /** Bounds of the pause after a 429 (Retry-After, or the minimum without it). */
  rateLimitMin: 60_000,
  rateLimitMax: 6 * 60 * 60_000,
  /**
   * Gladys acks a set_value within 5 s: a command not sent within 3.5 s of
   * its arrival is refused, never sent late.
   */
  setValueDeadline: 3500,
  /** The command request may run this long past the deadline (the ack still fits in 5 s). */
  commandSlack: 1000,
  /** Shortest timeout of a request of a command. */
  commandTimeoutMin: 300,
  /** Without the live socket, a load is read back this soon after a command. */
  commandEcho: 1500,
  /** A motor is read back at these delays after a command without the live socket. */
  motorEchoes: [1500, 10_000, 30_000, 70_000],
  /** Two impulses of a same output are at least this far apart (a double tap). */
  impulseSpacing: 3000,
};
