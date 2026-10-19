/**
 * Exact cosine retrieval over the normalized EmbeddingGemma 2 corpus.
 *
 * This is a faithful port of the recovered worker functions:
 *   `QA` -> calibratedScore
 *   `ij` -> rankEmbeddings
 *   `tj` -> normalizeVector
 *   `nj` -> normalizeCorpus
 *
 * The search is an **exact** O(rows x dimensions) dot-product scan. There is no
 * approximate nearest-neighbour index and no vector database.
 */

/** Embedding width of EmbeddingGemma 2. */
export const DIMENSIONS = 768;

/** Calibrated scores below this value are discarded. */
export const MIN_SCORE = 0.65;

/** Maximum number of results a single search may return. */
export const MAX_RESULTS = 60;

/** Audio rows get a similarity offset before calibration. */
export const AUDIO_SIMILARITY_OFFSET = 0.08;

export type Modality = 'image' | 'audio' | 'video' | 'text';

/**
 * Calibrates a raw cosine similarity.
 *
 * Audio embeddings are systematically less similar than image/video ones, so
 * they are stretched: `clamp((cosine - 0.08) / 0.92, -1, 1)`. Other modalities
 * use the raw cosine.
 */
export function calibratedScore(cosineSimilarity: number, modality: Modality | string): number {
  const offset = modality === 'audio' ? AUDIO_SIMILARITY_OFFSET : 0;
  return Math.max(-1, Math.min(1, (cosineSimilarity - offset) / (1 - offset)));
}

/** Computes the L2 norm of `values[start .. start + length)`, rejecting non-finite values. */
export function l2Norm(values: ArrayLike<number>, start = 0, length = values.length): number {
  let sum = 0;
  for (let i = start; i < start + length; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) throw new Error('The embedding contains an invalid value.');
    sum += value * value;
  }
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('The embedding has no usable values.');
  return norm;
}

/**
 * L2-normalizes a single embedding in place.
 *
 * @throws if the vector does not have exactly `dimensions` values.
 */
export function normalizeVector(values: Float32Array, dimensions = DIMENSIONS): Float32Array {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('Embedding dimensions must be a positive integer.');
  }
  if (values.length !== dimensions) {
    throw new Error(`Gemma embeddings must contain ${dimensions} values.`);
  }
  const norm = l2Norm(values, 0, dimensions);
  for (let i = 0; i < values.length; i++) values[i] /= norm;
  return values;
}

/**
 * L2-normalizes every row of a corpus in place.
 *
 * @throws if the corpus length is not a multiple of `dimensions`.
 */
export function normalizeCorpus(values: Float32Array, dimensions = DIMENSIONS): Float32Array {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('Embedding dimensions must be a positive integer.');
  }
  if (!values.length || values.length % dimensions !== 0) {
    throw new Error('Invalid media embedding dimensions.');
  }
  for (let offset = 0; offset < values.length; offset += dimensions) {
    const norm = l2Norm(values, offset, dimensions);
    for (let i = 0; i < dimensions; i++) values[offset + i] /= norm;
  }
  return values;
}

export interface RankedRow {
  /** Row index inside the corpus. */
  index: number;
  /** Calibrated score in [-1, 1]; only scores >= `minScore` are returned. */
  score: number;
  /** Raw cosine similarity in [-1, 1]. */
  similarity: number;
}

/** True when `a` ranks *worse* than `b` (lower score, or same score and higher index). */
function ranksWorse(a: RankedRow, b: RankedRow): boolean {
  return a.score < b.score || (a.score === b.score && a.index > b.index);
}

export interface RankOptions {
  dimensions?: number;
  limit?: number;
  excludedIndices?: Set<number>;
  minScore?: number;
}

/**
 * Exact top-K cosine search over a normalized corpus.
 *
 * Uses a bounded min-heap of `limit` entries so the memory cost is O(limit),
 * not O(rows). The final ordering is by descending calibrated score, ties
 * broken by ascending corpus index (i.e. by the original catalog order).
 */
export function rankEmbeddings(
  query: Float32Array,
  corpus: Float32Array,
  modalities: readonly string[],
  options: RankOptions = {},
): RankedRow[] {
  const {
    dimensions = DIMENSIONS,
    limit = MAX_RESULTS,
    excludedIndices = new Set<number>(),
    minScore = MIN_SCORE,
  } = options;

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('Embedding dimensions must be a positive integer.');
  }
  if (query.length !== dimensions) {
    throw new Error(`Gemma embeddings must contain ${dimensions} values.`);
  }
  if (!corpus.length || corpus.length % dimensions !== 0) {
    throw new Error('Invalid media embedding dimensions.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
    throw new Error('Search limit must be between 1 and 60.');
  }
  const rows = corpus.length / dimensions;
  if (modalities.length !== rows) {
    throw new Error('The media modalities do not match the embedding rows.');
  }

  const queryNorm = l2Norm(query, 0, dimensions);
  const heap: RankedRow[] = [];
  const capacity = Math.min(limit, rows);

  for (let index = 0; index < rows; index++) {
    if (excludedIndices.has(index)) continue;
    const offset = index * dimensions;
    let dot = 0;
    for (let j = 0; j < dimensions; j++) dot += query[j] * corpus[offset + j];
    if (!Number.isFinite(dot)) throw new Error('The media database contains an invalid embedding.');
    const similarity = Math.max(-1, Math.min(1, dot / queryNorm));
    const score = calibratedScore(similarity, modalities[index]);
    if (score < minScore) continue;
    const candidate: RankedRow = { index, score, similarity };

    if (heap.length < capacity) {
      heap.push(candidate);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if (!ranksWorse(heap[i], heap[parent])) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        i = parent;
      }
    } else if (ranksWorse(heap[0], candidate)) {
      heap[0] = candidate;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        if (left >= heap.length) break;
        const right = left + 1;
        const smallest = right < heap.length && ranksWorse(heap[right], heap[left]) ? right : left;
        if (!ranksWorse(heap[smallest], heap[i])) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
  }

  return heap.sort((a, b) => b.score - a.score || a.index - b.index);
}
