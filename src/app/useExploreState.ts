/**
 * The application state: the catalog, the search lifecycle, uploads, recording
 * and the model readiness.
 *
 * A port of the recovered `kn` hook. All the heavy lifting (model loading and
 * ranking) happens in the worker; this hook only orchestrates.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gemma } from '../ml/client';
import type { ModelState } from '../ml/protocol';
import { assetBase, formatDuration } from '../media/catalog';
import { detectMediaType, MAX_FILE_BYTES, probeMedia } from '../media/file-ingest';
import { decodeAudioToMono, readWaveform } from '../media/audio';
import { extractVideoFrames } from '../media/video';
import { seededShuffle } from '../media/shuffle';
import type { LocalItem, MediaItem } from '../media/types';

export interface SearchOutcome {
  item: MediaItem;
  score: number;
  similarity: number;
  elapsedMs: number;
}

export interface ExploreState {
  /** The catalog, in display order. */
  collection: MediaItem[];
  /** The items currently shown: the results, or the whole catalog. */
  visible: MediaItem[];
  /** The calibrated score per item id, when a search is active. */
  scores: Map<string, number> | undefined;
  modelState: ModelState;
  results: SearchOutcome[] | null;
  query: string;
  setQuery: (value: string) => void;
  busy: boolean;
  error: string;
  selected: MediaItem | null;
  setSelected: (item: MediaItem | null) => void;
  recording: boolean;
  seconds: number;
  search: (input: SearchInput) => Promise<boolean>;
  reset: () => void;
  addFile: (file: File, name?: string) => Promise<void>;
  toggleRecording: () => Promise<void>;
  updateItem: (id: string, patch: Partial<MediaItem>) => void;
  removeItem: (id: string) => void;
  retryModel: () => void;
}

export type SearchInput = {
  type: 'text' | 'image' | 'audio' | 'video';
  text?: string;
  file?: Blob;
  item?: MediaItem;
  label?: string;
};

let localIdCounter = 0;
const nextLocalId = () => `local-${Date.now().toString(36)}-${++localIdCounter}`;

export interface UseExploreStateOptions {
  items: MediaItem[];
  seed: number;
}

