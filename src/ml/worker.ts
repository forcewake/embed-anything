/**
 * The EmbeddingGemma 2 worker.
 *
 * Owns the whole model lifecycle:
 *   - loads the processor + the q4 WebGPU model once,
 *   - loads and validates the three local float16 corpus matrices,
 *   - embeds text / image / audio / video queries,
 *   - runs the exact cosine ranker.
 *
 * Nothing here touches the DOM; the worker only speaks the protocol in
 * `src/ml/protocol.ts`.
 */
import { AutoModel, AutoProcessor, env, RawImage, RawVideo, RawVideoFrame, Tensor } from '@huggingface/transformers';
import { decodeFloat16 } from './fp16';
import {
  DIMENSIONS,
  MODEL_ID,
  SEARCH_TASK_PREFIX,
  WARMUP_QUERY,
  type EmbedInput,
  type EmbedResult,
  type InitializeResult,
  type ModelState,
  type SearchResult,
  type SearchResultItem,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';
import { MAX_RESULTS, normalizeCorpus, normalizeVector, rankEmbeddings } from './similarity';

const ORT_WASM_MODULE = 'ort-wasm-simd-threaded.asyncify';

/** The catalog metadata that the worker needs in order to answer a search. */
interface CatalogEntry {
  id: string;
  type: 'image' | 'audio' | 'video' | 'text';
  title: string;
  description?: string;
  topic?: string;
  thumbnail?: string;
  src?: string;
  poster?: string;
  aspectRatio: number;
  source?: string;
  durationSeconds?: number;
  duration?: string;
  waveform?: number[];
  color?: string;
  localFile?: string;
}

interface CatalogCollection {
  embeddingFile: string;
  count: number;
  items: CatalogEntry[];
}

interface Catalog {
  dimensions: number;
  total: number;
  collections: { image: CatalogCollection; audio: CatalogCollection; video: CatalogCollection };
}

interface CorpusEntry {
  id: string;
  type: 'image' | 'audio' | 'video' | 'text';
}

/** Mutable worker-side state. */
const state = {
  assetBase: '',
  catalog: null as Catalog | null,
  processor: null as Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null,
  model: null as Awaited<ReturnType<typeof AutoModel.from_pretrained>> | null,
  /** Concatenated corpus: images ++ audio ++ video, L2-normalized. */
  embeddings: null as Float32Array | null,
  modalities: [] as string[],
  metadata: [] as CorpusEntry[],
  byId: new Map<string, number>(),
};

let loading: Promise<void> | null = null;

/** In-flight requests, so a `cancel` message can abort one. */
const inFlight = new Map<number, { cancelled: boolean; complete: boolean }>();

function post(message: WorkerResponse, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(message, transfer ?? []);
}

function report(phase: ModelState['phase'], label: string, progress?: number) {
  const next: ModelState = { phase, label, backend: 'webgpu' };
  if (progress !== undefined) next.progress = progress;
  if (state.metadata.length) next.count = state.metadata.length;
  post({ type: 'state', state: next });
}

function cancelledError(): Error {
  const error = new Error('The Gemma request was cancelled.');
  error.name = 'AbortError';
  return error;
}

function assertNotCancelled(request: { cancelled: boolean }) {
  if (request.cancelled) throw cancelledError();
}

/** Converts unknown failures into readable, recoverable messages. */
function readableError(error: unknown): Error {
  if (error instanceof Error) {
    if (error.name === 'TypeError' && /fetch|network|load failed/i.test(error.message)) {
      return new Error('Could not load Embedding Gemma 2. Check your connection and retry.');
    }
    return error;
  }
  return new Error(typeof error === 'string' ? error : 'Gemma search could not complete.');
}

/**
 * Points ONNX Runtime at the locally hosted WASM sidecars.
 *
 * The reference ships `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` next to the
 * app so no CDN is required at runtime.
 */
function configureRuntime(assetBase: string) {
  if (state.assetBase && state.assetBase !== assetBase) {
    throw new Error('Search assets are already configured.');
  }
  state.assetBase = assetBase;
  const wasm = env.backends.onnx?.wasm;
  if (!wasm) throw new Error('The local ONNX runtime is unavailable.');
  wasm.numThreads = 1;
  wasm.wasmPaths = {
    mjs: new URL(`runtime/${ORT_WASM_MODULE}.mjs`, assetBase).href,
    wasm: new URL(`runtime/${ORT_WASM_MODULE}.wasm`, assetBase).href,
  };
}

/** Downloads and decodes one float16 corpus matrix, validating its exact size. */
async function loadIndex(file: string, rows: number): Promise<Float32Array> {
  const response = await fetch(new URL(`data/${file}`, state.assetBase));
  if (!response.ok) throw new Error(`Local index unavailable: ${file} (${response.status}).`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== rows * DIMENSIONS * 2) {
    throw new Error(`The ${file} index does not match its manifest.`);
  }
  return normalizeCorpus(decodeFloat16(buffer));
}

/** Loads the catalog metadata that accompanies the embedding matrices. */
async function loadCatalog(): Promise<Catalog> {
  const response = await fetch(new URL('catalog.json', state.assetBase));
  if (!response.ok) throw new Error(`Local catalog unavailable (${response.status}).`);
  return (await response.json()) as Catalog;
}

/**
 * Loads (once) the processor, the q4 WebGPU model and the three corpus matrices,
 * then warms the model up with a short text query.
 */
async function ensureLoaded(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    if (!state.assetBase) throw new Error('Initialize Embedding Gemma 2 before searching.');
    report('loading', 'Loading Embedding Gemma 2');

    const catalog = await loadCatalog();
    state.catalog = catalog;
    const collections = [catalog.collections.image, catalog.collections.audio, catalog.collections.video];

    const results = await Promise.allSettled([
      AutoProcessor.from_pretrained(MODEL_ID),
      AutoModel.from_pretrained(MODEL_ID, {
        dtype: 'q4',
        device: 'webgpu',
        progress_callback: (event) => {
          if (event.status === 'progress_total') report('loading', 'Loading Embedding Gemma 2', event.progress);
        },
      }),
      ...collections.map((collection) => loadIndex(collection.embeddingFile, collection.count)),
    ]);

    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected && rejected.status === 'rejected') {
      // Release the model if the processor failed to load.
      if (results[1].status === 'fulfilled') {
        await results[1].value.dispose().catch(() => undefined);
      }
      throw rejected.reason;
    }
    const unwrap = <T>(result: PromiseSettledResult<T>): T => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    };

    state.processor = unwrap(results[0]);
    state.model = unwrap(results[1]);
    const imageVectors = unwrap(results[2]);
    const audioVectors = unwrap(results[3]);
    const videoVectors = unwrap(results[4]);

    const merged = new Float32Array(imageVectors.length + audioVectors.length + videoVectors.length);
    merged.set(imageVectors, 0);
    merged.set(audioVectors, imageVectors.length);
    merged.set(videoVectors, imageVectors.length + audioVectors.length);
    state.embeddings = merged;

    // The row order of the combined matrix is images ++ audio ++ video.
    const metadata: CorpusEntry[] = [];
    const modalities: string[] = [];
    for (const collection of collections) {
      for (const item of collection.items) {
        metadata.push({ id: item.id, type: item.type });
        modalities.push(item.type);
      }
    }
    state.metadata = metadata;
    state.modalities = modalities;
    state.byId = new Map(metadata.map((entry, index) => [entry.id, index]));

    report('loading', 'Warming up Embedding Gemma 2', 100);
    try {
      await runModel(state.model, await state.processor(WARMUP_QUERY));
    } catch (error) {
      await state.model.dispose().catch(() => undefined);
      throw error;
    }
    report('ready', 'Embedding Gemma 2 ready');
  })().catch((error) => {
    loading = null;
    const readable = readableError(error);
    report('error', readable.message);
    throw readable;
  });
  return loading;
}

