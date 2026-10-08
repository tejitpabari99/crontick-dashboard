import type { ReactNode } from 'react';
import { LINK_SCHEMES, WEB_LINK_SCHEMES } from '../../../src/constants/contract.js';
import './card-link.css';

const WEB = new Set<string>(WEB_LINK_SCHEMES);
const ALLOWED = new Set<string>(LINK_SCHEMES);

function protocolOf(href: string): string | null {
  try {
    return new URL(href.trim()).protocol;
  } catch {
    return null;
  }
}

export function isAllowedLink(href: string): boolean {
  const p = protocolOf(href);
  return p !== null && ALLOWED.has(p);
}

/** Shared link for all card types. Anchors only for http|https|mailto|ms-outlook; otherwise plain text. */
export function CardLink({ href, children, title }: { href: string; children: ReactNode; title?: string }) {
  const protocol = protocolOf(href);
  const tip = title ?? (typeof children === 'string' ? children : undefined);
  if (protocol === null || !ALLOWED.has(protocol)) {
    return (
      <span className="card-link-text" title={tip}>
        {children}
      </span>
    );
  }
  const web = WEB.has(protocol);
  return (
    <a
      className="card-link"
      href={href.trim()}
      title={tip}
      {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      <span className="card-link__text">{children}</span>
      <span className="card-link__glyph" aria-hidden="true">
        {' ↗'}
      </span>
    </a>
  );
}
