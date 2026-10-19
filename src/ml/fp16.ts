/**
 * Little-endian float16 (IEEE 754 binary16) decoding.
 *
 * The three corpus matrices shipped with the Space are raw float16 blobs:
 *
 *   local/data/embeddings.f16         5000 rows x 768 dims
 *   local/data/audio-embeddings.f16    285 rows x 768 dims
 *   local/data/video-embeddings.f16    258 rows x 768 dims
 *
 * Decoding is intentionally strict: a buffer whose length is not a multiple of
 * two is rejected rather than silently truncated.
 */

/** Number of float16 values in a buffer of `byteLength` bytes. */
export function float16Count(byteLength: number): number {
  if (byteLength % 2 !== 0) {
    throw new Error(`Invalid float16 index length: ${byteLength} is not a multiple of 2.`);
  }
  return byteLength / 2;
}

/**
 * Decodes a little-endian float16 buffer into a `Float32Array`.
 *
 * Handles zeros, signed values, subnormals, normal numbers, infinities and NaN
 * exactly like the reference implementation (`fj` in the recovered worker).
 *
 * @param buffer Raw bytes of the float16 blob.
 * @returns One float32 per float16 value, in the same order.
 */
export function decodeFloat16(buffer: ArrayBuffer | ArrayBufferView): Float32Array {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const count = float16Count(bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const half = view.getUint16(i * 2, true);
    const exponent = (half >>> 10) & 0x1f;
    const fraction = half & 0x3ff;
    let value: number;
    if (exponent === 0) {
      // Subnormal (or zero): fraction * 2^-24
      value = fraction * 2 ** -24;
    } else if (exponent === 31) {
      // Infinity or NaN
      value = fraction ? NaN : Infinity;
    } else {
      // Normal: (1024 + fraction) * 2^(exponent - 25)
      value = (1024 + fraction) * 2 ** (exponent - 25);
    }
    out[i] = half & 0x8000 ? -value : value;
  }
  return out;
}

/** Encodes a float32 value as a little-endian float16 half (round-to-nearest-even). */
export function encodeFloat16(value: number): number {
  if (!Number.isFinite(value)) return value > 0 ? 0x7c00 : 0xfc00;
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const magnitude = Math.abs(value);
  if (magnitude < 2 ** -24) return sign; // underflows to zero
  if (magnitude >= 65520) return sign | 0x7c00; // overflows to infinity
  if (magnitude < 2 ** -14) {
    // Subnormal
    const scaled = Math.round(magnitude / 2 ** -24);
    return sign | scaled;
  }
  let exponent = Math.floor(Math.log2(magnitude));
  let mantissa = magnitude / 2 ** exponent - 1;
  if (mantissa < 0) {
    exponent -= 1;
    mantissa = magnitude / 2 ** exponent - 1;
  }
  let fraction = Math.round(mantissa * 1024);
  if (fraction === 1024) {
    fraction = 0;
    exponent += 1;
  }
  if (exponent > 15) return sign | 0x7c00;
  return sign | ((exponent + 15) << 10) | fraction;
}
