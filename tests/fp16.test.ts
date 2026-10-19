import { describe, expect, it } from 'vitest';
import { decodeFloat16, encodeFloat16, float16Count } from '../src/ml/fp16';

const half = (bits: number) => {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setUint16(0, bits, true);
  return buffer;
};

describe('float16 decoding', () => {
  it('rejects a buffer with an odd length', () => {
    expect(() => decodeFloat16(new ArrayBuffer(3))).toThrow(/not a multiple of 2/);
    expect(() => float16Count(3)).toThrow();
  });

  it('decodes positive and negative zero', () => {
    const values = decodeFloat16(
      new Uint8Array([...new Uint8Array(half(0x0000)), ...new Uint8Array(half(0x8000))]).buffer,
    );
    expect(values[0]).toBe(0);
    expect(Object.is(values[1], -0)).toBe(true);
  });

  it('decodes the smallest normal number', () => {
    const values = decodeFloat16(half(0x0400));
    expect(values[0]).toBeCloseTo(6.103515625e-5, 12);
  });

  it('decodes the largest subnormal', () => {
    const values = decodeFloat16(half(0x03ff));
    expect(values[0]).toBeCloseTo(1023 * 2 ** -24, 15);
  });

  it('decodes the smallest subnormal', () => {
    const values = decodeFloat16(half(0x0001));
    expect(values[0]).toBeCloseTo(5.960464477539063e-8, 15);
  });

  it('decodes one', () => {
    expect(decodeFloat16(half(0x3c00))[0]).toBe(1);
  });

  it('decodes -2', () => {
    expect(decodeFloat16(half(0xc000))[0]).toBe(-2);
  });

  it('decodes infinity and NaN', () => {
    expect(decodeFloat16(half(0x7c00))[0]).toBe(Infinity);
    expect(decodeFloat16(half(0xfc00))[0]).toBe(-Infinity);
    expect(Number.isNaN(decodeFloat16(half(0x7e00))[0])).toBe(true);
  });

  it('decodes a known value (1.5)', () => {
    expect(decodeFloat16(half(0x3e00))[0]).toBe(1.5);
  });

  it('decodes 65504 (the largest finite half)', () => {
    expect(decodeFloat16(half(0x7bff))[0]).toBe(65504);
  });

  it('decodes an empty buffer into an empty array', () => {
    expect(decodeFloat16(new ArrayBuffer(0))).toHaveLength(0);
  });

  it('decodes a multi value buffer in order', () => {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    [0x3c00, 0x4000, 0xc000, 0x0000].forEach((bits, i) => view.setUint16(i * 2, bits, true));
    expect(Array.from(decodeFloat16(bytes.buffer))).toEqual([1, 2, -2, 0]);
  });
});

describe('float16 encoding', () => {
  it('round-trips representable values', () => {
    for (const value of [0, 1, -1, 0.5, -0.5, 2, 1024, -2048, 6.103515625e-5]) {
      const bits = encodeFloat16(value);
      const decoded = decodeFloat16(half(bits))[0];
      expect(decoded).toBeCloseTo(value, 6);
    }
  });

  it('encodes infinities', () => {
    expect(decodeFloat16(half(encodeFloat16(Infinity)))[0]).toBe(Infinity);
    expect(decodeFloat16(half(encodeFloat16(-Infinity)))[0]).toBe(-Infinity);
  });
});
