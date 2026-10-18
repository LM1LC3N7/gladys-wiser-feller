// -----------------------------------------------------------------------------
// The integration: one Wiser µGateway, its outputs (loads), scenes and
// registered buttons turned into Gladys devices, the live socket feeding the
// states, and the commands sent back. index.js only wires the SDK to it.
//
// Lifecycle: start -> open (info, loads, rooms, scenes, jobs, buttons, states)
// -> the live socket (src/live.js) brings every change; the states are read
// again every 5 minutes (missed messages), the inventory every 30 minutes.
// Without the socket (off in the configuration, refused, lost) the states are
// read at the configured pace and the socket is tried again in the
// background. On a failure of the REST API, reconnect with a growing delay; a
// 429 pauses every path; a refused token stops everything until the user acts
// (new token, Test button), even across restarts: never tried again alone.
//
// Commands: one at a time per load, sent within 3.5 s of their arrival or
// refused. Impulse outputs only when the user allowed them, the option read
// again at the moment the request leaves. The ack of a command never waits
// for a publication to Gladys.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, parseGatewayAddress } from './config.js';
import { TIMINGS } from './constants.js';
import { T, word } from './i18n.js';
import { LiveError, openLive } from './live.js';
import {
  buildModel,
  buttonOf,
  emptyModel,
  jobOf,
  loadOf,
  pressState,
  roleOf,
  roomOf,
  sceneOf,
  stateOf,
  valuesOf,
} from './model.js';
import { StatePublisher } from './publisher.js';
import { StateStore } from './store.js';
import { WiserError, claimToken, createClient } from './wiser.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const sameConfig = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The fields of a created feature kept when a device is published again. */
const FEATURE_FIELDS = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
];

/** The two numbers the watchdog compares between a read and the live messages. */
const WATCHED = ['bri', 'level'];

