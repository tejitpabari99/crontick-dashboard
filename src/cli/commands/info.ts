import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { DEFAULT_PORT, loadConfig } from '../../config.js';
import { resolveNotifyGate } from '../../integrations/notify/gate.js';
import { daemonStatus, type DaemonStatus } from '../../lifecycle.js';
import { configPath, dataDir, feedDir } from '../../paths.js';
import { packageAssets } from '../assets.js';
import type { CliContext } from '../io.js';

export interface InfoDeps {
  daemonStatus: (opts: { env: NodeJS.ProcessEnv }) => Promise<DaemonStatus>;
}

/** Frozen `info --json` contract (the skill relies on these names). */
export interface InfoJson {
  version: string;
  dataDir: string;
  feedDir: string;
  url: string | null;
  running: boolean;
  configPath: string;
  templatesDir: string;
  schemasDir: string;
  skillPath: string;
  notifications: { mode: string; reason: string };
}

export function createInfoRegister(deps: InfoDeps = { daemonStatus }) {
  return (program: Command, ctx: CliContext): void => {
    program
      .command('info')
      .description('Show version, data/feed dirs, URL, and packaged asset paths (works with the daemon stopped)')
      .option('--json', 'machine-readable output')
      .action(async (opts: { json?: boolean }) => {
        const env = ctx.io.env as NodeJS.ProcessEnv;
        const assets = packageAssets();
        const pkg = JSON.parse(readFileSync(join(assets.root, 'package.json'), 'utf8')) as { version: string };
        const status = await deps.daemonStatus({ env });
        const { config } = loadConfig(env);
        const gate = resolveNotifyGate({ configValue: config.notifications.os, env, platform: process.platform });
        const info: InfoJson = {
          version: pkg.version,
          dataDir: dataDir(env),
          feedDir: feedDir(env),
          url: status.running ? (status.url ?? null) : null,
          running: status.running,
          configPath: configPath(env),
          templatesDir: assets.templatesDir,
          schemasDir: assets.schemasDir,
          skillPath: assets.skillPath,
          notifications: { mode: gate.mode, reason: gate.reason },
        };
        if (opts.json) {
          ctx.io.stdout(`${JSON.stringify(info, null, 2)}\n`);
          return;
        }
        const rows: [string, string][] = [
          ['Version', info.version],
          ['Data dir', info.dataDir],
          ['Feed dir', info.feedDir],
          ['URL', info.url ?? `not running (default port ${DEFAULT_PORT})`],
          ['Config', info.configPath],
          ['Templates', info.templatesDir],
          ['Schemas', info.schemasDir],
          ['Skill', info.skillPath],
          ['Notifications', `${info.notifications.mode} (${info.notifications.reason})`],
        ];
        for (const [k, v] of rows) ctx.io.stdout(`${k.padEnd(14)}${v}\n`);
      });
  };
}

export const registerInfo = createInfoRegister();
