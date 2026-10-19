/**
 * The application shell.
 *
 * A port of the recovered `An` component: the atlas, the compact brand, the
 * floating omnibox, the status caption, the viewer, the drop overlay and the
 * camera dialog.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SpatialCanvas } from '../components/SpatialCanvas';
import { SearchOmnibox } from '../components/SearchOmnibox';
import { MediaViewer } from '../components/MediaViewer';
import { UploadOverlay } from '../components/UploadOverlay';
import { CameraDialog } from '../components/CameraDialog';
import { useExploreState } from './useExploreState';
import { useDragDrop } from './useDragDrop';
import { formatDuration } from '../media/catalog';
import type { SpatialField } from '../engine/SpatialField';
import type { MediaItem } from '../media/types';

export interface AppProps {
  items: MediaItem[];
  seed: number;
}

export function App({ items, seed }: AppProps) {
  const state = useExploreState({ items, seed });
  const [cameraOpen, setCameraOpen] = useState(false);
  const controller = useRef<SpatialField | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDrop = useDragDrop((file) => void state.addFile(file), !cameraOpen);

  const reset = useCallback(() => {
    state.reset();
    controller.current?.reset();
  }, [state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (state.selected || cameraOpen || dragDrop.drop) return;
      const target = event.target as HTMLElement | null;
      const inField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (((event.metaKey || event.ctrlKey) && event.key === 'k') || (event.key === '/' && !inField)) {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (event.key === 'Escape') {
        inputRef.current?.blur();
        reset();
        return;
      }
      if (inField) return;
      if (['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
      }
      if (event.key === '+' || event.key === '=') controller.current?.zoomBy(1.2);
      if (event.key === '-') controller.current?.zoomBy(1 / 1.2);
      if (event.key === '0') controller.current?.reset();
      const pan: Record<string, [number, number]> = {
        ArrowLeft: [-220, 0],
        ArrowRight: [220, 0],
        ArrowUp: [0, -180],
        ArrowDown: [0, 180],
      };
      const movement = pan[event.key];
      if (movement) controller.current?.panBy(movement[0], movement[1]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cameraOpen, dragDrop.drop, reset, state.selected]);

  const status = useMemo(() => {
    if (state.recording) return `Recording · ${formatDuration(state.seconds)}`;
    if (state.error) return state.error;
    if (state.modelState.phase === 'ready') {
      if (state.busy) return 'Finding connections…';
      if (state.results) {
        return state.results.length
          ? `${state.results.length} connections · ${Math.round(state.results[0]?.elapsedMs ?? 0)} ms`
          : 'No matches found';
      }
      return '';
    }
    return `${state.modelState.label}${
      state.modelState.progress === undefined ? '' : ` · ${Math.round(state.modelState.progress)}%`
    }`;
  }, [state.busy, state.error, state.modelState, state.recording, state.results, state.seconds]);

  const selectedScore = state.selected ? state.scores?.get(state.selected.id) : undefined;

  const submit = () => {
    const text = state.query.trim();
    if (!text) return;
    void state.search({ type: 'text', text, label: text });
  };

  return (
    <main className={`atlas-app${state.selected ? ' is-presenting' : ''}`}>
      <SpatialCanvas
        items={state.visible}
        scores={state.scores}
        enabled={!cameraOpen && !dragDrop.drop}
        controller={controller}
        onOpen={state.setSelected}
      />

      <header className="topbar" aria-hidden={!!state.selected} inert={!!state.selected}>
        <button className="brand" onClick={reset} aria-label="Embed Anything, reset exploration">
          <span>
            Embed <span className="brand-light">Anything</span>
          </span>
          <span className="brand-subtitle">w/ EmbeddingGemma 2</span>
        </button>
      </header>

      {status && (
        <div className="search-caption" role="status" aria-hidden={!!state.selected} inert={!!state.selected}>
          <span>{status}</span>
          {state.modelState.phase === 'error' && <button onClick={state.retryModel}>Retry</button>}
          {state.results && !state.busy && <button onClick={reset}>Clear</button>}
        </div>
      )}

      {!state.visible.length && (
        <div className="canvas-empty">
          <h2>Nothing to show</h2>
          <p>Clear the search to return to the whole collection.</p>
        </div>
      )}

      <SearchOmnibox
        value={state.query}
        busy={state.busy}
        recording={state.recording}
        disabled={!state.visible.length && !state.query}
        inputRef={inputRef}
        onChange={state.setQuery}
        onSubmit={submit}
        onUpload={(file) => void state.addFile(file)}
        onRecord={() => void state.toggleRecording()}
        onCamera={() => setCameraOpen(true)}
      />

      {state.selected && (
        <MediaViewer
          engine={controller.current!}
          item={state.selected}
          items={state.visible}
          score={selectedScore}
          onClose={() => {
            const engine = controller.current;
            if (engine) engine.close(() => state.setSelected(null));
            else state.setSelected(null);
          }}
          onSelect={state.setSelected}
          onDelete={(item) => {
            state.removeItem(item.id);
            state.setSelected(null);
          }}
        />
      )}

      <UploadOverlay drop={dragDrop.drop} />

      {cameraOpen && (
        <CameraDialog
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => {
            setCameraOpen(false);
            void state.addFile(file, 'Webcam photo');
          }}
        />
      )}
    </main>
  );
}
