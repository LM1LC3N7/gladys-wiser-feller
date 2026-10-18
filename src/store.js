// -----------------------------------------------------------------------------
// What must outlive a restart of the container, kept in /data/state.json:
//   - the token refused by the µGateway (a fingerprint, never the token):
//     Gladys never tries it again by itself, even after a restart;
//   - the end of a 429 pause (bounded when read back).
// /data is the only writable place of the container.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIMINGS } from './constants.js';

/** The fingerprint of a token for an address: enough to recognize it, useless to use it. */
export const fingerprint = (url, token) =>
  createHash('sha256').update(`${url}\n${token}`).digest('hex').slice(0, 24);

export class StateStore {
  /**
   * @param {{ dir?: string|null, now?: () => number, logger?: object }} options
   *   dir null: kept in memory only (tests)
   */
  constructor({ dir = process.env.WISER_DATA_DIR ?? '/data', now = Date.now, logger } = {}) {
    this.dir = dir;
    this.now = now;
    this.logger = logger;
    this.data = { refused: undefined, pausedUntil: 0 };
    this.load();
  }

  load() {
    if (!this.dir) {
      return;
    }
    try {
      const json = JSON.parse(readFileSync(join(this.dir, 'state.json'), 'utf8'));
      const refused = json?.refused;
      if (refused && typeof refused.key === 'string' && /^[0-9a-f]{24}$/.test(refused.key)) {
        this.data.refused = {
          key: refused.key,
          reason: typeof refused.reason === 'string' ? refused.reason.slice(0, 200) : '',
        };
      }
      const until = Number(json?.pausedUntil);
      if (Number.isFinite(until) && until > 0) {
        // A date far in the future (a clock that jumped) is bounded.
        this.data.pausedUntil = Math.min(until, this.now() + TIMINGS.rateLimitMax);
      }
    } catch {
      // No file yet, or unreadable: start empty.
    }
  }

  save() {
    if (!this.dir) {
      return;
    }
    try {
      mkdirSync(this.dir, { recursive: true });
      const file = join(this.dir, 'state.json');
      writeFileSync(`${file}.tmp`, JSON.stringify(this.data));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      this.logger?.warn(`Cannot write ${this.dir}/state.json: ${err.code ?? err.message}`);
    }
  }

  /** The refusal of this token at this address, if it was refused. */
  refusalOf(url, token) {
    const refused = this.data.refused;
    return refused && refused.key === fingerprint(url, token) ? refused : undefined;
  }

  refuse(url, token, reason) {
    this.data.refused = {
      key: fingerprint(url, token),
      reason: String(reason ?? '').slice(0, 200),
    };
    this.save();
  }

  clearRefusal() {
    if (this.data.refused) {
      this.data.refused = undefined;
      this.save();
    }
  }

  get pausedUntil() {
    return this.data.pausedUntil;
  }

  pauseUntil(until) {
    const bounded = Math.min(until, this.now() + TIMINGS.rateLimitMax);
    if (bounded > this.data.pausedUntil) {
      this.data.pausedUntil = bounded;
      this.save();
    }
  }
}
