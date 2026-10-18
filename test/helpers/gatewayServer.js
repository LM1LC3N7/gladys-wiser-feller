// -----------------------------------------------------------------------------
// A simulated µGateway on 127.0.0.1 (never the network): the REST API of the
// fixtures behind `Authorization: Bearer`, the claim, and the live WebSocket
// on /api (a minimal RFC 6455 server: handshake, unmasked text frames out,
// close frames in).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import http from 'node:http';
import * as F from './fixtures.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(text) {
  const payload = Buffer.from(text, 'utf8');
  const n = payload.length;
  const head =
    n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, (n >> 8) & 0xff, n & 0xff]);
  return Buffer.concat([head, payload]);
}

export async function gatewayServer({ token = F.TOKEN, claimDelay = 0, claimResult } = {}) {
  const states = new Map(F.states().map((s) => [s.id, s.state]));
  const sim = {
    requests: [],
    upgrades: 0,
    sockets: new Set(),
    tokens: new Set([token]),
    claims: 0,
    redirect: false,
  };
  const ok = (data) => ({ status: 'success', data });
  const locked = {
    status: 'error',
    message: 'api is locked, log in to receive an authentication cookie OR unlock the device.',
  };

  const push = (json) => {
    for (const socket of sim.sockets) {
      socket.write(frame(JSON.stringify(json)));
    }
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      const auth = req.headers.authorization;
      const path = new URL(req.url, 'http://gw').pathname;
      sim.requests.push({ method: req.method, path, auth, body });
      const send = (status, json) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (sim.redirect) {
        res.writeHead(302, { Location: 'http://192.0.2.1/api/loads' });
        res.end();
        return;
      }
      if (path === '/api/info' && req.method === 'GET') {
        send(200, ok(F.info()));
        return;
      }
      if (path === '/api/account/claim' && req.method === 'POST') {
        sim.claims += 1;
        setTimeout(() => {
          if (claimResult === 'nobutton') {
            send(200, { status: 'error', message: 'no button pressed' });
          } else {
            sim.tokens.add(F.NEW_TOKEN);
            send(200, ok({ secret: F.NEW_TOKEN, user: body?.user, source: body?.source }));
          }
        }, claimDelay);
        return;
      }
      const given = /^Bearer (.+)$/.exec(auth ?? '')?.[1];
      if (!given || !sim.tokens.has(given)) {
        send(200, locked);
        return;
      }
      let m;
      if (path === '/api/account') {
        send(200, ok({ user: 'gladys', source: 'admin' }));
      } else if (path === '/api/loads') {
        send(200, ok(F.loads()));
      } else if (path === '/api/loads/state') {
        send(200, ok([...states].map(([id, state]) => ({ id, state }))));
      } else if ((m = /^\/api\/loads\/(\d+)\/state$/.exec(path))) {
        send(200, ok({ id: Number(m[1]), state: states.get(Number(m[1])) }));
      } else if ((m = /^\/api\/loads\/(\d+)\/target_state$/.exec(path)) && req.method === 'PUT') {
        const id = Number(m[1]);
        states.set(id, { ...states.get(id), ...body });
        send(200, ok({ id, target_state: body }));
        push({ load: { id, state: body } });
      } else if ((m = /^\/api\/loads\/(\d+)\/ctrl$/.exec(path)) && req.method === 'PUT') {
        const id = Number(m[1]);
        send(200, ok({ id, ctrl: body }));
        if (body.button === 'on' || body.button === 'off') {
          const bri = body.button === 'on' ? 10000 : 0;
          states.set(id, { ...states.get(id), bri });
          push({ load: { id, state: { bri } } });
        }
      } else if (path === '/api/rooms') {
        send(200, ok(F.rooms()));
      } else if (path === '/api/scenes') {
        send(200, ok(F.scenes()));
      } else if (path === '/api/jobs') {
        send(200, ok(F.jobs()));
      } else if ((m = /^\/api\/jobs\/(\d+)\/trigger$/.exec(path))) {
        send(200, ok({ id: Number(m[1]) }));
      } else if (path === '/api/buttons') {
        send(200, ok(F.buttons()));
      } else {
        send(404, { status: 'error', message: 'not found' });
      }
    });
  });

  server.on('upgrade', (req, socket) => {
    const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (new URL(req.url, 'http://gw').pathname !== '/api' || !given || !sim.tokens.has(given)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    sim.upgrades += 1;
    const accept = createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}${GUID}`)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sim.sockets.add(socket);
    socket.on('data', (data) => {
      if ((data[0] & 0x0f) === 0x8) {
        // A close frame: answer it and end.
        socket.end(Buffer.from([0x88, 0x00]));
      }
    });
    socket.on('close', () => sim.sockets.delete(socket));
    socket.on('error', () => sim.sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  sim.url = `http://127.0.0.1:${server.address().port}`;
  sim.address = `127.0.0.1:${server.address().port}`;
  sim.push = push;
  sim.states = states;
  /** Every live socket is cut (as a reboot of the gateway would). */
  sim.drop = () => {
    for (const socket of sim.sockets) {
      socket.destroy();
    }
  };
  sim.close = () =>
    new Promise((resolve) => {
      sim.drop();
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  return sim;
}

/** Waits (real time) until `check` is true. */
export async function waitFor(check, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('waitFor: timed out');
}
