// -----------------------------------------------------------------------------
// The REST API of the Wiser µGateway over HTTP (local network only), ported
// from aiowiserbyfeller (auth.py, api.py, load/*.py; Apache-2.0).
//
// Every request goes to http://<gateway>/api/... with the token in the
// `Authorization: Bearer` header; the answers are an envelope
//   { "status": "success", "data": ... } or { "status": "error", "message": ... }
// The token is sent ONLY to the address the user typed: redirections are never
// followed, and it never appears in a log nor in an error message.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { API, CLAIM_USER, LIMITS, TIMINGS } from './constants.js';

export class WiserError extends Error {
  /**
   * @param {'auth'|'notfound'|'rate'|'api'|'server'|'network'|'timeout'|'http'|'redirect'|'format'|'size'|'nobutton'} kind
   * @param {string} message never a token
   * @param {{ status?: number, retryAfter?: number }} [details] retryAfter in ms
   */
  constructor(kind, message, { status, retryAfter } = {}) {
    super(message);
    this.name = 'WiserError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> WiserError. */
export function networkError(err) {
  if (err instanceof WiserError || err?.refusal) {
    return err;
  }
  const reason = NETWORK_REASONS[err?.code] ?? err?.code ?? 'network error';
  return new WiserError('network', reason);
}

/** The text of the gateway, short, without anything that looks like a token. */
export function reasonOf(json, token) {
  let text = typeof json?.message === 'string' ? json.message : '';
  if (token) {
    text = text.split(token).join('…');
  }
  return text
    .replace(/bearer:?\s*\S+/gi, 'Bearer …')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Retry-After (seconds or an HTTP date) -> ms, or undefined. */
export function retryAfterOf(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** The refusals of the gateway that mean "this token is not (or no longer) valid". */
const AUTH_MESSAGES = /api is locked|unauthori[sz]ed|invalid token|token/i;

/**
 * The `data` of an answer, or the WiserError it carries.
 * @param {{ status: number, headers?: object, body: string }} answer
 */
export function parseAnswer({ status, headers = {}, body }, token) {
  let json;
  try {
    json = body ? JSON.parse(body) : undefined;
  } catch {
    json = undefined;
  }
  const reason = reasonOf(json, token);
  if (status >= 300 && status < 400) {
    throw new WiserError('redirect', `redirected (HTTP ${status})`, { status });
  }
  if (status === 401 || status === 403) {
    throw new WiserError('auth', reason || `token refused (HTTP ${status})`, { status });
  }
  if (json?.status === 'error' && AUTH_MESSAGES.test(reason)) {
    throw new WiserError('auth', reason, { status });
  }
  if (status === 404) {
    throw new WiserError('notfound', reason || 'not found (HTTP 404)', { status });
  }
  if (status === 429) {
    throw new WiserError('rate', 'too many requests (HTTP 429)', {
      status,
      retryAfter: retryAfterOf(headers['retry-after']),
    });
  }
  if (status >= 500) {
    throw new WiserError('server', reason ? `${reason} (HTTP ${status})` : `HTTP ${status}`, {
      status,
    });
  }
  if (status >= 400) {
    throw new WiserError('api', reason ? `${reason} (HTTP ${status})` : `HTTP ${status}`, {
      status,
    });
  }
  if (status < 200) {
    throw new WiserError('http', `HTTP ${status}`, { status });
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new WiserError('format', 'not an answer of a Wiser µGateway', { status });
  }
  if (json.status === 'error') {
    if (/no button pressed/i.test(reason)) {
      throw new WiserError('nobutton', reason, { status });
    }
    throw new WiserError('api', reason || 'refused by the µGateway', { status });
  }
  if (json.status !== 'success') {
    throw new WiserError('format', 'not an answer of a Wiser µGateway', { status });
  }
  return json.data;
}

/**
 * One HTTP request; resolves { status, headers, body }.
 * @param {string} url
 * @param {{ method: string, headers: object, body?: string, timeout: number, agent?: http.Agent, maxBytes?: number, guard?: Function }} options
 *   `guard` throws to cancel the request at the moment it would leave
 */
export function httpRequest(
  url,
  { method, headers, body, timeout, agent, maxBytes = LIMITS.responseBytes, guard },
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    let timer;
    let settled = false;
    /** The first outcome wins: a destroyed request may still end or fail after it. */
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = http.request(target, { method, agent, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new WiserError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    timer = setTimeout(() => {
      const seconds = Math.max(1, Math.round(timeout / 1000));
      settle(reject, new WiserError('timeout', `no answer within ${seconds} s`));
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
    const send = () => {
      try {
        guard?.();
      } catch (err) {
        settle(reject, err);
        req.destroy();
        return;
      }
      req.end(body);
    };
    if (!guard) {
      send();
      return;
    }
    // A command: the deadline is checked when the request really leaves (its
    // socket connected), not when it was queued behind another one.
    req.once('socket', (socket) => {
      if (socket.connecting) {
        socket.once('connect', send);
      } else {
        send();
      }
    });
  });
}

/**
 * A client of one µGateway.
 * @param {{ url: string, token?: string, request?: typeof httpRequest }} options
 */
export function createClient({ url, token = '', request = httpRequest }) {
  // Reads never hold up a command: commands get their own agent.
  const agent = new http.Agent({ keepAlive: true, maxSockets: 2 });
  const commandAgent = new http.Agent({ keepAlive: true, maxSockets: 2 });
  const send = async (
    method,
    path,
    { json, timeout = TIMINGS.requestTimeout, guard, auth = true } = {},
    via = agent,
  ) => {
    const ms = typeof timeout === 'function' ? timeout() : timeout;
    // A command must not leave once its deadline is past (guard throws).
    guard?.();
    const headers = { Accept: 'application/json' };
    if (auth) {
      headers.Authorization = `Bearer ${token}`;
    }
    let body;
    if (json !== undefined) {
      body = JSON.stringify(json);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const answer = await request(`${url}${path}`, {
      method,
      headers,
      body,
      agent: via,
      timeout: ms,
      guard,
    });
    return parseAnswer(answer, token);
  };

  return {
    url,
    /** Product, serial number, API and firmware versions (no token needed). */
    info(options) {
      return send('GET', API.info, { ...options, auth: false });
    },
    /** The account of the token: proves the token is accepted. */
    account(options) {
      return send('GET', API.account, options);
    },
    loads(options) {
      return send('GET', API.loads, options);
    },
    loadsState(options) {
      return send('GET', API.loadsState, options);
    },
    loadState(id, options) {
      return send('GET', API.loadState(id), options);
    },
    scenes(options) {
      return send('GET', API.scenes, options);
    },
    jobs(options) {
      return send('GET', API.jobs, options);
    },
    buttons(options) {
      return send('GET', API.buttons, options);
    },
    rooms(options) {
      return send('GET', API.rooms, options);
    },
    /** `{ bri }` or `{ level, tilt }`: the state a load must reach. */
    setTargetState(id, state, options) {
      return send('PUT', API.targetState(id), { ...options, json: state }, commandAgent);
    },
    /** A simulated press of a button of the load (`on`/`off`/`stop`, `click`). */
    ctrl(id, button, event, options) {
      return send('PUT', API.ctrl(id), { ...options, json: { button, event } }, commandAgent);
    },
    /** Runs a job (a Wiser scene): its target states, button controls, flags. */
    triggerJob(id, options) {
      return send('GET', API.triggerJob(id), options, commandAgent);
    },
    close() {
      agent.destroy();
      commandAgent.destroy();
    },
  };
}

/** The shape of a token of the gateway (a UUID in practice): no space, no control character. */
export const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{8,256}$/;

/**
 * Asks the µGateway for a token. Its buttons blink for 30 s: the request
 * answers once one of them is pressed (or with an error). One request per
 * click of the user, never repeated by the integration. Claiming the same
 * user again replaces (invalidates) its previous token.
 * @param {{ url: string, source: string, request?: typeof httpRequest, timeout?: number }} options
 * @returns {Promise<string>} the token (never log it)
 */
export async function claimToken({
  url,
  source,
  request = httpRequest,
  timeout = TIMINGS.claimTimeout,
}) {
  const body = JSON.stringify({ user: CLAIM_USER, source });
  const answer = await request(`${url}${API.claim}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
    timeout,
  });
  const data = parseAnswer(answer);
  const secret = data?.secret;
  if (typeof secret !== 'string' || !TOKEN_PATTERN.test(secret)) {
    throw new WiserError('format', 'the µGateway answered without a token');
  }
  return secret;
}