export function useExploreState({ items, seed }: UseExploreStateOptions): ExploreState {
  const [collection, setCollection] = useState<MediaItem[]>(() => seededShuffle(items, seed));
  const collectionRef = useRef(collection);
  const [modelState, setModelState] = useState<ModelState>(gemma.state);
  const [results, setResults] = useState<SearchOutcome[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const objectUrls = useRef(new Set<string>());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const aliveRef = useRef(true);
  const excludedRef = useRef(new Set<string>());

  useEffect(() => {
    aliveRef.current = true;
    const unsubscribe = gemma.subscribe(setModelState);
    // Capture the current sets so the cleanup closes over them, not over the
    // (mutable) refs.
    const urls = objectUrls.current;
    const stream = streamRef.current;
    const recorder = recorderRef.current;
    gemma.initialize(assetBase()).catch(() => undefined);
    return () => {
      aliveRef.current = false;
      unsubscribe();
      abortRef.current?.abort();
      clearInterval(timerRef.current);
      if (recorder) {
        recorder.onstop = null;
        if (recorder.state === 'recording') recorder.stop();
      }
      stream?.getTracks().forEach((track) => track.stop());
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<MediaItem>) => {
    if (!aliveRef.current) return;
    const current = collectionRef.current.find((item) => item.id === id);
    if (!current) return;
    const merged = { ...current, ...patch } as MediaItem;
    const map = (list: MediaItem[]) => list.map((item) => (item.id === id ? merged : item));
    collectionRef.current = map(collectionRef.current);
    setCollection((list) => map(list));
    setResults((list) => list?.map((entry) => (entry.item.id === id ? { ...entry, item: merged } : entry)) ?? null);
    setSelected((item) => (item?.id === id ? merged : item));
  }, []);

  const readAudioWaveform = useCallback(
    (id: string, file: File) => {
      readWaveform(file, undefined, () => !aliveRef.current).then((reading) => {
        if (!reading) {
          updateItem(id, { waveformStatus: 'unavailable' } as Partial<MediaItem>);
          return;
        }
        updateItem(id, {
          waveform: reading.waveform,
          waveformStatus: 'ready',
          durationSeconds: reading.durationSeconds,
          duration: formatDuration(reading.durationSeconds),
        } as Partial<MediaItem>);
      });
    },
    [updateItem],
  );

  const search = useCallback(async (input: SearchInput): Promise<boolean> => {
    requestIdRef.current++;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError('');
    setBusy(true);
    setSelected(null);
    try {
      await gemma.initialize(assetBase());

      let file: Blob | undefined;
      const item = input.item;
      if (input.type !== 'text' && !item?.embeddingId) {
        file = input.file;
        if (!file && item?.src) {
          const response = await fetch(item.src, { signal: controller.signal });
          if (!response.ok) throw new Error(`Could not load this ${input.type} for search.`);
          file = await response.blob();
        }
        if (!file) throw new Error(`Choose a ${input.type} to search.`);
      }

      const audio = input.type === 'audio' && file ? await decodeAudioToMono(file, controller.signal) : undefined;
      const video = input.type === 'video' && file ? await extractVideoFrames(file, controller.signal) : undefined;

      const embedding = await gemma.embed(
        {
          type: input.type,
          text: input.type === 'text' ? (input.text ?? (item as { text?: string } | undefined)?.text) : undefined,
          image: input.type === 'image' ? file : undefined,
          audio,
          video,
          itemId: item?.embeddingId,
        },
        controller.signal,
      );

      const response = await gemma.search(embedding.values, {
        limit: 60,
        excludedIds: Array.from(excludedRef.current),
        signal: controller.signal,
      });

      if (!aliveRef.current || controller.signal.aborted) return false;
      const byId = new Map(collectionRef.current.map((item) => [item.id, item]));
      setResults(
        response.results
          .filter((entry) => !excludedRef.current.has(entry.id))
          .map((entry) => ({
            item: byId.get(entry.id) ?? (entry as unknown as MediaItem),
            score: entry.score,
            similarity: entry.similarity,
            elapsedMs: embedding.elapsedMs + response.elapsedMs,
          })),
      );
      return true;
    } catch (caught) {
      if (aliveRef.current && !controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'Could not search. Please try again.');
      }
      return false;
    } finally {
      if (aliveRef.current && !controller.signal.aborted) setBusy(false);
    }
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current++;
    abortRef.current?.abort();
    setCollection(collectionRef.current);
    setResults(null);
    setQuery('');
    setBusy(false);
    setError('');
  }, []);

  const removeItem = useCallback((id: string) => {
    excludedRef.current.add(id);
    collectionRef.current = collectionRef.current.filter((item) => item.id !== id);
    setCollection(collectionRef.current);
    setResults((list) => list?.filter((entry) => entry.item.id !== id) ?? null);
    setSelected((item) => (item?.id === id ? null : item));
  }, []);

  const addFile = useCallback(
    async (file: File, name = file.name) => {
      if (file.size > MAX_FILE_BYTES) {
        setError('Choose a file smaller than 100 MB.');
        return;
      }
      const type = detectMediaType(file);
      if (!type) {
        setError('Choose an image, video, audio, or text file.');
        return;
      }
      const token = ++requestIdRef.current;
      abortRef.current?.abort();
      setBusy(true);
      setError('');
      setQuery(name);

      let objectUrl: string | undefined;
      let added = false;
      try {
        const text = type === 'text' ? (await file.text()).slice(0, 3000) : undefined;
        if (type !== 'text') {
          objectUrl = URL.createObjectURL(file);
          objectUrls.current.add(objectUrl);
        }
        const probed = await probeMedia(objectUrl ?? '', type);
        const local: LocalItem = {
          id: nextLocalId(),
          type,
          title: name.replace(/\.[^.]+$/, ''),
          topic: 'Your collection',
          src: objectUrl,
          text,
          local: true,
          aspectRatio: probed.aspectRatio,
          durationSeconds: probed.durationSeconds,
          duration: probed.duration,
          color: type === 'audio' ? '#12363d' : '#526d85',
          waveformStatus: type === 'audio' ? 'loading' : undefined,
        };
        collectionRef.current = [...collectionRef.current, local];
        setCollection(collectionRef.current);
        added = true;
        if (type === 'audio') readAudioWaveform(local.id, file);
        await search({ type, file, text, item: local, label: name });
      } catch (caught) {
        if (aliveRef.current && token === requestIdRef.current) {
          setError(caught instanceof Error ? caught.message : 'Could not read this file.');
          setBusy(false);
        }
      } finally {
        if (objectUrl && !added) {
          URL.revokeObjectURL(objectUrl);
          objectUrls.current.delete(objectUrl);
        }
      }
    },
    [readAudioWaveform, search],
  );

  const toggleRecording = useCallback(async () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Upload audio: microphone recording is unavailable here.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        clearInterval(timerRef.current);
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType });
        void addFile(new File([blob], 'recording', { type: blob.type }), 'Your recording');
      };
      recorder.start();
      setRecording(true);
      setSeconds(0);
      setError('');
      let elapsed = 0;
      timerRef.current = window.setInterval(() => {
        elapsed++;
        setSeconds(elapsed);
        if (elapsed >= 60 && recorder.state === 'recording') recorder.stop();
      }, 1000);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setError('Microphone access was not granted. You can upload audio instead.');
    }
  }, [addFile]);

  const visible = useMemo(() => (results ? results.map((entry) => entry.item) : collection), [collection, results]);
  const scores = useMemo(
    () => (results ? new Map(results.map((entry) => [entry.item.id, entry.score])) : undefined),
    [results],
  );

  return {
    collection,
    visible,
    scores,
    modelState,
    results,
    query,
    setQuery,
    busy,
    error,
    selected,
    setSelected,
    recording,
    seconds,
    search,
    reset,
    addFile,
    toggleRecording,
    updateItem,
    removeItem,
    retryModel: () => {
      gemma.initialize(assetBase()).catch(() => undefined);
    },
  };
}
