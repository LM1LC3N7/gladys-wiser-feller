import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseGatewayAddress } from '../src/config.js';

test('the address of the µGateway', () => {
  assert.deepEqual(parseGatewayAddress('192.168.1.20'), {
    url: 'http://192.168.1.20',
    host: '192.168.1.20',
  });
  assert.equal(parseGatewayAddress(' http://192.168.1.20/ ').url, 'http://192.168.1.20');
  assert.equal(parseGatewayAddress('http://192.168.1.20/api').url, 'http://192.168.1.20');
  assert.equal(parseGatewayAddress('192.168.1.20:8080').url, 'http://192.168.1.20:8080');
  assert.equal(parseGatewayAddress('').error, 'empty');
  assert.equal(parseGatewayAddress('https://192.168.1.20').error, 'https');
  assert.equal(parseGatewayAddress('ftp://192.168.1.20').error, 'invalid');
  assert.equal(parseGatewayAddress('http://u:p@192.168.1.20').error, 'credentials');
  assert.equal(parseGatewayAddress('http://192.168.1.20/api/loads').error, 'path');
  assert.equal(parseGatewayAddress('http://192.168.1.20/?x=1').error, 'path');
  assert.equal(parseGatewayAddress('wiser.local').error, 'local-name');
  assert.equal(parseGatewayAddress('http://[::1').error, 'invalid');
});

test('the configuration, normalized', () => {
  const c = normalizeConfig({ gateway_address: '192.168.1.20', api_token: ' abc-123-def ' });
  assert.equal(c.error, undefined);
  assert.equal(c.token, 'abc-123-def');
  assert.equal(c.live, true);
  assert.equal(c.pollInterval, 30);
  assert.equal(c.importUser, 'admin');
  assert.equal(c.allowImpulse, false, 'impulse outputs off by default');
  assert.equal(normalizeConfig({ gateway_address: '192.168.1.20' }).error, 'no-token');
  assert.equal(
    normalizeConfig({ gateway_address: '192.168.1.20', api_token: 'a b' }).error,
    'bad-token',
  );
  assert.equal(
    normalizeConfig({ gateway_address: '192.168.1.20', api_token: 'short' }).error,
    'bad-token',
  );
  assert.equal(
    normalizeConfig({ gateway_address: '192.168.1.20', api_token: 'abc\u0000defgh' }).error,
    'bad-token',
  );
  const bounded = normalizeConfig({
    ...DEFAULTS,
    gateway_address: '1.2.3.4',
    api_token: 'x',
    poll_interval: 1,
    import_user: 'root',
    allow_impulse_outputs: 'true',
    live_updates: 'false',
  });
  assert.equal(bounded.pollInterval, 10);
  assert.equal(bounded.importUser, 'admin');
  assert.equal(bounded.allowImpulse, true);
  assert.equal(bounded.live, false);
});
