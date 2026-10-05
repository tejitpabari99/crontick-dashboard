import { useState } from 'react';
import type { ViewCard } from '../api/types.ts';
import { isUnseen } from '../lib/seen.ts';
import { cycleTheme, readChoice } from '../lib/theme.ts';
import { HiddenPopover } from './HiddenPopover.tsx';
import { SearchBox, type SearchBoxProps } from './SearchBox.tsx';
import './header.css';

/** Alerts + unseen notify panels (the `(n)` in `document.title`). */
export function attentionCount(alerts: readonly ViewCard[], panels: readonly ViewCard[]): number {
  return alerts.length + panels.filter((c) => c.kind !== 'alert' && c.notify && isUnseen(c)).length;
}

export interface HeaderProps {
  alertCount: number;
  hidden: readonly ViewCard[];
  connectionOk: boolean;
  search: SearchBoxProps;
  onUnhide(id: string): void;
}

export function Header(p: HeaderProps) {
  const [choice, setChoice] = useState(readChoice);
  const date = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const scrollToNow = (): void => {
    document.querySelector('[data-testid="now-zone"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  return (
    <header className="header">
      <h1 className="header__brand">Crontick</h1>
      <span className="header__date">{date}</span>
      {p.alertCount > 0 ? (
        <button type="button" className="header__badge" aria-label={`${p.alertCount} ${p.alertCount === 1 ? 'alert' : 'alerts'}`} onClick={scrollToNow}>
          {p.alertCount}
        </button>
      ) : null}
      <SearchBox {...p.search} />
      <HiddenPopover cards={p.hidden} onUnhide={p.onUnhide} />
      <button type="button" className="header__btn" aria-label={`Theme: ${choice}`} onClick={() => setChoice(cycleTheme())}>
        {choice === 'dark' ? '☾' : choice === 'light' ? '☀' : '◐'}
      </button>
      <span
        role="img"
        aria-label={p.connectionOk ? 'Connected' : 'Connection problem'}
        className={`header__dot header__dot--${p.connectionOk ? 'ok' : 'bad'}`}
      />
    </header>
  );
}
