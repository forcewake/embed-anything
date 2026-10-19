/**
 * Video helpers: frame extraction for the EmbeddingGemma 2 video processor.
 */
import type { VideoFramePayload } from '../ml/protocol';

/** Maximum number of frames handed to the video processor. */
export const MAX_VIDEO_FRAMES = 32;

/** The longest side of an extracted frame, in pixels. */
export const MAX_FRAME_EDGE = 720;

export interface ExtractedVideo {
  frames: VideoFramePayload[];
  duration: number;
}

/**
 * Extracts representative frames from a video file.
 *
 * The frames are sampled uniformly across the clip, scaled so that the longest
 * side is at most 720 px, and returned as RGBA pixel buffers together with
 * their timestamps.
 */
export async function extractVideoFrames(blob: Blob, signal?: AbortSignal): Promise<ExtractedVideo> {
  const video = document.createElement('video');
  const url = URL.createObjectURL(blob);
  video.muted = true;
  video.preload = 'auto';

  const waitFor = (event: string) =>
    new Promise<void>((resolve, reject) => {
      signal?.throwIfAborted();
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener(event, onSuccess);
        video.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };
      const onSuccess = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Could not decode this video.'));
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(onError, 15_000);
      video.addEventListener(event, onSuccess, { once: true });
      video.addEventListener('error', onError, { once: true });
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  try {
    await waitFor('loadeddata').then(() => {
      video.src = url;
      video.load();
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('This video has no readable duration.');
    }

    const canvas = document.createElement('canvas');
    const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Video frame decoding is unavailable.');

    const frames: VideoFramePayload[] = [];
    const count = Math.min(MAX_VIDEO_FRAMES, Math.max(1, Math.ceil(duration)));
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted();
      const timestamp = count === 1 ? duration / 2 : (i / (count - 1)) * Math.max(0, duration - 0.01);
      if (Math.abs(video.currentTime - timestamp) > 0.001) {
        await waitFor('seeked').then(() => {
          video.currentTime = timestamp;
        });
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      frames.push({ data: image.data, width: canvas.width, height: canvas.height, timestamp });
    }
    return { frames, duration };
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
