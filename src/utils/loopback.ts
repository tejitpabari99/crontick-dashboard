import { LOOPBACK_HOST } from '../constants/http.js';

/** `host:port` of the loopback server (the value a Host header must carry). */
export const loopbackHost = (port: number): string => `${LOOPBACK_HOST}:${port}`;

/** `http://127.0.0.1:<port>` with an optional path/hash suffix. */
export const loopbackUrl = (port: number, suffix = ''): string => `http://${loopbackHost(port)}${suffix}`;