/** Recursively disposes every tensor reachable from `value`. */
function disposeTensors(value: unknown, seen: Set<unknown> = new Set()) {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Tensor) {
    if (!seen.has(value.ort_tensor)) {
      seen.add(value.ort_tensor);
      try {
        value.dispose();
      } catch {
        /* the tensor was already released */
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) disposeTensors(item, seen);
  } else if (!ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
    for (const item of Object.values(value)) disposeTensors(item, seen);
  }
}

/** Runs the model and extracts the 768-dimensional `sentence_embedding`. */
async function runModel(
  model: NonNullable<typeof state.model>,
  inputs: unknown,
  request?: { cancelled: boolean },
): Promise<Float32Array> {
  let output: unknown;
  try {
    if (request) assertNotCancelled(request);
    output = await model(inputs as never);
    if (request) assertNotCancelled(request);
    const tensor = (output as { sentence_embedding?: unknown } | undefined)?.sentence_embedding;
    if (!(tensor instanceof Tensor)) throw new Error('Gemma returned an invalid embedding.');
    const row = tensor.tolist()[0] as number[];
    return normalizeVector(Float32Array.from(row));
  } finally {
    disposeTensors([inputs, output]);
  }
}

/** Builds the processor inputs for a query. */
async function buildInputs(input: EmbedInput): Promise<unknown> {
  const processor = state.processor;
  if (!processor) throw new Error('Initialize Embedding Gemma 2 before searching.');
  if (input.type === 'text') {
    const text = input.text?.trim();
    if (!text) throw new Error('Enter text to search.');
    return processor(`${SEARCH_TASK_PREFIX}${text}`);
  }
  if (input.type === 'image') {
    if (!(input.image instanceof Blob)) throw new Error('Choose a readable image to search.');
    return processor(null, await RawImage.fromBlob(input.image));
  }
  if (input.type === 'audio') {
    if (!(input.audio instanceof Float32Array) || !input.audio.length) {
      throw new Error('Choose a readable audio clip to search.');
    }
    return processor(null, null, input.audio);
  }
  if (input.type === 'video') {
    if (!input.video?.frames.length) throw new Error('Choose a readable video to search.');
    const frames = input.video.frames.map(
      (frame) => new RawVideoFrame(new RawImage(frame.data, frame.width, frame.height, 4), frame.timestamp),
    );
    return processor(null, null, null, new RawVideo(frames, input.video.duration));
  }
  throw new Error(`Choose a readable ${input.type} to search.`);
}

