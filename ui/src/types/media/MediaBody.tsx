import { useState } from 'react';
import { CardLink } from '../../frame/CardLink.tsx';
import type { CardTypeProps } from '../../registry/registry.ts';
import type { MediaData, MediaItem } from '../../../../src/index.js';
import { safeImageSrc } from '../shared/safeImageSrc.ts';
import { ShowMore } from '../shared/ShowMore.tsx';
import { mediaAlt, mediaItems } from './logic.ts';
import './media.css';

const COMPACT_CAP = 6;

function Picture({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false);
  const src = safeImageSrc(item.src);
  const alt = mediaAlt(item);
  const img =
    src && !failed ? (
      <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    ) : (
      <span className="media-placeholder">{alt}</span>
    );
  return item.link ? (
    <CardLink href={item.link} title={alt}>
      <span className="media-box">{img}</span>
    </CardLink>
  ) : (
    <span className="media-box">{img}</span>
  );
}

export function MediaBody({ card, data, mode }: CardTypeProps<MediaData>) {
  const items = mediaItems(data);
  if (items.length === 0) return <p className="media-empty">–</p>;
  const full = mode === 'fullscreen';
  const shown = full ? items : items.slice(0, COMPACT_CAP);
  const rest = items.length - shown.length;
  const layout = (data as { layout?: string }).layout === 'single' ? 'single' : 'grid';
  return (
    <div className={`media-root media-root--${layout}${full ? ' media-root--full' : ''}`}>
      <div className="media-grid">
        {shown.map((item, i) => (
          <figure key={`${i}:${item.src}`} className="media-figure">
            <Picture item={item} />
            {item.caption && <figcaption className="media-caption">{item.caption}</figcaption>}
          </figure>
        ))}
      </div>
      {rest > 0 && <ShowMore cardId={card.id} count={rest} />}
    </div>
  );
}
