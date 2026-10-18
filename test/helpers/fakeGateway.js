// -----------------------------------------------------------------------------
// An in-memory µGateway for the app tests: a client with the methods of
// src/wiser.js, and a live socket whose messages go through the real parser
// of src/live.js. Every call is recorded; failures and gates can be injected.
// -----------------------------------------------------------------------------

import { LiveError, messageOf } from '../../src/live.js';
import { WiserError } from '../../src/wiser.js';
import * as F from './fixtures.js';

export const GATEWAY_URL = 'http://192.168.1.20';
export const CONFIG = { gateway_address: '192.168.1.20', api_token: F.TOKEN };

/** Lets the pending promises and their continuations run. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

export function fakeGateway() {
  const gw = {
    info: F.info(),
    loads: F.loads(),
    rooms: F.rooms(),
    scenes: F.scenes(),
    jobs: F.jobs(),
    buttons: F.buttons(),
    states: new Map(F.states().map((s) => [s.id, s.state])),
    /** the tokens the gateway accepts */
    tokens: new Set([F.TOKEN]),
    calls: [],
    clients: [],
    /** method -> WiserError (or a function returning one) thrown by the next calls */
    failures: new Map(),
    /** method -> promise awaited before the call (to hold it) */
    gates: new Map(),
    sessions: [],
    liveFailure: undefined,
    liveOpens: 0,
    /** whether a command echoes on the live socket, like the real gateway */
    echo: true,
  };

  const live = () => gw.sessions.filter((s) => !s.closed);

  const emit = (json) => {
    const message = messageOf(json);
    for (const session of live()) {
      session.onMessage(message);
    }
  };

  gw.connect = ({ url, token }) => {
    const client = { url, token, closed: false };
    const call = async (name, args, options) => {
      const gate = gw.gates.get(name);
      if (gate) {
        await gate;
      }
      // The moment the request leaves its socket.
      options?.guard?.();
      gw.calls.push({ name, args, token: client.token });
      const failure = gw.failures.get(name);
      if (failure) {
        throw typeof failure === 'function' ? failure() : failure;
      }
      if (name !== 'info' && !gw.tokens.has(client.token)) {
        throw new WiserError('auth', 'api is locked', { status: 200 });
      }
    };
    Object.assign(client, {
      async info(options) {
        await call('info', [], options);
        return gw.info;
      },
      async account(options) {
        await call('account', [], options);
        return { user: 'gladys', source: 'admin' };
      },
      async loads(options) {
        await call('loads', [], options);
        return gw.loads;
      },
      async loadsState(options) {
        await call('loadsState', [], options);
        return [...gw.states].map(([id, state]) => ({ id, state }));
      },
      async loadState(id, options) {
        await call('loadState', [id], options);
        return { id, state: gw.states.get(id) };
      },
      async rooms(options) {
        await call('rooms', [], options);
        return gw.rooms;
      },
      async scenes(options) {
        await call('scenes', [], options);
        return gw.scenes;
      },
      async jobs(options) {
        await call('jobs', [], options);
        return gw.jobs;
      },
      async buttons(options) {
        await call('buttons', [], options);
        return gw.buttons;
      },
      async setTargetState(id, state, options) {
        await call('setTargetState', [id, state], options);
        const next = { ...gw.states.get(id), ...state };
        gw.states.set(id, next);
        if (gw.echo) {
          emit({ load: { id, state } });
        }
        return { id, target_state: state };
      },
      async ctrl(id, button, event, options) {
        await call('ctrl', [id, button, event], options);
        if (button === 'on' || button === 'off') {
          const bri = button === 'on' ? 10000 : 0;
          gw.states.set(id, { ...gw.states.get(id), bri });
          if (gw.echo) {
            emit({ load: { id, state: { bri } } });
          }
        }
        return { id, ctrl: { button, event } };
      },
      async triggerJob(id, options) {
        await call('triggerJob', [id], options);
        return { id };
      },
      close() {
        client.closed = true;
      },
    });
    gw.clients.push(client);
    return client;
  };

  gw.openLive = async ({ url, token, onMessage = () => {}, onClose = () => {} }) => {
    gw.liveOpens += 1;
    gw.calls.push({ name: 'live', args: [url], token });
    if (gw.liveFailure) {
      throw gw.liveFailure;
    }
    if (!gw.tokens.has(token)) {
      throw new LiveError('network', 'connection refused or failed');
    }
    const session = {
      closed: false,
      onMessage,
      onClose,
      close() {
        session.closed = true;
      },
    };
    gw.sessions.push(session);
    return session;
  };

  gw.emit = emit;
  /** The live socket is lost (the gateway rebooted, the Wi-Fi dropped). */
  gw.drop = () => {
    for (const session of live()) {
      session.closed = true;
      session.onClose('connection closed');
    }
  };
  gw.callsOf = (name) => gw.calls.filter((c) => c.name === name);
  gw.live = live;
  return gw;
}

/** A logger that keeps every line (to check that no token is ever logged). */
export function captureLogger() {
  const lines = [];
  const log =
    (level) =>
    (...args) =>
      lines.push(
        `${level} ${args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`,
      );
  const logger = {
    lines,
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child: () => logger,
  };
  return logger;
}
