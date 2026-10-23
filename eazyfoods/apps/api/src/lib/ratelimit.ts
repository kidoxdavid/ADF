import { config } from '../config.js';

/** Per-route rate limit config; effectively off under test so suites can create many users. */
export const rl = (max: number, timeWindow: string) => ({ config: { rateLimit: { max: config.NODE_ENV === 'test' ? 100000 : max, timeWindow } } });
