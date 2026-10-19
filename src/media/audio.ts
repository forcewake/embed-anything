/**
 * Audio helpers: decoding to the model's input format and waveform rendering.
 */

/** The sampling rate the EmbeddingGemma 2 audio encoder expects. */
export const AUDIO_SAMPLE_RATE = 16_000;

/** Maximum length of an audio query, in seconds. */
export const MAX_AUDIO_SECONDS = 60;

/**
 * Decodes an audio file to mono PCM at 16 kHz.
 *
 * @throws if the clip is longer than 60 seconds or cannot be decoded.
 */
export async function decodeAudioToMono(blob: Blob, signal?: AbortSignal): Promise<Float32Array> {
  signal?.throwIfAborted();
  const context = new OfflineAudioContext(1, 1, AUDIO_SAMPLE_RATE);
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  signal?.throwIfAborted();
  if (decoded.duration > MAX_AUDIO_SECONDS) {
    throw new Error(`Audio search supports clips up to ${MAX_AUDIO_SECONDS} seconds.`);
  }
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
  }
  return mono;
}

export interface WaveformReading {
  /** Normalized 0..1 samples. */
  waveform: number[];
  durationSeconds: number;
}

/**
 * Reads a coarse waveform from an audio file.
 *
 * The reference caps the work at 24 MB / 30 minutes and decodes with a 12 kHz
 * offline context, which is fast enough to run on upload.
 */
let waveformChain: Promise<unknown> = Promise.resolve();

export function readWaveform(
  blob: Blob,
  expectedDuration?: number,
  isCancelled: () => boolean = () => false,
): Promise<WaveformReading | undefined> {
  const task = waveformChain.then(async () => {
    if (isCancelled() || blob.size > 25_165_824 || (expectedDuration ?? 0) > 1800) return undefined;
    try {
      const buffer = await blob.arrayBuffer();
      if (isCancelled()) return undefined;
      const decoded = await new OfflineAudioContext(1, 1, 12_000).decodeAudioData(buffer);
      if (isCancelled()) return undefined;
      return {
        waveform: computeWaveform(
          Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i)),
        ),
        durationSeconds: decoded.duration,
      };
    } catch {
      return undefined;
    }
  });
  waveformChain = task.catch(() => undefined);
  return task;
}

/**
 * Reduces multi-channel PCM to `buckets` normalized samples.
 *
 * Each bucket is `0.55 * peak + 0.45 * rms`, then the whole series is scaled to
 * a maximum of 1.
 */
export function computeWaveform(channels: Float32Array[], buckets = 256): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length) return Array(buckets).fill(0);
  const raw = Array.from({ length: buckets }, (_, bucket) => {
    const start = Math.floor((bucket * length) / buckets);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * length) / buckets));
    const stride = Math.max(1, Math.floor((end - start) / 512));
    let peak = 0;
    let sumSquares = 0;
    let count = 0;
    for (const channel of channels) {
      for (let i = start; i < Math.min(end, channel.length); i += stride) {
        const value = Math.abs(channel[i]);
        peak = Math.max(peak, value);
        sumSquares += value * value;
        count++;
      }
    }
    return count ? 0.55 * peak + 0.45 * Math.sqrt(sumSquares / count) : 0;
  });
  const max = Math.max(...raw);
  return raw.map((value) => (max > 0 ? value / max : 0));
}

/** Down-samples a waveform for drawing. */
export function downsampleWaveform(waveform: number[], target: number): number[] {
  const count = Math.min(waveform.length, Math.max(1, Math.floor(target)));
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor((i * waveform.length) / count);
    const end = Math.floor(((i + 1) * waveform.length) / count);
    let peak = 0;
    for (let j = start; j < end; j++) peak = Math.max(peak, waveform[j]);
    return peak;
  });
}
