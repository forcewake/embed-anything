/**
 * The media model of the atlas.
 *
 * The catalog is a discriminated union so that a tile can never be rendered
 * with the wrong accessor (a video has no waveform, an image has no duration).
 */

export type MediaType = 'image' | 'audio' | 'video' | 'text';

export interface MediaItemBase {
  /** Stable catalog id. */
  id: string;
  /**
   * The id used to address the row in the embedding matrices. Present for every
   * catalog item; absent for user uploads (they are encoded on demand).
   */
  embeddingId?: string;
  type: MediaType;
  title: string;
  description?: string;
  topic?: string;
  /** Small preview used by the CSS fallback and the drop overlay. */
  thumbnail?: string;
  /** Full-size media URL. */
  src?: string;
  /** Still frame for videos. */
  poster?: string;
  /** Width / height. */
  aspectRatio: number;
  /** Attribution link. */
  source?: string;
  durationSeconds?: number;
  /** Formatted duration, e.g. `1:23`. */
  duration?: string;
  /** Normalized 0..1 waveform samples for audio. */
  waveform?: number[];
  /** Dominant colour, used for generated waveforms. */
  color?: string;
  /** Path of a locally hosted file, relative to `public/local/data`. */
  localFile?: string;
}

export interface ImageItem extends MediaItemBase {
  type: 'image';
}

export interface AudioItem extends MediaItemBase {
  type: 'audio';
  durationSeconds: number;
  duration: string;
  waveform: number[];
  waveformStatus?: 'loading' | 'ready' | 'unavailable';
  /** Last audible second of a trimmed clip. */
  playbackEndSeconds?: number;
}

export interface VideoItem extends MediaItemBase {
  type: 'video';
  durationSeconds: number;
  duration: string;
}

export interface TextItem extends MediaItemBase {
  type: 'text';
  text: string;
}

/** A user-supplied file (upload, drop, webcam capture or microphone recording). */
export interface LocalItem extends MediaItemBase {
  type: MediaType;
  local: true;
  text?: string;
  durationSeconds?: number;
  duration?: string;
  waveform?: number[];
  waveformStatus?: 'loading' | 'ready' | 'unavailable';
}

export type MediaItem = ImageItem | AudioItem | VideoItem | TextItem | LocalItem;

/** Narrows a media item to an audio item. */
export function isAudio(item: MediaItem): item is AudioItem | LocalItem {
  return item.type === 'audio';
}

/** Narrows a media item to a video item. */
export function isVideo(item: MediaItem): item is VideoItem | LocalItem {
  return item.type === 'video';
}

/** Narrows a media item to an image item. */
export function isImage(item: MediaItem): item is ImageItem | LocalItem {
  return item.type === 'image';
}
