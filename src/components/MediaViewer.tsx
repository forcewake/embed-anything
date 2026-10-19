/**
 * The focused media viewer.
 *
 * The card animates out of the field into this viewer (the animation itself
 * lives in the spatial field); this component renders the chrome: the media
 * kind, the navigation, the attribution, the relevance score and the
 * playback controls.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SpatialField } from '../engine/SpatialField';
import type { MediaItem } from '../media/types';
import { formatDuration } from '../media/catalog';
import { Playback } from './Playback';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ImageIcon,
  MusicIcon,
  TextIcon,
  TrashIcon,
  VideoIcon,
} from './icons';

export interface MediaViewerProps {
  engine: SpatialField;
  item: MediaItem;
  items: MediaItem[];
  score?: number;
  onClose: () => void;
  onSelect: (item: MediaItem) => void;
  onDelete?: (item: MediaItem) => void;
}

const KIND_ICONS = {
  image: ImageIcon,
  video: VideoIcon,
  audio: MusicIcon,
  text: TextIcon,
} as const;

export function MediaViewer({ engine, item, items, score, onClose, onSelect, onDelete }: MediaViewerProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  const selectRef = useRef(onSelect);
  closeRef.current = onClose;
  selectRef.current = onSelect;

  useEffect(() => () => engine.close(), [engine]);

  useLayoutEffect(() => {
    const host = document.createElement('div');
    host.className = 'viewer-root';
    document.body.appendChild(host);
    setContainer(host);
    engine.open(item);
    return () => {
      host.remove();
    };
  }, [engine, item]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const index = items.findIndex((entry) => entry.id === item.id);
  const step = (delta: number) => {
    if (!items.length) return;
    selectRef.current(items[(Math.max(0, index) + delta + items.length) % items.length]);
  };

  const KindIcon = KIND_ICONS[item.type] ?? ImageIcon;
  const canDelete = !!(item as { local?: boolean }).local && onDelete;

  if (!container) return null;

  return createPortal(
    <div className={`viewer-surface viewer-${item.type}`}>
      {item.type === 'text' && (
        <div className="viewer-media">
          <blockquote>{(item as { text?: string }).text}</blockquote>
        </div>
      )}
      {(item.type === 'video' || item.type === 'audio') && <Playback item={item} engine={engine} key={item.id} />}

      <header className="viewer-toolbar">
        <div className="viewer-medium">
          <KindIcon size={20} strokeWidth={1.5} />
          <span>{item.type}</span>
          {item.duration && <span className="viewer-duration">{item.duration}</span>}
        </div>
        <div className="viewer-actions">
          <div className="viewer-nav" role="group" aria-label="Browse collection">
            <button aria-label="Previous item" onClick={() => step(-1)} disabled={items.length < 2}>
              <ChevronLeftIcon size={19} strokeWidth={1.5} />
            </button>
            <span className="viewer-position" aria-hidden="true">
              {Math.max(0, index) + 1} <span>of {items.length}</span>
            </span>
            <button aria-label="Next item" onClick={() => step(1)} disabled={items.length < 2}>
              <ChevronRightIcon size={19} strokeWidth={1.5} />
            </button>
          </div>
          {canDelete && (
            <button className="viewer-delete" aria-label="Remove this item" onClick={() => onDelete?.(item)}>
              <TrashIcon size={18} strokeWidth={1.5} />
            </button>
          )}
          <button className="viewer-close" aria-label="Close" onClick={() => closeRef.current()}>
            <CloseIcon size={18} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <div className="viewer-details">
        <div>
          <h2>{item.title}</h2>
          {item.description && <p>{item.description}</p>}
          {item.source && (
            <p>
              <a href={item.source} target="_blank" rel="noreferrer noopener">
                {item.type === 'image' ? 'View on Unsplash' : 'View source'}
              </a>
            </p>
          )}
        </div>
        {score !== undefined && Number.isFinite(score) && (
          <dl className="viewer-score">
            <dt>Relevance</dt>
            <dd>{score.toFixed(3)}</dd>
          </dl>
        )}
      </div>

      {item.type === 'audio' && item.durationSeconds ? (
        <span className="viewer-audio-duration" aria-hidden="true">
          {formatDuration(item.durationSeconds)}
        </span>
      ) : null}
    </div>,
    container,
  );
}
