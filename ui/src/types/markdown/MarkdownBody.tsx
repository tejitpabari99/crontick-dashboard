import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CardLink, isAllowedLink } from '../../frame/CardLink.tsx';
import type { CardTypeProps } from '../../registry/registry.ts';
import type { MarkdownData } from '../../../../src/index.js';
import { safeImageSrc } from '../shared/safeImageSrc.ts';
import './markdown.css';

/** Gate every URL: images via safeImageSrc, links via CardLink's allow-list. Empty string = dropped. */
function urlTransform(url: string, key: string): string {
  if (key === 'src') return safeImageSrc(url) ?? '';
  if (key === 'href') return isAllowedLink(url) ? url : '';
  return '';
}

const heading = (tag: 'h3' | 'h4' | 'h5' | 'h6') => {
  const Tag = tag;
  return function Heading({ children }: { children?: ReactNode }) {
    return <Tag className={`md-${tag}`}>{children}</Tag>;
  };
};

const components: Components = {
  h1: heading('h3'),
  h2: heading('h4'),
  h3: heading('h5'),
  h4: heading('h6'),
  h5: heading('h6'),
  h6: heading('h6'),
  a: ({ href, children }) => <CardLink href={href ?? ''}>{children}</CardLink>,
  img: ({ src, alt }) =>
    typeof src === 'string' && src !== '' ? (
      <img className="md-img" src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />
    ) : (
      <span className="md-img-missing">{alt ?? ''}</span>
    ),
  table: (props: ComponentPropsWithoutRef<'table'>) => (
    <div className="md-table-wrap">
      <table>{props.children}</table>
    </div>
  ),
  input: ({ checked }) => <input type="checkbox" checked={!!checked} disabled readOnly />,
};

export function MarkdownBody({ data }: CardTypeProps<MarkdownData>) {
  const text = typeof data?.text === 'string' ? data.text : '';
  if (text.trim() === '') return <p className="md-empty">(empty)</p>;
  return (
    <div className="md-body">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={urlTransform} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
