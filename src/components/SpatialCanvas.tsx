/**
 * The React bridge to the spatial field.
 *
 * The field itself is a plain class that owns the DOM and the WebGL state;
 * React only hands it the item list and the coarse UI events.
 */
import { useEffect, useRef } from 'react';
import { SpatialField } from '../engine/SpatialField';
import type { MediaItem } from '../media/types';

export interface SpatialCanvasProps {
  items: MediaItem[];
  scores?: Map<string, number>;
  enabled: boolean;
  controller: React.MutableRefObject<SpatialField | null>;
  onOpen: (item: MediaItem) => void;
}

export function SpatialCanvas({ items, scores, enabled, controller, onOpen }: SpatialCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handlers = useRef({ onOpen });
  handlers.current.onOpen = onOpen;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const field = new SpatialField(host, {
      items,
      scores,
      onOpen: (item) => handlers.current.onOpen(item),
    });
    controller.current = field;
    return () => {
      field.destroy();
      controller.current = null;
    };
    // The field is created once; item changes are pushed through `setItems`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);

  useEffect(() => {
    controller.current?.setItems(items, scores);
  }, [items, scores, controller]);

  useEffect(() => {
    controller.current?.setEnabled(enabled);
  }, [enabled, controller]);

  return (
    <div
      ref={hostRef}
      className="atlas-host field"
      aria-label="Media atlas. Drag to explore, scroll or pinch to zoom."
    />
  );
}
