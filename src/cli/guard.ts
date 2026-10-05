/** Node-version guard. Kept dependency-free: it runs before the real CLI is imported. */
export const MIN_NODE = [22, 5] as const;

/** Returns an error message if `version` (e.g. "20.1.0") is older than MIN_NODE, else null. */
export function checkNodeVersion(version: string): string | null {
  const [maj = 0, min = 0] = version.split('.').map((n) => Number.parseInt(n, 10) || 0);
  if (maj > MIN_NODE[0] || (maj === MIN_NODE[0] && min >= MIN_NODE[1])) return null;
  return `error: crontick-dashboard requires Node >=${MIN_NODE.join('.')} (found ${version}). Please upgrade Node.`;
}

export interface GuardDeps {
  version: string;
  load: () => Promise<{ main: () => Promise<void> }>;
  stderr: (s: string) => void;
  exit: (code: number) => void;
}

/** Check Node, then (and only then) dynamically import and run the real CLI. */
export async function guardedMain(deps: GuardDeps): Promise<void> {
  const problem = checkNodeVersion(deps.version);
  if (problem) {
    deps.stderr(`${problem}\n`);
    deps.exit(1);
    return;
  }
  const { main } = await deps.load();
  await main();
}