/** Embeds a query, or re-uses the stored embedding of an already indexed item. */
async function embed(input: EmbedInput, request: { cancelled: boolean }): Promise<EmbedResult> {
  await ensureLoaded();
  assertNotCancelled(request);

  if (input.itemId) {
    const started = performance.now();
    const row = state.byId.get(input.itemId);
    if (row === undefined) throw new Error('This item is not in the local Gemma index.');
    const embeddings = state.embeddings!;
    return {
      values: embeddings.slice(row * DIMENSIONS, (row + 1) * DIMENSIONS),
      elapsedMs: performance.now() - started,
    };
  }

  const started = performance.now();
  const inputs = await buildInputs(input);
  assertNotCancelled(request);
  const values = await runModel(state.model!, inputs, request);
  return { values, elapsedMs: performance.now() - started };
}

/** Serializes model calls: ONNX Runtime Web does not support concurrent sessions. */
let inferenceChain: Promise<unknown> = Promise.resolve();
function serialize<T>(request: { cancelled: boolean }, task: () => Promise<T>): Promise<T> {
  const next = inferenceChain.then(async () => {
    assertNotCancelled(request);
    const result = await task();
    assertNotCancelled(request);
    return result;
  });
  inferenceChain = next.catch(() => undefined);
  return next;
}

/** Runs the exact cosine search over the corpus. */
async function search(
  values: Float32Array,
  limit: number | undefined,
  excludedIds: string[] | undefined,
  request: { cancelled: boolean },
): Promise<SearchResult> {
  if (!(values instanceof Float32Array)) throw new Error('Search requires a Gemma embedding.');
  await ensureLoaded();
  assertNotCancelled(request);

  const started = performance.now();
  const excluded = new Set<number>();
  for (const id of excludedIds ?? []) {
    const row = state.byId.get(id);
    if (row !== undefined) excluded.add(row);
  }
  const ranked = rankEmbeddings(values, state.embeddings!, state.modalities, {
    dimensions: DIMENSIONS,
    limit: Math.min(limit ?? MAX_RESULTS, MAX_RESULTS),
    excludedIndices: excluded,
  });

  const catalog = state.catalog!;
  const byId = new Map<string, CatalogEntry>();
  for (const collection of Object.values(catalog.collections)) {
    for (const item of collection.items) byId.set(item.id, item);
  }

  const results: SearchResultItem[] = ranked.map(({ index, score, similarity }) => {
    const entry = state.metadata[index];
    const source = byId.get(entry.id);
    return {
      ...(source ?? { id: entry.id, type: entry.type, title: entry.id, aspectRatio: 4 / 3 }),
      score,
      similarity,
    };
  });

  return { results, elapsedMs: performance.now() - started };
}

function complete(request: { complete: boolean }, id: number, result: unknown, transfer?: Transferable[]) {
  if (request.complete) return;
  request.complete = true;
  inFlight.delete(id);
  post({ type: 'result', id, result: result as never }, transfer);
}

function fail(request: { complete: boolean }, id: number, error: unknown) {
  if (request.complete) return;
  request.complete = true;
  inFlight.delete(id);
  const readable = readableError(error);
  post({ type: 'error', id, error: { name: readable.name, message: readable.message } });
}

async function dispatch(request: WorkerRequest, entry: { cancelled: boolean; complete: boolean }) {
  try {
    switch (request.type) {
      case 'initialize': {
        configureRuntime(request.assetBase);
        await ensureLoaded();
        const result: InitializeResult = {
          count: state.metadata.length,
          dimensions: DIMENSIONS,
          backend: 'webgpu',
        };
        complete(entry, request.id, result);
        break;
      }
      case 'embed': {
        const result = await serialize(entry, () => embed(request.input, entry));
        complete(entry, request.id, result, [result.values.buffer]);
        break;
      }
      case 'search': {
        const result = await search(request.values, request.limit, request.excludedIds, entry);
        complete(entry, request.id, result);
        break;
      }
      default: {
        throw new Error(`Unknown request type: ${String((request as { type?: string }).type)}`);
      }
    }
  } catch (error) {
    fail(entry, request.id, error);
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    const target = inFlight.get(request.targetId);
    if (target) {
      target.cancelled = true;
      fail(target, request.targetId, cancelledError());
    }
    return;
  }
  if (inFlight.has(request.id)) {
    post({
      type: 'error',
      id: request.id,
      error: { name: 'Error', message: 'A Gemma request with this ID is already running.' },
    });
    return;
  }
  const entry = { cancelled: false, complete: false };
  inFlight.set(request.id, entry);
  void dispatch(request, entry);
});

// The reference disables the referrer for every model download.
const globalFetch = self.fetch.bind(self);
self.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
  globalFetch(input as RequestInfo, { ...init, referrerPolicy: 'no-referrer' });
