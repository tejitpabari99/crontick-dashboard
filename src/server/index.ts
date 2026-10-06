// Server entry (built to dist/server/index.js). The daemon lifecycle spawns this detached.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_UI_DIR } from '../constants/env.js';
import { startServer } from '../http/server.js';

// ENV_UI_DIR overrides the built UI location (used by lifecycle tests running from source).
const uiDir = process.env[ENV_UI_DIR] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../ui');
const log = (m: string): void => void console.log(`${new Date().toISOString()} ${m}`);

const running = await startServer({
  env: process.env,
  uiDir,
  logger: { info: log, warn: log },
  onShutdown: () => process.exit(0),
});
const quit = (): void => void running.stop().then(() => process.exit(0));
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
