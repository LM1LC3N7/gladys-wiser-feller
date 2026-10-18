// -----------------------------------------------------------------------------
// The whole integration, real HTTP client and real WebSocket, against the
// simulated µGateway of test/helpers/gatewayServer.js on 127.0.0.1 (never the
// network), with the SDK's fake Gladys. Real time: a few seconds.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WiserApp } from '../src/app.js';
import { ACTIONS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { StateStore } from '../src/store.js';
import { captureLogger } from './helpers/fakeGateway.js';
import { NEW_TOKEN, OFFERED, TOKEN } from './helpers/fixtures.js';
import { gatewayServer, waitFor } from './helpers/gatewayServer.js';

test('a µGateway, end to end: devices, live states, commands, presses, claim, test', async (t) => {
  const sim = await gatewayServer();
  const gladys = createFakeGladys({ config: { gateway_address: sim.address, api_token: TOKEN } });
  const logger = captureLogger();
  const app = new WiserApp({ gladys, logger, store: new StateStore({ dir: null }) });
  registerHandlers(gladys, app, logger);
  t.after(async () => {
    app.stop();
    await sim.close();
  });
  await gladys.connect();
  await waitFor(() => app.liveState === 'live');
  assert.equal(gladys.fake.discoveredDevices.length, OFFERED);
  assert.ok(
    sim.requests.filter((r) => r.path !== '/api/info').every((r) => r.auth === `Bearer ${TOKEN}`),
    'the token in the header of every request',
  );
  assert.equal(sim.requests.find((r) => r.path === '/api/info').auth, undefined);

  const named = (name) => gladys.fake.discoveredDevices.find((d) => d.name === name);
  const spots = named('Spots (Salon)');
  const button = named('Bouton 1 – Spots (Salon)');
  await gladys.fake.deviceCreated(spots);
  await gladys.fake.deviceCreated(button);

  const brightness = spots.features.find((f) => f.external_id.endsWith(':brightness'));
  const ack = await gladys.fake.setValue(spots, brightness, 30);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    sim.requests.findLast((r) => r.method === 'PUT'),
    {
      method: 'PUT',
      path: '/api/loads/2/target_state',
      auth: `Bearer ${TOKEN}`,
      body: { bri: 3000 },
    },
  );
  await waitFor(async () => {
    await app.publisher.flush();
    return gladys.fake.lastState(brightness.external_id) === 30;
  });

  sim.push({ button: { id: 53, cmd: { event: 'click', type: 'down' } } });
  await waitFor(async () => {
    await app.publisher.flush();
    return gladys.fake.lastState(`${button.external_id}:press`) === 43;
  });

  const tested = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(tested.data.message.en, /^Connection OK: .+ Live updates: OK\.$/);

  // "Get the token": the claim goes to the address typed, without a token.
  const claimed = await gladys.fake.action(ACTIONS.CLAIM, {});
  assert.equal(claimed.success, true);
  const claim = sim.requests.find((r) => r.path === '/api/account/claim');
  assert.deepEqual(claim, {
    method: 'POST',
    path: '/api/account/claim',
    auth: undefined,
    body: { user: 'gladys', source: 'admin' },
  });
  await waitFor(() => app.online && app.config.token === NEW_TOKEN && app.liveState === 'live');
  assert.equal(sim.requests.at(-1).auth, `Bearer ${NEW_TOKEN}`);

  sim.drop();
  await waitFor(() => app.liveState === 'down');
  await waitFor(() => app.liveState === 'live', 8000); // opened again after 5 s
  for (const line of logger.lines) {
    assert.ok(!line.includes(TOKEN) && !line.includes(NEW_TOKEN), line);
  }
});
