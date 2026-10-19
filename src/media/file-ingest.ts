/**
 * File ingestion: type detection, validation and probing of user uploads.
 */
import type { MediaType } from './types';

/** The largest file the app will ingest. */
export const MAX_FILE_BYTES = 104_857_600;

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'opus', 'm4a', 'flac', 'aac'];
const TEXT_EXTENSIONS = ['txt', 'md'];

/**
 * Detects the media type of a file.
 *
 * @returns the media type, or `undefined` when the file is not supported.
 */
export function detectMediaType(file: File): MediaType | undefined {
  const mime = file.type.split('/')[0];
  if (mime === 'image' || mime === 'video' || mime === 'audio' || mime === 'text') return mime;
  if (file.type && file.type !== 'application/octet-stream') return undefined;
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (extension && IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (extension && VIDEO_EXTENSIONS.includes(extension)) return 'video';
  if (extension && AUDIO_EXTENSIONS.includes(extension)) return 'audio';
  if (extension && TEXT_EXTENSIONS.includes(extension)) return 'text';
  return undefined;
}

/** True when the drag-and-drop payload contains at least one usable file. */
export function isSupportedDataTransfer(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  if (!Array.from(transfer.types).includes('Files')) return false;
  const files = Array.from(transfer.items).filter((item) => item.kind === 'file');
  if (!files.length) return false;
  return files.some(
    (item) => !item.type || item.type === 'application/octet-stream' || detectMediaType(item.getAsFile() as File),
  );
}

export interface ProbedMedia {
  aspectRatio: number;
  durationSeconds?: number;
  duration?: string;
  poster?: string;
}

/**
 * Reads the dimensions, duration and first frame of a media URL.
 *
 * Used for user uploads so that the tile has the correct aspect ratio before
 * the file is embedded.
 */
export function probeMedia(url: string, type: MediaType, timeoutMs = 5_000): Promise<ProbedMedia> {
  if (type === 'image') {
    return new Promise((resolve) => {
      const image = new Image();
      const finish = (value: ProbedMedia) => {
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
        resolve(value);
      };
      const timer = setTimeout(() => finish({ aspectRatio: 4 / 3 }), timeoutMs);
      image.onload = () => finish({ aspectRatio: image.naturalWidth / image.naturalHeight || 4 / 3 });
      image.onerror = () => finish({ aspectRatio: 4 / 3 });
      image.src = url;
    });
  }
  if (type === 'text') return Promise.resolve({ aspectRatio: 4 / 3 });

  return new Promise((resolve) => {
    const element = document.createElement(type);
    element.preload = type === 'video' ? 'auto' : 'metadata';
    element.muted = true;
    if (element instanceof HTMLVideoElement) element.playsInline = true;
    let done = false;
    const finish = (value: ProbedMedia) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      element.onloadedmetadata = null;
      element.onloadeddata = null;
      element.onerror = null;
      element.removeAttribute('src');
      element.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ aspectRatio: type === 'audio' ? 3 / 2 : 16 / 9 }), timeoutMs);
    element.onloadedmetadata =
      element.onloadeddata =
      element.onerror =
        () => {
          const result: ProbedMedia = { aspectRatio: type === 'audio' ? 3 / 2 : 16 / 9 };
          if (Number.isFinite(element.duration) && element.duration > 0) {
            result.durationSeconds = element.duration;
            const total = Math.floor(element.duration);
            const minutes = Math.floor(total / 60);
            result.duration = `${minutes}:${String(total % 60).padStart(2, '0')}`;
          }
          if (element instanceof HTMLVideoElement && element.videoWidth && element.videoHeight) {
            result.aspectRatio = element.videoWidth / element.videoHeight;
            if (element.readyState >= 2) {
              const scale = Math.min(1, 960 / Math.max(element.videoWidth, element.videoHeight));
              const canvas = document.createElement('canvas');
              canvas.width = Math.round(element.videoWidth * scale);
              canvas.height = Math.round(element.videoHeight * scale);
              try {
                canvas.getContext('2d')?.drawImage(element, 0, 0, canvas.width, canvas.height);
                result.poster = canvas.toDataURL('image/jpeg', 0.85);
              } catch {
                /* the frame could not be read */
              }
            }
          }
          finish(result);
        };
    element.src = url;
  });
}
