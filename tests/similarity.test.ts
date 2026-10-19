import { describe, expect, it } from 'vitest';
import {
  AUDIO_SIMILARITY_OFFSET,
  DIMENSIONS,
  MAX_RESULTS,
  MIN_SCORE,
  calibratedScore,
  l2Norm,
  normalizeCorpus,
  normalizeVector,
  rankEmbeddings,
} from '../src/ml/similarity';

describe('score calibration', () => {
  it('uses the raw cosine for images and videos', () => {
    expect(calibratedScore(0.8, 'image')).toBeCloseTo(0.8, 10);
    expect(calibratedScore(0.8, 'video')).toBeCloseTo(0.8, 10);
  });

  it('offsets audio rows by 0.08', () => {
    expect(calibratedScore(0.8, 'audio')).toBeCloseTo((0.8 - 0.08) / 0.92, 10);
    expect(AUDIO_SIMILARITY_OFFSET).toBe(0.08);
  });

  it('clamps to [-1, 1]', () => {
    expect(calibratedScore(5, 'image')).toBe(1);
    expect(calibratedScore(-5, 'image')).toBe(-1);
    expect(calibratedScore(5, 'audio')).toBe(1);
  });
});

describe('normalization', () => {
  it('rejects a vector with the wrong length', () => {
    expect(() => normalizeVector(new Float32Array(3))).toThrow(/must contain 768 values/);
  });

  it('rejects a non-finite value', () => {
    const values = new Float32Array(DIMENSIONS).fill(0);
    values[10] = Number.NaN;
    expect(() => normalizeVector(values)).toThrow(/invalid value/);
  });

  it('rejects a zero vector', () => {
    expect(() => normalizeVector(new Float32Array(DIMENSIONS))).toThrow(/no usable values/);
  });

  it('produces a unit vector', () => {
    const values = new Float32Array(DIMENSIONS).fill(0);
    values[0] = 3;
    values[1] = 4;
    normalizeVector(values);
    expect(Math.hypot(...Array.from(values))).toBeCloseTo(1, 6);
  });

  it('normalizes every row of a corpus', () => {
    const corpus = new Float32Array(DIMENSIONS * 2);
    corpus[0] = 3;
    corpus[1] = 4;
    corpus[DIMENSIONS] = 1;
    normalizeCorpus(corpus);
    expect(Math.hypot(corpus[0], corpus[1])).toBeCloseTo(1, 6);
    expect(corpus[DIMENSIONS]).toBeCloseTo(1, 6);
  });

  it('rejects a corpus that is not a multiple of the dimensions', () => {
    expect(() => normalizeCorpus(new Float32Array(DIMENSIONS + 1))).toThrow(/Invalid media embedding dimensions/);
  });

  it('computes the norm of a slice', () => {
    expect(l2Norm(new Float32Array([3, 4, 100]), 0, 2)).toBe(5);
  });
});

describe('exact cosine search', () => {
  const build = (rows: number[], dims = 2) => {
    const corpus = new Float32Array(rows.length * dims);
    rows.forEach((value, i) => {
      corpus[i * dims] = value;
      corpus[i * dims + 1] = Math.sqrt(Math.max(0, 1 - value * value));
    });
    return corpus;
  };

  it('ranks by descending calibrated score', () => {
    const corpus = build([1, 0.9, 0.1]);
    const results = rankEmbeddings(new Float32Array([1, 0]), corpus, ['image', 'image', 'image'], { dimensions: 2 });
    expect(results.map((r) => r.index)).toEqual([0, 1]);
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it('discards scores below the 0.65 threshold', () => {
    const corpus = build([1, 0.5]);
    const results = rankEmbeddings(new Float32Array([1, 0]), corpus, ['image', 'image'], { dimensions: 2 });
    expect(results).toHaveLength(1);
    expect(results[0].index).toBe(0);
    expect(MIN_SCORE).toBe(0.65);
  });

  it('applies the audio offset to audio rows only', () => {
    const corpus = build([0.7, 0.7]);
    const results = rankEmbeddings(new Float32Array([1, 0]), corpus, ['audio', 'image'], { dimensions: 2 });
    const audio = results.find((r) => r.index === 0)!;
    const image = results.find((r) => r.index === 1)!;
    expect(audio.score).toBeCloseTo((0.7 - 0.08) / 0.92, 6);
    expect(image.score).toBeCloseTo(0.7, 6);
  });

  it('honours excluded indices', () => {
    const corpus = build([1, 0.9]);
    const results = rankEmbeddings(new Float32Array([1, 0]), corpus, ['image', 'image'], {
      dimensions: 2,
      excludedIndices: new Set([0]),
    });
    expect(results.map((r) => r.index)).toEqual([1]);
  });

  it('breaks ties by ascending corpus index', () => {
    const corpus = build([0.9, 0.9, 0.9]);
    const results = rankEmbeddings(new Float32Array([1, 0]), corpus, ['image', 'image', 'image'], { dimensions: 2 });
    expect(results.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it('never returns more than 60 results', () => {
    const rows = Array.from({ length: 200 }, () => 0.99);
    const corpus = build(rows);
    const modalities = Array.from({ length: 200 }, () => 'image');
    const results = rankEmbeddings(new Float32Array([1, 0]), corpus, modalities, { dimensions: 2 });
    expect(results).toHaveLength(MAX_RESULTS);
    expect(MAX_RESULTS).toBe(60);
  });

  it('rejects an invalid limit', () => {
    const corpus = build([1]);
    expect(() => rankEmbeddings(new Float32Array([1, 0]), corpus, ['image'], { dimensions: 2, limit: 61 })).toThrow(
      /between 1 and 60/,
    );
  });

  it('rejects a modality count that does not match the rows', () => {
    const corpus = build([1]);
    expect(() => rankEmbeddings(new Float32Array([1, 0]), corpus, ['image', 'image'], { dimensions: 2 })).toThrow(
      /do not match/,
    );
  });

  it('rejects a query with the wrong length', () => {
    const corpus = build([1]);
    expect(() => rankEmbeddings(new Float32Array([1, 0, 0]), corpus, ['image'], { dimensions: 2 })).toThrow(
      /must contain 2 values/,
    );
  });

  it('rejects a non-finite corpus value', () => {
    const corpus = build([1]);
    corpus[0] = Number.NaN;
    expect(() => rankEmbeddings(new Float32Array([1, 0]), corpus, ['image'], { dimensions: 2 })).toThrow(
      /invalid embedding/,
    );
  });

  it('returns the raw similarity alongside the calibrated score', () => {
    const corpus = build([0.8]);
    const [result] = rankEmbeddings(new Float32Array([1, 0]), corpus, ['image'], { dimensions: 2 });
    expect(result.similarity).toBeCloseTo(0.8, 5);
    expect(result.score).toBeCloseTo(0.8, 5);
  });
});
