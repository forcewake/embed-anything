/**
 * Typed, cancellable client for the EmbeddingGemma 2 worker.
 *
 * Every request gets a stable numeric id. Results for requests that were
 * aborted, superseded or never sent are dropped, so a slow response can never
 * overwrite a newer one.
 */
import type {
  EmbedInput,
  EmbedResult,
  InitializeResult,
  ModelState,
  SearchResult,
  SearchResultItem,
  WorkerRequest,
  WorkerRequestBody,
  WorkerResponse,
} from './protocol';

export interface SearchOutcome {
  item: SearchResultItem;
  score: number;
  similarity: number;
  /** Embedding time + ranking time, in milliseconds. */
  elapsedMs: number;
}

type Pending = {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  cleanup: () => void;
};

export class GemmaClient {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private listeners = new Set<(state: ModelState) => void>();
  private currentState: ModelState = {
    phase: 'loading',
    label: 'Loading Embedding Gemma 2',
    backend: 'webgpu',
  };
  private initPromise: Promise<InitializeResult> | null = null;

  /** The most recent model state, for rendering before the first update arrives. */
  get state(): ModelState {
    return this.currentState;
  }

  /** Subscribes to model state changes. Returns an unsubscribe function. */
  subscribe(listener: (state: ModelState) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(state: ModelState) {
    this.currentState = state;
    for (const listener of this.listeners) listener(state);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'embedding-gemma-2',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'state') {
        this.setState(message.state);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      pending.cleanup();
      if (message.type === 'result') {
        pending.resolve(message.result as never);
      } else {
        const error = new Error(message.error.message);
        error.name = message.error.name;
        pending.reject(error);
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Embedding Gemma 2 could not start. Please retry.');
      for (const pending of this.pending.values()) {
        pending.cleanup();
        pending.reject(error);
      }
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
      this.initPromise = null;
      this.setState({ phase: 'error', label: error.message, backend: 'webgpu' });
    };
    this.worker = worker;
    return worker;
  }

  private send<T>(request: WorkerRequestBody, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const worker = this.ensureWorker();
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id);
        worker.postMessage({ id: ++this.nextId, type: 'cancel', targetId: id } satisfies WorkerRequest);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      this.pending.set(id, { resolve: resolve as (value: never) => void, reject, cleanup });
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.postMessage({ ...request, id } as WorkerRequest);
    });
  }

  /** Loads the model + corpus exactly once per client instance. */
  initialize(assetBase: string): Promise<InitializeResult> {
    if (!this.initPromise) {
      this.initPromise = this.send<InitializeResult>({ type: 'initialize', assetBase }).catch((error) => {
        this.initPromise = null;
        throw error;
      });
    }
    return this.initPromise;
  }

  /** Embeds a text / image / audio / video query. */
  embed(input: EmbedInput, signal?: AbortSignal): Promise<EmbedResult> {
    return this.send<EmbedResult>({ type: 'embed', input }, signal);
  }

  /** Runs the exact cosine search over the corpus. */
  async search(
    values: Float32Array,
    options: { limit?: number; excludedIds?: string[]; signal?: AbortSignal } = {},
  ): Promise<SearchResult> {
    return this.send<SearchResult>(
      {
        type: 'search',
        values,
        limit: options.limit ?? 60,
        excludedIds: options.excludedIds,
      },
      options.signal,
    );
  }

  /** Terminates the worker and rejects every in-flight request. */
  dispose() {
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(new Error('The Gemma client was disposed.'));
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.initPromise = null;
    this.listeners.clear();
  }
}

/** The single client used by the application. */
export const gemma = new GemmaClient();
