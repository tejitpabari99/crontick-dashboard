export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Must match the pre-paint script in ui/index.html. */
export const THEME_KEY = 'crontick-dashboard.theme';

const ORDER: readonly ThemeChoice[] = ['system', 'light', 'dark'];

export function isChoice(v: unknown): v is ThemeChoice {
  return v === 'system' || v === 'light' || v === 'dark';
}

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isChoice(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function writeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* storage unavailable: choice lasts for this session only */
  }
}

export function nextChoice(choice: ThemeChoice): ThemeChoice {
  return ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length] ?? 'system';
}

export function prefersDark(): boolean {
  return typeof matchMedia === 'function' ? !matchMedia('(prefers-color-scheme: light)').matches : true;
}

export function resolveTheme(choice: ThemeChoice, dark: boolean = prefersDark()): ResolvedTheme {
  return choice === 'system' ? (dark ? 'dark' : 'light') : choice;
}

export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): ResolvedTheme {
  const resolved = resolveTheme(choice);
  root.setAttribute('data-theme', resolved);
  return resolved;
}

/** Advance system -> light -> dark, persist, apply. */
export function cycleTheme(): ThemeChoice {
  const next = nextChoice(readChoice());
  writeChoice(next);
  applyTheme(next);
  return next;
}

/** Apply stored choice and follow OS changes while on `system`. Returns cleanup. */
export function initTheme(): () => void {
  applyTheme(readChoice());
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: light)');
  const onChange = (): void => {
    if (readChoice() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
