/**
 * The drag & drop ingestion hook.
 *
 * Port of the recovered `nn` hook: it watches the window for file drags, shows
 * a full-screen acceptance state and finally hands the file over.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupportedDataTransfer } from '../media/file-ingest';
import type { DropState } from '../components/UploadOverlay';

export interface DragDrop {
  drop: DropState | null;
  receive: (file: File) => void;
}

export function useDragDrop(onFile: (file: File) => void, enabled = true): DragDrop {
  const [drop, setDrop] = useState<DropState | null>(null);
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;
  const depth = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const objectUrl = useRef<string | undefined>(undefined);

  const releaseObjectUrl = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = undefined;
  }, []);

  const receive = useCallback(
    (file: File) => {
      depth.current = 0;
      clearTimeout(timer.current);
      releaseObjectUrl();
      if (!enabled) {
        setDrop(null);
        onFileRef.current(file);
        return;
      }
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        objectUrl.current = URL.createObjectURL(file);
      }
      setDrop({ phase: 'received', file, preview: objectUrl.current });
      const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 480;
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        setDrop(null);
        releaseObjectUrl();
        onFileRef.current(file);
      }, delay);
    },
    [enabled, releaseObjectUrl],
  );

  useEffect(() => {
    if (!enabled) return;
    const onDragEnter = (event: DragEvent) => {
      if (event.dataTransfer && isSupportedDataTransfer(event.dataTransfer)) {
        event.preventDefault();
        depth.current++;
        setDrop((current) => (current?.phase === 'received' ? current : { phase: 'dragging', file: new File([], '') }));
      }
    };
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = isSupportedDataTransfer(event.dataTransfer) ? 'copy' : 'none';
    };
    const clear = () => {
      depth.current = 0;
      setDrop((current) => (current?.phase === 'dragging' ? null : current));
    };
    const onDragLeave = (event: DragEvent) => {
      depth.current = Math.max(0, depth.current - 1);
      const outside =
        !depth.current ||
        (event.relatedTarget == null &&
          (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight));
      if (outside) clear();
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      clear();
      if (!enabled) return;
      const files = Array.from(event.dataTransfer.files);
      const file = files.find((candidate) => candidate.size > 0) ?? files[0];
      if (file) receive(file);
    };
    const onDragEnd = () => clear();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onDragEnd);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onDragEnd);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, receive]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      releaseObjectUrl();
    },
    [releaseObjectUrl],
  );

  return { drop, receive };
}
