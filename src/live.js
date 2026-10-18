// -----------------------------------------------------------------------------
// The live messages of the µGateway: ws://<gateway>/api, a WebSocket opened
// with the same `Authorization: Bearer` header as the REST API (Feller's
// wiser-tutorial, websocket.md; aiowiserbyfeller websocket.py). Each message
// is one JSON object; only the changes are sent:
//   {"load": {"id": 3, "state": {"moving": "stop", "tilt": 0, "level": 8160}}}
//   {"button": {"id": 53, "cmd": {"event": "click", "type": "down"}}}
// (button events: Generation B gateways, firmware 6.0.41 or later, for the
// buttons registered on the gateway). Other messages (sensors, flags, findme)
// are dropped. Node's WebSocket (undici) takes the header in its options.
// -----------------------------------------------------------------------------

import { BUTTON_EVENTS, BUTTON_TYPES, LIMITS, LIVE_PATH, TIMINGS } from './constants.js';
import { stateOf } from './model.js';

export class LiveError extends Error {
  /** @param {'timeout'|'closed'|'network'} kind */
  constructor(kind, message) {
    super(message);
    this.name = 'LiveError';
    this.kind = kind;
  }
}

/** The WebSocket URL of the gateway at `url` (http://host[:port]). */
export const liveUrl = (url) => `${url.replace(/^http/i, 'ws')}${LIVE_PATH}`;

const isId = (v) => Number.isSafeInteger(v) && v >= 0;

/**
 * One message of the socket -> `{ type: 'load', id, state }`,
 * `{ type: 'button', id, event, button }` or undefined (anything else).
 * Only known keys are copied: nothing of the message reaches a prototype.
 */
export function messageOf(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return undefined;
  }
  if (Object.hasOwn(json, 'load')) {
    const load = json.load;
    const state = stateOf(load?.state);
    if (!isId(load?.id) || !state) {
      return undefined;
    }
    return { type: 'load', id: load.id, state };
  }
  if (Object.hasOwn(json, 'button')) {
    const button = json.button;
    const event = button?.cmd?.event;
    const type = button?.cmd?.type;
    if (!isId(button?.id) || !BUTTON_EVENTS.includes(event)) {
      return undefined;
    }
    return {
      type: 'button',
      id: button.id,
      event,
      button: BUTTON_TYPES.includes(type) ? type : undefined,
    };
  }
  return undefined;
}

/**
 * Opens the socket; resolves once it is open. Messages reach
 * `onMessage(message)`; `onClose(reason)` is called once when an open socket
 * is lost (never after `close()`).
 * @param {{ url: string, token: string, WebSocket?: typeof WebSocket, timers?: object, timeout?: number, onMessage?: Function, onClose?: Function }} options
 * @returns {Promise<{ close(): void }>}
 */
export function openLive({
  url,
  token,
  WebSocket = globalThis.WebSocket,
  timers = globalThis,
  timeout = TIMINGS.liveTimeout,
  onMessage = () => {},
  onClose = () => {},
}) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') {
      reject(new LiveError('network', 'no WebSocket in this Node.js'));
      return;
    }
    let ws;
    try {
      ws = new WebSocket(liveUrl(url), { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      reject(new LiveError('network', 'cannot open the socket'));
      return;
    }
    let ready = false;
    let done = false;

    function finish(reason, error, { notify = true } = {}) {
      if (done) {
        return;
      }
      done = true;
      timers.clearTimeout(openTimer);
      try {
        ws.close();
      } catch {
        // Already closed.
      }
      if (!ready) {
        reject(error ?? new LiveError('closed', reason));
      } else if (notify) {
        onClose(reason);
      }
    }

    const openTimer = timers.setTimeout(() => {
      const seconds = Math.round(timeout / 1000);
      finish('timeout', new LiveError('timeout', `the socket did not open within ${seconds} s`));
    }, timeout);

    ws.addEventListener('open', () => {
      if (done) {
        return;
      }
      ready = true;
      timers.clearTimeout(openTimer);
      resolve({
        close() {
          finish('closed', undefined, { notify: false });
        },
      });
    });
    ws.addEventListener('message', (event) => {
      const data = event?.data;
      if (!ready || done || typeof data !== 'string' || data.length > LIMITS.eventBytes) {
        return;
      }
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        return;
      }
      const message = messageOf(json);
      onMessage(message);
    });
    ws.addEventListener('close', () => finish('connection closed'));
    // The error event of undici carries no status: never its text either (it
    // may quote the request).
    ws.addEventListener('error', () => {
      const reason = ready ? 'connection lost' : 'connection refused or failed';
      finish(reason, new LiveError('network', reason));
    });
  });
}
