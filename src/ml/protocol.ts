/**
 * Typed message protocol between the React client and the EmbeddingGemma 2 worker.
 *
 * The shape mirrors the recovered worker (`Nj` dispatcher / `yj` in-flight map):
 * every request carries a stable numeric id, every response echoes that id, and
 * a `cancel` request aborts an in-flight request by id.
 */

/** Model identifier used by the reference Space. */
export const MODEL_ID = 'onnx-community/embeddinggemma-2-ONNX';

/**
 * Exact retrieval prompt used by the reference Space. Text queries are prefixed
 * with this string verbatim — it is *not* an invented instruction.
 */
export const SEARCH_TASK_PREFIX = 'task: search result | query: ';

/** The warm-up query the reference uses after loading the model. */
export const WARMUP_QUERY = `${SEARCH_TASK_PREFIX}a photograph`;

/** Embedding width of EmbeddingGemma 2. */
export const DIMENSIONS = 768;

/** One decoded video frame. */
export interface VideoFramePayload {
  /** RGBA pixels. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Offset of the frame inside the clip, in seconds. */
  timestamp: number;
}

export interface VideoPayload {
  frames: VideoFramePayload[];
  /** Total clip duration in seconds. */
  duration: number;
}

export interface EmbedInput {
  type: 'text' | 'image' | 'audio' | 'video';
  /** The raw text, for a text query. */
  text?: string;
  /** The image blob, for an image query. */
  image?: Blob;
  /** Mono PCM at 16 kHz, for an audio query. */
  audio?: Float32Array;
  /** Decoded frames, for a video query. */
  video?: VideoPayload;
  /**
   * When set, the stored embedding of that catalog item is reused instead of
   * encoding the media again.
   */
  itemId?: string;
}

export interface InitializeRequest {
  id: number;
  type: 'initialize';
  /** Base URL of the local asset directory, e.g. `http://localhost:5173/local/`. */
  assetBase: string;
}

export interface EmbedRequest {
  id: number;
  type: 'embed';
  input: EmbedInput;
}

export interface SearchRequest {
  id: number;
  type: 'search';
  /** The 768-dimensional, already-normalized query embedding. */
  values: Float32Array;
  limit?: number;
  /** Catalog ids that must not be returned (e.g. the currently open item). */
  excludedIds?: string[];
}

export interface CancelRequest {
  id: number;
  type: 'cancel';
  /** The id of the request to abort. */
  targetId: number;
}

export type WorkerRequest = InitializeRequest | EmbedRequest | SearchRequest | CancelRequest;

/** A request without its id — the shape the client adds the id to. */
export type WorkerRequestBody = Omit<InitializeRequest, 'id'> | Omit<EmbedRequest, 'id'> | Omit<SearchRequest, 'id'>;

export type ModelPhase = 'loading' | 'ready' | 'error';

export interface ModelState {
  phase: ModelPhase;
  label: string;
  backend: 'webgpu';
  /** 0..100 while downloading the model. */
  progress?: number;
  /** Number of indexed media items, once known. */
  count?: number;
}

export interface EmbedResult {
  /** The 768-dimensional normalized embedding. */
  values: Float32Array;
  /** Wall-clock time of the embedding step. */
  elapsedMs: number;
}

export interface SearchResultItem {
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
  /** Calibrated score in [-1, 1]. */
  score: number;
  /** Raw cosine similarity in [-1, 1]. */
  similarity: number;
}

export interface SearchResult {
  results: SearchResultItem[];
  elapsedMs: number;
}

export interface InitializeResult {
  count: number;
  dimensions: number;
  backend: 'webgpu';
}

export interface ErrorPayload {
  name: string;
  message: string;
}

export type WorkerResponse =
  | { type: 'state'; state: ModelState }
  | { type: 'result'; id: number; result: InitializeResult | EmbedResult | SearchResult }
  | { type: 'error'; id: number; error: ErrorPayload };

/** Narrows a worker response to a `result` message. */
export function isResult(response: WorkerResponse): response is Extract<WorkerResponse, { type: 'result' }> {
  return response.type === 'result';
}

/** Narrows a worker response to an `error` message. */
export function isError(response: WorkerResponse): response is Extract<WorkerResponse, { type: 'error' }> {
  return response.type === 'error';
}
