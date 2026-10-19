/**
 * The full-screen drag & drop acceptance state.
 *
 * The overlay mirrors the reference: corner brackets, a floating stack of
 * media glyphs and a preview of the file that is about to be ingested.
 */
import { CheckIcon, ImageIcon, MusicIcon, TextIcon, UploadIcon, VideoIcon } from './icons';
import type { MediaType } from '../media/types';

export interface DropState {
  phase: 'dragging' | 'received';
  file: File;
  preview?: string;
}

export interface UploadOverlayProps {
  drop: DropState | null;
}

const ICONS = {
  image: ImageIcon,
  video: VideoIcon,
  audio: MusicIcon,
  text: TextIcon,
} as const;

function mediaTypeOf(file: File): MediaType | undefined {
  const mime = file.type.split('/')[0];
  if (mime === 'image' || mime === 'video' || mime === 'audio' || mime === 'text') return mime;
  return undefined;
}

export function UploadOverlay({ drop }: UploadOverlayProps) {
  if (!drop) return null;
  const received = drop.phase === 'received';
  const type = mediaTypeOf(drop.file);
  const Glyph = type ? ICONS[type] : UploadIcon;

  return (
    <div className={`drop-overlay${received ? ' is-received' : ''}`} role="status" aria-live="polite">
      <div className="drop-boundary" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="drop-content">
        <div className="drop-art" aria-hidden="true">
          {!received && (
            <>
              <span className="drop-orbit drop-orbit-left">
                <MusicIcon size={30} strokeWidth={1.1} />
              </span>
              <span className="drop-orbit drop-orbit-right">
                <VideoIcon size={30} strokeWidth={1.1} />
              </span>
            </>
          )}
          <div className="drop-preview">
            {received && drop.preview && type === 'image' ? (
              <img src={drop.preview} alt="" />
            ) : received && drop.preview && type === 'video' ? (
              <video src={drop.preview} muted autoPlay loop playsInline />
            ) : (
              <Glyph size={44} strokeWidth={1.1} />
            )}
            <span className="drop-badge">{received ? <CheckIcon size={18} /> : <UploadIcon size={18} />}</span>
          </div>
        </div>
        <h2>{received ? 'Ready to explore' : 'Drop a file to search'}</h2>
        <p>{received ? drop.file.name : 'Images, video, audio, or text'}</p>
        {!received && <span className="drop-hint">Release anywhere</span>}
      </div>
    </div>
  );
}
