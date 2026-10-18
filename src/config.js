// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { IMPORT_USERS, LANGUAGES, POLL_INTERVAL, TOKEN_PATTERN } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  gateway_address: '',
  api_token: '',
  import_user: 'admin',
  live_updates: true,
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
  allow_impulse_outputs: false,
  publish_tilt: false,
};

/**
 * The base address of the µGateway from what the user typed: "192.168.1.20",
 * "http://192.168.1.20/" or "http://192.168.1.20/api".
 * @returns {{ url: string, host: string } | { error: 'empty'|'invalid'|'https'|'credentials'|'path'|'local-name' }}
 */
export function parseGatewayAddress(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { error: 'empty' };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (url.protocol === 'https:') {
    // The µGateway API is served over plain HTTP on the local network only.
    return { error: 'https' };
  }
  if (url.protocol !== 'http:' || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    return { error: 'credentials' };
  }
  if (!/^\/(api\/?)?$/i.test(url.pathname) || url.search || url.hash) {
    // The token goes to this exact host and nowhere else: no path, no query.
    return { error: 'path' };
  }
  if (/\.local$/i.test(url.hostname)) {
    // mDNS names do not resolve in the container (bridge network).
    return { error: 'local-name' };
  }
  return { url: url.origin, host: url.host };
}

const bounded = (raw, { min, max, default: fallback }) => {
  const n = Number(raw);
  return raw !== '' && raw !== null && Number.isFinite(n)
    ? Math.max(min, Math.min(max, n))
    : fallback;
};

export const bool = (raw, fallback) => {
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (raw === 'true' || raw === 1 || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === 0 || raw === '0') {
    return false;
  }
  return fallback;
};

/**
 * @returns {{ url?: string, host?: string, token: string, error?: string,
 *   importUser: string, live: boolean, pollInterval: number, language: 'fr'|'en',
 *   allowImpulse: boolean }}
 */
export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
  const c = { ...DEFAULTS, ...given };
  const target = parseGatewayAddress(c.gateway_address);
  const token = String(c.api_token ?? '').trim();
  let error = target.error;
  if (!error && token === '') {
    error = 'no-token';
  }
  if (!error && !TOKEN_PATTERN.test(token)) {
    // Never sent: a clear status, and no retry until the configuration changes.
    error = 'bad-token';
  }
  return {
    url: target.url,
    host: target.host,
    token,
    error,
    importUser: IMPORT_USERS.includes(c.import_user) ? c.import_user : DEFAULTS.import_user,
    live: bool(c.live_updates, DEFAULTS.live_updates),
    pollInterval: Math.round(bounded(c.poll_interval, POLL_INTERVAL)),
    language: LANGUAGES.includes(c.language) ? c.language : DEFAULTS.language,
    // Impulse and staircase-timer outputs stay read-only unless allowed (a
    // garage door opener is often wired to an impulse output).
    allowImpulse: bool(c.allow_impulse_outputs, false),
    // The slats of venetian blinds as their own device, off by default: a
    // "close all blinds" of a voice assistant may target it too.
    publishTilt: bool(c.publish_tilt, false),
  };
}
