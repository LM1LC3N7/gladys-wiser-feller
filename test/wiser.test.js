// -----------------------------------------------------------------------------
// The REST client of src/wiser.js: the envelope of the µGateway, the errors by
// kind, the token only in the header and only to the address typed (never a
// redirection), the claim. Against the simulated gateway on 127.0.0.1.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WiserError, claimToken, createClient, parseAnswer, reasonOf } from '../src/wiser.js';
import { NEW_TOKEN, TOKEN } from './helpers/fixtures.js';
import { gatewayServer } from './helpers/gatewayServer.js';

const answer = (status, json, headers = {}) => ({
  status,
  headers,
  body: json === undefined ? '' : typeof json === 'string' ? json : JSON.stringify(json),
});

const kindOf = (a) => {
  try {
    parseAnswer(a, TOKEN);
  } catch (err) {
    return err.kind;
  }
  return 'ok';
};

test('the envelope and the errors by kind', () => {
  assert.deepEqual(parseAnswer(answer(200, { status: 'success', data: [1] })), [1]);
  assert.equal(kindOf(answer(401, {})), 'auth');
  assert.equal(kindOf(answer(403, {})), 'auth');
  assert.equal(
    kindOf(answer(200, { status: 'error', message: 'api is locked, log in to receive …' })),
    'auth',
  );
  assert.equal(kindOf(answer(200, { status: 'error', message: 'unauthorized user' })), 'auth');
  assert.equal(kindOf(answer(404, { status: 'error', message: 'not found' })), 'notfound');
  assert.equal(kindOf(answer(429, {}, { 'retry-after': '30' })), 'rate');
  assert.equal(kindOf(answer(503, {})), 'server');
  assert.equal(kindOf(answer(400, { status: 'error', message: 'bad' })), 'api');
  assert.equal(kindOf(answer(302, undefined, { location: 'http://x/' })), 'redirect');
  assert.equal(kindOf(answer(200, '<html>hello</html>')), 'format');
  assert.equal(kindOf(answer(200, { status: 'error', message: 'no button pressed' })), 'nobutton');
  assert.equal(kindOf(answer(200, { hello: 1 })), 'format');
  try {
    parseAnswer(answer(429, {}, { 'retry-after': '30' }));
  } catch (err) {
    assert.equal(err.retryAfter, 30_000);
  }
});

test('a message of the gateway never carries the token', () => {
  const reason = reasonOf({ message: `token ${TOKEN} refused, Bearer: ${NEW_TOKEN} too` }, TOKEN);
  assert.ok(!reason.includes(TOKEN) && !reason.includes(NEW_TOKEN), reason);
});

test('the token goes in the header, to the address typed only; a redirection is never followed', async (t) => {
  const sim = await gatewayServer();
  t.after(() => sim.close());
  const client = createClient({ url: sim.url, token: TOKEN });
  t.after(() => client.close());
  const loads = await client.loads();
  assert.equal(loads.length, 11);
  assert.equal(sim.requests.at(-1).auth, `Bearer ${TOKEN}`);
  const info = await client.info();
  assert.equal(info.sn, '19100018');
  assert.equal(sim.requests.at(-1).auth, undefined, 'the info needs no token');
  await client.setTargetState(3, { level: 5000 });
  assert.deepEqual(sim.requests.at(-1).body, { level: 5000 });

  const refused = createClient({ url: sim.url, token: 'wrong-token-1234' });
  t.after(() => refused.close());
  await assert.rejects(refused.loads(), (err) => err instanceof WiserError && err.kind === 'auth');

  sim.redirect = true;
  const count = sim.requests.length;
  await assert.rejects(
    client.loads(),
    (err) => err.kind === 'redirect' && !err.message.includes('192.0.2.1'),
  );
  assert.equal(sim.requests.length, count + 1, 'one request, not followed');
});

test('a command is not sent once its guard refuses', async (t) => {
  const sim = await gatewayServer();
  t.after(() => sim.close());
  const client = createClient({ url: sim.url, token: TOKEN });
  t.after(() => client.close());
  const count = sim.requests.length;
  const guard = () => {
    const err = new Error('too late');
    err.refusal = 'tooLate';
    throw err;
  };
  await assert.rejects(client.ctrl(1, 'on', 'click', { guard, timeout: 1000 }), /too late/);
  assert.equal(sim.requests.length, count);
});

test('the claim: one POST without a token, the secret returned; no button pressed told', async (t) => {
  const sim = await gatewayServer({ claimDelay: 50 });
  t.after(() => sim.close());
  const token = await claimToken({ url: sim.url, source: 'installer' });
  assert.equal(token, NEW_TOKEN);
  assert.deepEqual(sim.requests.at(-1), {
    method: 'POST',
    path: '/api/account/claim',
    auth: undefined,
    body: { user: 'gladys', source: 'installer' },
  });
  const none = await gatewayServer({ claimResult: 'nobutton' });
  t.after(() => none.close());
  await assert.rejects(
    claimToken({ url: none.url, source: 'admin' }),
    (err) => err.kind === 'nobutton',
  );
  assert.equal(none.claims, 1);
});