export class WiserApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'wiser' }),
    connect = createClient,
    claim = claimToken,
    live = openLive,
    WebSocket = globalThis.WebSocket,
    now = Date.now,
    timers = globalThis,
    store,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.connect = connect;
    this.claim = claim;
    this.openLive = live;
    this.WebSocket = WebSocket;
    this.now = now;
    this.timers = timers;
    this.store = store ?? new StateStore({ now, logger });
    this.raw = {};
    this.config = normalizeConfig();
    this.client = null;
    this.info = undefined;
    this.inventory = { loads: [], scenes: [], jobs: undefined, buttons: [], rooms: new Map() };
    this.inventoryAt = -Infinity;
    this.model = emptyModel();
    /** load id -> last state (replaced, never mutated) */
    this.states = new Map();
    /** load id -> number of the last live message that changed it */
    this.stateSeq = new Map();
    this.seq = 0;
    /** when (ms) the last read of the states started */
    this.readStartedAt = -Infinity;
    this.online = false;
    /** the token was refused: nothing is tried until the user acts */
    this.blocked = undefined;
    /** the live socket, and its state: off | connecting | live | down */
    this.live = null;
    this.liveState = 'off';
    this.liveError = undefined;
    this.liveFailures = 0;
    this.liveOpening = undefined;
    this.liveSince = Infinity;
    /** when the current socket opened, and when it last said anything */
    this.liveOpenedAt = undefined;
    this.lastMessageAt = -Infinity;
    this.running = false;
    this.unsaved = false;
    this.timerAt = undefined;
    /** feature id -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    this.createdIds = new Set();
    /** Gladys device id -> device published in this run (a publication never shrinks) */
    this.known = new Map();
    this.publishedDevices = undefined;
    /** device id -> last badge published (JSON) */
    this.transports = new Map();
    /** command chains, per load (or scene) */
    this.chains = new Map();
    /** load ids whose command was sent without confirmation */
    this.unconfirmed = new Set();
    /** load id -> time of the last impulse sent */
    this.impulses = new Map();
    this.readBackTimers = new Set();
    this.timer = undefined;
    this.liveTimer = undefined;
    this.reading = false;
    this.claiming = false;
    this.failures = 0;
    this.lastError = undefined;
    this.generation = 0;
    this.lastStatus = undefined;
    this.warned = new Set();
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}, { unsaved = false } = {}) {
    this.stop();
    const generation = this.generation;
    const previousUrl = this.config.url;
    this.raw = { ...(raw ?? {}) };
    this.config = normalizeConfig(raw);
    this.unsaved = unsaved;
    if (previousUrl !== this.config.url) {
      // Another gateway (or none): nothing of the previous one stays published.
      this.known.clear();
      this.lastValues.clear();
      this.states.clear();
      this.stateSeq.clear();
      this.unconfirmed.clear();
      this.impulses.clear();
      this.model = emptyModel();
      this.inventory = { loads: [], scenes: [], jobs: undefined, buttons: [], rooms: new Map() };
      this.inventoryAt = -Infinity;
    }
    this.refreshCreated();
    this.blocked = undefined;
    // Gladys may have restarted meanwhile (it keeps them in memory only).
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    this.transports.clear();
    if (this.config.error) {
      await this.setStatus(false, T.configError(this.config.error));
      return;
    }
    this.publisher.configure({ intervalSeconds: 0, throttled: new Set() });
    this.running = true;
    this.publisher.start();
    const refusal = this.store.refusalOf(this.config.url, this.config.token);
    if (refusal) {
      // Refused before (maybe before a restart): never tried again alone.
      this.blocked = refusal;
      await this.setStatus(false, T.failure({ kind: 'auth', message: refusal.reason }));
      return;
    }
    const paused = this.store.pausedUntil - this.now();
    if (paused > 0) {
      // A 429 pause outlives a restart: wait for its end.
      await this.setStatus(false, T.failure({ kind: 'rate' }));
      this.schedule(generation, paused, () => this.open(generation));
      return;
    }
    await this.setStatus(false, T.connecting);
    await this.open(generation);
  }

  /**
   * Gladys (re)connected: the same configuration keeps everything (client,
   * 429 pause, refused token) and publishes again what Gladys keeps in
   * memory only (connection status, Discovery, badges); another one starts
   * again.
   */
  async resume(raw = {}) {
    if (this.unsaved) {
      // A claimed token Gladys could not save: keep using it from memory.
      raw = { ...(raw ?? {}), api_token: this.raw.api_token };
    }
    if (!this.running || !sameConfig(normalizeConfig(raw), this.config)) {
      await this.start(raw, { unsaved: this.unsaved });
      return;
    }
    this.raw = { ...(raw ?? {}) };
    this.refreshCreated();
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    this.transports.clear();
    await this.publishDevices();
    if (this.online) {
      await this.connectedStatus();
    } else if (this.blocked) {
      await this.setStatus(false, T.failure({ kind: 'auth', message: this.blocked.reason }));
    } else {
      await this.setStatus(false, this.lastError ? T.failure(this.lastError) : T.connecting);
    }
    await this.publishAllTransports();
  }

  /** The configuration changed: start again with it. */
  async configUpdated(raw = {}) {
    this.logger.info('Configuration updated: reconnecting to the µGateway');
    await this.start(raw);
  }

  stop() {
    this.generation += 1;
    this.running = false;
    for (const timer of [this.timer, this.liveTimer, ...this.readBackTimers]) {
      this.timers.clearTimeout(timer);
    }
    this.readBackTimers.clear();
    this.timer = undefined;
    this.liveTimer = undefined;
    this.publisher.stop();
    this.closeLive('off');
    this.client?.close?.();
    this.client = null;
    this.online = false;
    this.reading = false;
    this.failures = 0;
    this.liveFailures = 0;
  }

  current(generation) {
    return generation === this.generation;
  }

  paused() {
    return this.now() < this.store.pausedUntil;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async connectedStatus() {
    const { offered: loads, scenes, buttons } = this.model.counts;
    const message = T.connected(
      { loads, scenes, buttons },
      this.liveState,
      this.config.pollInterval,
    );
    if (this.unsaved) {
      // The new token could not be saved: in memory only, until a restart.
      message.en = `${message.en} ${T.claim.unsaved.en}`;
      message.fr = `${message.fr} ${T.claim.unsaved.fr}`;
    }
    await this.setStatus(true, message);
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  /** Runs `fn` after `ms` on the main timer, unless the app was restarted or stopped meanwhile. */
  schedule(generation, ms, fn) {
    this.timers.clearTimeout(this.timer);
    this.timerAt = this.now() + ms;
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.timerAt = undefined;
      if (this.current(generation)) {
        fn().catch((err) => this.logger.error(`Wiser loop: ${err.message}`));
      }
    }, ms);
  }

  /** A promise not awaited: its failure is logged. */
  background(promise) {
    promise?.catch?.((err) => this.logger.warn(err.message));
  }

  // --- Connection ----------------------------------------------------------------

  async open(generation) {
    try {
      this.client?.close?.();
      const { url, token } = this.config;
      this.client = this.connect({ url, token });
      await this.loadInventory(generation);
      if (!this.current(generation)) {
        return;
      }
      await this.readStates(generation);
      if (!this.current(generation)) {
        return;
      }
      this.online = true;
      this.failures = 0;
      this.lastError = undefined;
      this.logger.info(
        `Connected to the µGateway at ${url}: ${this.model.counts.offered} outputs, ${this.model.counts.scenes} scenes, ${this.model.counts.buttons} buttons`,
      );
      this.liveState = this.config.live ? 'connecting' : 'off';
      await this.connectedStatus();
      await this.publishAllTransports();
      this.scheduleRead(generation);
      if (this.config.live) {
        this.startLive(generation);
      }
    } catch (err) {
      await this.fail(generation, err);
    }
  }

  /** The delay before the next try after `err` (never called for a refused token). */
  retryDelay(err) {
    if (err?.kind === 'rate') {
      return clamp(
        err.retryAfter ?? TIMINGS.rateLimitMin,
        TIMINGS.rateLimitMin,
        TIMINGS.rateLimitMax,
      );
    }
    // Growing delay, never faster than the read interval the user chose.
    const backoff = Math.min(
      TIMINGS.retryMax,
      TIMINGS.retryMin * 2 ** Math.max(0, this.failures - 1),
    );
    return Math.max(backoff, this.config.pollInterval * 1000);
  }

  async fail(generation, err) {
    if (!this.current(generation)) {
      return;
    }
    this.online = false;
    this.reading = false;
    this.closeLive('off');
    this.timers.clearTimeout(this.liveTimer);
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    this.timerAt = undefined;
    this.lastError = err;
    if (err?.kind === 'auth') {
      // A refused token is never tried again by the integration: the user gets
      // a new one ("Get the token") or checks it (Test). Kept across restarts.
      this.store.refuse(this.config.url, this.config.token, err.message);
      this.blocked = this.store.refusalOf(this.config.url, this.config.token);
      this.logger.warn(`µGateway: token refused (${err.message}); waiting for the user`);
      await this.setStatus(false, T.failure(err));
      await this.publishAllTransports();
      return;
    }
    this.failures += 1;
    const delay = this.retryDelay(err);
    if (err?.kind === 'rate') {
      this.store.pauseUntil(this.now() + delay);
    }
    if (err instanceof WiserError) {
      this.logger.warn(`µGateway: ${err.message} (retrying in ${Math.round(delay / 1000)} s)`);
    } else {
      this.logger.error('µGateway: unexpected failure', err);
    }
    await this.setStatus(false, T.failure(err));
    await this.publishAllTransports();
    this.schedule(generation, delay, () => this.open(generation));
  }

  /**
   * An error on a side path (command, read back, scan): a 429 pauses
   * everything, a refused token blocks everything.
   */
  sideError(generation, err) {
    if (err?.kind === 'rate') {
      this.store.pauseUntil(this.now() + this.retryDelay(err));
      if (this.online) {
        this.background(this.fail(generation, err));
      }
    } else if (err?.kind === 'auth') {
      this.background(this.fail(generation, err));
    }
  }

  // --- Reading -------------------------------------------------------------------

  readInterval() {
    return this.liveState === 'live' ? TIMINGS.resync : this.config.pollInterval * 1000;
  }

  scheduleRead(generation, ms = this.readInterval()) {
    this.schedule(generation, ms, () => this.read(generation));
  }

  async read(generation) {
    this.reading = true;
    try {
      if (this.now() - this.inventoryAt >= TIMINGS.inventory) {
        await this.loadInventory(generation);
      }
      await this.readStates(generation);
    } catch (err) {
      // Any failure (a 429 included: its pause then covers every path) reconnects.
      await this.fail(generation, err);
      return;
    } finally {
      if (this.current(generation)) {
        this.reading = false;
      }
    }
    if (this.current(generation) && this.online) {
      // The socket said nothing at all for 10 minutes: open it again (a gateway
      // that drops it silently; a quiet house only costs a reopening).
      const heard = Math.max(this.lastMessageAt, this.liveOpenedAt ?? -Infinity);
      if (this.liveState === 'live' && this.now() - heard >= TIMINGS.liveSilence) {
        this.liveLost(generation, 'no message for 10 minutes', { quiet: true });
      }
      await this.connectedStatus();
      this.scheduleRead(generation);
    }
  }

  /**
   * Loads (needed), then rooms, scenes, jobs and buttons: each of these may
   * fail (an older firmware, a 404) without stopping the outputs; the last
   * list read is kept. A refused token or a 429 on any of them stops as usual.
   */
  async loadInventory(generation, { force = false } = {}) {
    const client = this.client;
    const info = await client.info();
    if (!this.current(generation)) {
      return;
    }
    this.info = {
      serial: typeof info?.sn === 'string' && /^[\w-]{1,40}$/.test(info.sn) ? info.sn : 'gateway',
      product: typeof info?.product === 'string' ? info.product.slice(0, 40) : '',
      sw: typeof info?.sw === 'string' ? info.sw.slice(0, 20) : '',
      api: typeof info?.api === 'string' ? info.api.slice(0, 20) : '',
    };
    const loads = await client.loads();
    if (!Array.isArray(loads)) {
      throw new WiserError('format', 'the list of loads is not a list');
    }
    const secondary = async (name, read, map) => {
      try {
        const answer = await read();
        if (!Array.isArray(answer)) {
          throw new WiserError('format', `the list of ${name} is not a list`);
        }
        return map(answer);
      } catch (err) {
        if (err?.kind === 'auth' || err?.kind === 'rate') {
          throw err;
        }
        this.warnOnce(`inventory:${name}`, `µGateway: ${name} not read (${err.message})`);
        return undefined;
      }
    };
    const rooms = await secondary(
      'rooms',
      () => client.rooms(),
      (list) => new Map(list.map(roomOf).filter(Boolean)),
    );
    const scenes = await secondary(
      'scenes',
      () => client.scenes(),
      (list) => list.map(sceneOf).filter(Boolean),
    );
    const jobs = await secondary(
      'jobs',
      () => client.jobs(),
      (list) => new Map(list.map(jobOf).filter(Boolean)),
    );
    const buttons = await secondary(
      'buttons',
      () => client.buttons(),
      (list) => list.map(buttonOf).filter(Boolean),
    );
    if (!this.current(generation)) {
      return;
    }
    const before = this.inventory;
    this.inventory = {
      loads: loads.map(loadOf).filter(Boolean),
      rooms: rooms ?? before.rooms,
      scenes: scenes ?? before.scenes,
      // Jobs unknown: the scenes are offered all (their job is checked when run).
      jobs: jobs ?? before.jobs,
      buttons: buttons ?? before.buttons,
    };
    this.inventoryAt = this.now();
    await this.rebuild({ force });
  }

  /** Reads every state; a load a live message changed since the read began keeps that. */
  async readStates(generation) {
    const since = this.seq;
    const startedAt = this.now();
    // Compared only with a baseline read after the socket opened.
    const watch = this.liveState === 'live' && this.readStartedAt >= this.liveSince;
    const answer = await this.client.loadsState();
    if (!this.current(generation)) {
      return;
    }
    if (!Array.isArray(answer)) {
      throw new WiserError('format', 'the list of states is not a list');
    }
    let missed;
    for (const entry of answer) {
      const id = entry?.id;
      const state = stateOf(entry?.state);
      if (!Number.isSafeInteger(id) || !state || !this.model.readers.has(id)) {
        continue;
      }
      if ((this.stateSeq.get(id) ?? 0) > since) {
        continue;
      }
      const known = this.states.get(id);
      if (watch && known && !missed && WATCHED.some((k) => known[k] !== state[k])) {
        missed = id;
      }
      this.states.set(id, state);
      if (!this.chains.has(id)) {
        this.unconfirmed.delete(id);
      }
      this.applyState(id);
    }
    this.readStartedAt = startedAt;
    if (missed !== undefined) {
      this.liveLost(generation, `a change of load ${missed} came with no live message`);
    }
  }

  /** The model from the inventory; published (merged, never shrinking) when it changed. */
  async rebuild({ force = false } = {}) {
    this.model = buildModel(
      (type, id) => this.gladys.externalIds(type, id),
      { ...this.inventory, serial: this.info?.serial ?? 'gateway' },
      { language: this.config.language, publishTilt: this.config.publishTilt },
    );
    for (const [deviceId] of this.transports) {
      if (!this.known.has(deviceId) && !this.model.deviceLoads.has(deviceId)) {
        this.transports.delete(deviceId);
      }
    }
    await this.publishDevices({ force });
  }

  /**
   * The devices of the model, merged so that nothing ever disappears: a
   * created device keeps its features as Gladys has them (types are fixed at
   * creation), plus any new one; a device seen earlier in this run stays.
   */
  async publishDevices({ force = false } = {}) {
    const created = new Map((this.gladys.devices ?? []).map((d) => [d.external_id, d]));
    for (const fresh of this.model.devices) {
      const previous = this.known.get(fresh.external_id);
      const mine = created.get(fresh.external_id);
      const features = new Map();
      for (const f of mine?.features ?? []) {
        features.set(
          f.external_id,
          Object.fromEntries(
            FEATURE_FIELDS.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
          ),
        );
      }
      for (const f of [...(previous?.features ?? []), ...fresh.features]) {
        if (!features.has(f.external_id)) {
          features.set(f.external_id, f);
        }
      }
      this.known.set(fresh.external_id, { ...fresh, features: [...features.values()] });
    }
    const list = [...this.known.values()];
    const json = JSON.stringify(list);
    if (!force && json === this.publishedDevices) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(list);
      this.publishedDevices = json;
    } catch (err) {
      this.logger.error(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** The values of one load to its features, and its badge. */
  applyState(loadId) {
    const state = this.states.get(loadId);
    if (state) {
      for (const { featureId, state: value } of valuesOf(this.model, loadId, state)) {
        this.record(featureId, { state: value });
      }
    }
    this.publishTransportOf(loadId);
  }

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, value) {
    this.lastValues.set(featureId, value);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  // --- Live messages -----------------------------------------------------------------

  startLive(generation) {
    const ready = this.current(generation) && this.online && this.client && this.config.live;
    if (!ready || this.live || this.liveOpening === generation) {
      return;
    }
    this.liveOpening = generation;
    if (this.liveState !== 'down' && this.liveState !== 'live') {
      this.liveState = 'connecting';
    }
    this.openLive({
      url: this.config.url,
      token: this.config.token,
      WebSocket: this.WebSocket,
      timers: this.timers,
      onMessage: (message) => {
        if (!this.current(generation)) {
          return;
        }
        // Any message, even one dropped, proves the socket alive (watchdog).
        this.lastMessageAt = this.now();
        if (message) {
          this.onLiveMessage(message);
        }
      },
      onClose: (reason) => {
        if (this.current(generation)) {
          this.live = null;
          this.liveFailed(generation, new LiveError('closed', reason)).catch(() => {});
        }
      },
    })
      .finally(() => {
        if (this.liveOpening === generation) {
          this.liveOpening = undefined;
        }
      })
      .then(async (session) => {
        if (!this.current(generation) || !this.online) {
          session.close();
          return;
        }
        this.live = session;
        this.liveState = 'live';
        this.liveSince = this.now();
        this.liveOpenedAt = this.now();
        if (this.liveFailures > 0) {
          this.logger.info(`Live updates on again after ${this.liveFailures} failure(s)`);
        } else {
          this.logger.info('Live updates on (µGateway WebSocket)');
        }
        // The failures are forgotten only once the socket stayed open 60 s
        // (liveFailed): a gateway that accepts then cuts at once keeps its
        // growing delay.
        this.liveError = undefined;
        await this.connectedStatus();
        await this.publishAllTransports();
        // The changes between the last read and the socket: read now, unless
        // the last read is more recent than the read interval.
        const interval = this.config.pollInterval * 1000;
        if (!this.reading && this.now() - this.readStartedAt >= interval) {
          this.scheduleRead(generation, 0);
        } else if (!this.reading) {
          this.scheduleRead(generation, Math.max(0, this.readStartedAt + interval - this.now()));
        }
      })
      .catch((err) => this.liveFailed(generation, err));
  }

  /** The watchdog: the socket seems deaf, open it again at once (still 'live'). */
  liveLost(generation, reason, { quiet = false } = {}) {
    const text = `µGateway live updates: ${reason}, opening the socket again`;
    if (quiet) {
      this.logger.info(text);
    } else {
      this.logger.warn(text);
    }
    const session = this.live;
    this.live = null;
    session?.close();
    this.liveSince = Infinity;
    this.startLive(generation);
  }

  async liveFailed(generation, err) {
    if (!this.current(generation) || !this.online) {
      return;
    }
    const wasDown = this.liveState === 'down';
    if (this.liveOpenedAt !== undefined && this.now() - this.liveOpenedAt >= TIMINGS.liveStable) {
      // It stayed open long enough: a new loss starts from the shortest delay.
      this.liveFailures = 0;
    }
    this.liveOpenedAt = undefined;
    this.liveState = 'down';
    this.liveSince = Infinity;
    this.liveError = err;
    this.liveFailures += 1;
    const delay = Math.min(
      TIMINGS.liveRetryMax,
      TIMINGS.liveRetryMin * 2 ** (this.liveFailures - 1),
    );
    const n = this.liveFailures;
    if (n <= TIMINGS.liveWarnFirst || n % TIMINGS.liveWarnEvery === 0) {
      this.logger.warn(
        `µGateway live updates: ${err?.message ?? err} (failure ${n}; reading every ${this.config.pollInterval} s, socket again in ${Math.round(delay / 1000)} s)`,
      );
    }
    this.timers.clearTimeout(this.liveTimer);
    this.liveTimer = this.timers.setTimeout(() => {
      this.liveTimer = undefined;
      this.startLive(generation);
    }, delay);
    // Reads at the interval, never sooner than the next one already planned.
    const interval = this.config.pollInterval * 1000;
    const planned = this.timerAt;
    if (!wasDown && !this.reading && (planned === undefined || planned > this.now() + interval)) {
      this.scheduleRead(generation, interval);
    }
    await this.connectedStatus();
    await this.publishAllTransports();
  }

  closeLive(state) {
    const session = this.live;
    this.live = null;
    session?.close();
    this.liveState = state;
    this.liveSince = Infinity;
    this.liveOpenedAt = undefined;
  }

  /** One message of the socket: a state change of a load, or a button press. */
  onLiveMessage(message) {
    if (message.type === 'button') {
      this.press(message.id, message.event, message.button);
      return;
    }
    if (!this.model.readers.has(message.id)) {
      return;
    }
    this.seq += 1;
    this.stateSeq.set(message.id, this.seq);
    // Only the changes are sent: merged into the last state known.
    this.states.set(message.id, { ...this.states.get(message.id), ...message.state });
    this.unconfirmed.delete(message.id);
    this.applyState(message.id);
  }

  /** A press of a registered button: one state per press, sent even when equal to the last. */
  press(id, event, button) {
    const entry = this.model.buttons.get(id);
    const state = pressState(event, button);
    if (!entry || state === undefined) {
      return;
    }
    if (this.created.has(entry.featureId)) {
      this.publisher.pushEvent(entry.featureId, { state });
    }
  }

  // --- Transport badges ----------------------------------------------------------

  transportOf(deviceId) {
    if (!this.online) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    const loadId = this.model.deviceLoads.get(deviceId);
    if (loadId !== undefined && this.unconfirmed.has(loadId)) {
      return { transport: DEVICE_TRANSPORTS.LOCAL, degraded: true, message: T.badge.unconfirmed };
    }
    if (this.liveState === 'down') {
      return {
        transport: DEVICE_TRANSPORTS.LOCAL,
        degraded: true,
        message: T.badge.noLive(this.config.pollInterval),
      };
    }
    return { transport: DEVICE_TRANSPORTS.LOCAL };
  }

  publishTransportOf(loadId) {
    for (const deviceId of this.model.loadDevices.get(loadId) ?? []) {
      this.background(this.publishTransport(deviceId));
    }
  }

  async publishTransport(deviceId) {
    if (!this.createdDevices().has(deviceId)) {
      return;
    }
    const badge = this.transportOf(deviceId);
    const key = JSON.stringify(badge);
    if (this.transports.get(deviceId) === key) {
      return;
    }
    this.transports.set(deviceId, key);
    await this.gladys.publishTransports([{ external_id: deviceId, ...badge }]);
  }

  async publishAllTransports() {
    const entries = [];
    for (const deviceId of this.createdDevices()) {
      if (!this.known.has(deviceId)) {
        continue;
      }
      const badge = this.transportOf(deviceId);
      const key = JSON.stringify(badge);
      if (this.transports.get(deviceId) !== key) {
        this.transports.set(deviceId, key);
        entries.push({ external_id: deviceId, ...badge });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Devices created by the user -------------------------------------------------

  /** The ids of the devices created in Gladys (cached, refreshed on their events). */
  createdDevices() {
    return this.createdIds;
  }

  refreshCreated() {
    const devices = this.gladys.devices ?? [];
    this.createdIds = new Set(devices.map((d) => d.external_id));
    this.created = new Set(devices.flatMap((d) => (d.features ?? []).map((f) => f.external_id)));
  }

  async deviceCreated(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.createdIds.add(device.external_id);
    }
    for (const f of device?.features ?? []) {
      this.created.add(f.external_id);
    }
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value) {
        this.publisher.push(f.external_id, value);
      }
    }
    if (device?.external_id) {
      await this.publishTransport(device.external_id).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.createdIds.delete(device.external_id);
      for (const f of device.features ?? []) {
        this.created.delete(f.external_id);
      }
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  /** The Scan button of the Discovery tab (never during a 429 pause nor with a refused token). */
  async rescan() {
    if (!this.online || !this.client || this.paused() || this.blocked) {
      this.publishedDevices = undefined;
      await this.publishDevices({ force: true });
      return;
    }
    const generation = this.generation;
    try {
      await this.loadInventory(generation, { force: true });
      await this.readStates(generation);
    } catch (err) {
      this.sideError(generation, err);
      throw err;
    }
  }

  // --- Commands ------------------------------------------------------------------

  denied(key, ...args) {
    const text = T.denied[key];
    const err = new Error(
      word(typeof text === 'function' ? text(...args) : text, this.config.language),
    );
    err.refusal = key;
    return err;
  }

  /** Runs `task` after the previous task of the same key (a promise chain per key). */
  serialized(key, task) {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const tail = run.catch(() => {});
    this.chains.set(key, tail);
    tail.then(() => {
      if (this.chains.get(key) === tail) {
        this.chains.delete(key);
      }
    });
    return run;
  }

  /** Refuses an impulse while its option is off (checked again when the request leaves). */
  checkAllowed(writer) {
    if (writer.safety === 'impulse' && !this.config.allowImpulse) {
      throw this.denied('impulseOff');
    }
  }

  checkReady() {
    if (this.blocked) {
      throw this.denied('blocked');
    }
    if (this.paused()) {
      throw this.denied('paused');
    }
    if (!this.client || !this.online) {
      throw this.denied('notConnected');
    }
  }

  /** The timeout and the guard of a command request, from what is left before `deadline`. */
  commandOptions(deadline, writer) {
    const check = () => {
      if (this.now() > deadline) {
        throw this.denied('tooLate');
      }
      // The option is read once more at the moment the request leaves.
      this.checkAllowed(writer);
    };
    const timeout = () =>
      clamp(
        deadline + TIMINGS.commandSlack - this.now(),
        TIMINGS.commandTimeoutMin,
        TIMINGS.setValueDeadline + TIMINGS.commandSlack,
      );
    return { check, send: { timeout, guard: check } };
  }

  /** Gladys command (acked within 5 s): sent within 3.5 s of its arrival, or refused. */
  async setValue(_device, feature, value) {
    const deadline = this.now() + TIMINGS.setValueDeadline;
    const generation = this.generation;
    const featureId = feature?.external_id;
    try {
      const writer = featureId === undefined ? undefined : this.model.writers.get(featureId);
      if (!writer) {
        throw this.denied('notCommand');
      }
      this.checkAllowed(writer);
      this.checkReady();
      const key = writer.loadId ?? `scene:${writer.sceneId}`;
      await this.serialized(key, async () => {
        // The options, the token and the connection may have changed while the command waited.
        this.checkAllowed(writer);
        this.checkReady();
        if (!this.current(generation)) {
          throw this.denied('notConnected');
        }
        const client = this.client;
        const options = this.commandOptions(deadline, writer);
        options.check();
        let call;
        try {
          call = writer.write(value);
        } catch (err) {
          throw err?.refusal ? this.denied('badValue') : err;
        }
        if (writer.safety === 'impulse') {
          const last = this.impulses.get(key);
          if (last !== undefined && this.now() - last < TIMINGS.impulseSpacing) {
            throw this.denied('impulseBusy');
          }
        }
        await this.send(client, writer, call, options, generation, key);
      });
    } catch (err) {
      // Gladys shows the value asked for: send the known one again.
      this.gladys.forgetPublishedStates?.(featureId);
      const known = this.lastValues.get(featureId);
      if (known && this.created.has(featureId)) {
        this.publisher.push(featureId, known);
      }
      throw err;
    }
  }

  /**
   * One request of a command, and what to tell of a failure:
   *   - refused at the socket, connection refused, no route, timed out before
   *     connecting: "not sent";
   *   - a 4xx or an envelope `status: error`: "refused", with the reason;
   *   - anything after it left (5xx, an answer not understood or too large,
   *     a reset, a timeout once sent): "sent, without confirmation", the load
   *     read back and its badge degraded.
   * Never awaits a publication to Gladys.
   */
  async send(client, writer, call, options, generation, key) {
    const loadId = writer.loadId;
    if (writer.safety === 'impulse') {
      // Set before the request: a second impulse is refused even if this one fails.
      this.impulses.set(key, this.now());
    }
    try {
      if (call.job !== undefined) {
        await client.triggerJob(call.job, options.send);
      } else if (call.ctrl) {
        await client.ctrl(loadId, call.ctrl[0], call.ctrl[1], options.send);
      } else {
        await client.setTargetState(loadId, call.target, options.send);
      }
    } catch (err) {
      if (err?.refusal || err?.sent === false) {
        // Refused at the socket (too late, option turned off), or the
        // connection never opened: it never left.
        if (writer.safety === 'impulse') {
          this.impulses.delete(key);
        }
        if (err?.refusal) {
          throw err;
        }
        throw this.denied('notSent', err.message);
      }
      this.sideError(generation, err);
      if (err?.kind === 'auth') {
        throw this.denied('blocked');
      }
      if (err?.kind === 'rate') {
        throw this.denied('paused');
      }
      const answered = err instanceof WiserError && err.status !== undefined;
      if (answered && (err.kind === 'api' || err.kind === 'notfound') && err.status < 500) {
        // The µGateway answered and refused it (a 4xx, or status: error).
        throw this.denied('refused', err.message);
      }
      // 5xx, format, size, reset, timeout once sent: it may have been done.
      if (loadId !== undefined) {
        this.unconfirmed.add(loadId);
        this.publishTransportOf(loadId);
        this.readBack(loadId, TIMINGS.commandEcho);
        throw this.denied('unconfirmed');
      }
      throw this.denied('unconfirmedScene');
    }
    if (loadId !== undefined && this.liveState !== 'live') {
      const delays = this.model.motors.has(loadId) ? TIMINGS.motorEchoes : [TIMINGS.commandEcho];
      for (const delay of delays) {
        this.readBack(loadId, delay);
      }
    }
    this.logger.debug(`Wiser command sent for ${writer.role} ${loadId ?? writer.sceneId}`);
  }

  /** Reads one load back later (no live socket, or a command not confirmed). */
  readBack(loadId, delay) {
    const generation = this.generation;
    const timer = this.timers.setTimeout(async () => {
      this.readBackTimers.delete(timer);
      if (!this.current(generation) || !this.online || !this.client || this.paused()) {
        return;
      }
      const since = this.seq;
      try {
        const answer = await this.client.loadState(loadId);
        const state = stateOf(answer?.state);
        if (
          state &&
          answer?.id === loadId &&
          this.current(generation) &&
          (this.stateSeq.get(loadId) ?? 0) <= since
        ) {
          this.states.set(loadId, state);
          this.unconfirmed.delete(loadId);
          this.applyState(loadId);
        }
      } catch (err) {
        this.sideError(generation, err);
        this.logger.warn(`Read back of load ${loadId} failed: ${err.message}`);
      }
    }, delay);
    this.readBackTimers.add(timer);
  }

  // --- Configuration screen buttons ---------------------------------------------------

  /**
   * "Get the token": ONE claim request per click (the µGateway blinks for 30 s
   * and answers once one of its buttons is pressed), never repeated. The
   * token goes only to the address of the configuration, is saved in the
   * secret field and never logged.
   */
  async claimToken() {
    const target = parseGatewayAddress(this.raw.gateway_address);
    if (target.error) {
      return T.configError(target.error);
    }
    if (this.claiming) {
      return T.claim.busy;
    }
    this.claiming = true;
    let token;
    try {
      this.logger.info('Asking the µGateway for a token: press one of its buttons within 30 s');
      token = await this.claim({ url: target.url, source: this.config.importUser });
    } catch (err) {
      if (err?.kind === 'nobutton' || err?.kind === 'timeout') {
        return T.claim.noButton;
      }
      if (!(err instanceof WiserError)) {
        this.logger.error('Token request failed', err);
      }
      return T.claim.failed(err);
    } finally {
      this.claiming = false;
    }
    this.store.clearRefusal();
    try {
      await this.gladys.setConfig({ api_token: token });
    } catch (err) {
      // The old token is already invalidated by the claim: use the new one
      // from memory, and say it in the status until it is saved.
      this.logger.warn(`Saving the token failed: ${err.message}; using it from memory`);
      this.background(this.start({ ...this.raw, api_token: token }, { unsaved: true }));
      return T.claim.saveFailed;
    }
    this.logger.info('Token received from the µGateway and saved');
    this.background(this.start({ ...this.raw, api_token: token }));
    return T.claim.ok;
  }

  /**
   * "Test the connection": reads the µGateway with the saved configuration.
   * A click of the user may try a refused token again; when it is accepted,
   * the integration starts again with it.
   */
  async testConnection() {
    const config = this.config;
    if (config.error) {
      return T.configError(config.error);
    }
    if (this.paused()) {
      return T.failure({ kind: 'rate' });
    }
    const client = this.connect({ url: config.url, token: config.token });
    try {
      const info = await client.info({ timeout: TIMINGS.testTimeout });
      // The account proves the token (the info answers without one).
      await client.account({ timeout: TIMINGS.testTimeout });
      const loads = await client.loads({ timeout: TIMINGS.testTimeout });
      if (!Array.isArray(loads)) {
        throw new WiserError('format', 'the list of loads is not a list');
      }
      const optional = async (read) => {
        try {
          const list = await read();
          return Array.isArray(list) ? list : [];
        } catch (err) {
          if (err?.kind === 'rate') {
            throw err;
          }
          return [];
        }
      };
      const scenes = await optional(() => client.scenes({ timeout: TIMINGS.testTimeout }));
      const buttons = await optional(() => client.buttons({ timeout: TIMINGS.testTimeout }));
      let live;
      if (config.live) {
        try {
          const session = await this.openLive({
            url: config.url,
            token: config.token,
            WebSocket: this.WebSocket,
            timers: this.timers,
          });
          session.close();
          live = { ok: true };
        } catch (err) {
          live = { ok: false, error: err };
        }
      }
      if (this.blocked) {
        this.logger.info('The token is accepted again (Test button): starting again');
        this.store.clearRefusal();
        this.background(this.start(this.raw));
      }
      return T.test.ok({
        product: typeof info?.product === 'string' ? info.product.slice(0, 40) : '',
        sw: typeof info?.sw === 'string' ? info.sw.slice(0, 20) : '',
        api: typeof info?.api === 'string' ? info.api.slice(0, 20) : '',
        loads: loads.map(loadOf).filter((load) => load && roleOf(load)).length,
        scenes: scenes.map(sceneOf).filter(Boolean).length,
        buttons: buttons.map(buttonOf).filter(Boolean).length,
        live,
      });
    } catch (err) {
      if (err?.kind === 'rate') {
        this.store.pauseUntil(this.now() + this.retryDelay(err));
      }
      if (!(err instanceof WiserError)) {
        this.logger.error('Connection test failed', err);
      }
      return T.failure(err);
    } finally {
      client.close?.();
    }
  }
}
