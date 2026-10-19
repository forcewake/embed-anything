/**
 * The floating multimodal omnibox.
 *
 * One control at the bottom centre of the viewport: upload, text field,
 * microphone, camera and search. The reference keeps it deliberately small and
 * translucent so the mosaic stays the focus.
 */
import { useRef } from 'react';
import { CameraIcon, MicIcon, PlusIcon, SearchIcon } from './icons';

export interface SearchOmniboxProps {
  value: string;
  busy: boolean;
  recording: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onUpload: (file: File) => void;
  onRecord: () => void;
  onCamera: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function SearchOmnibox({
  value,
  busy,
  recording,
  disabled,
  onChange,
  onSubmit,
  onUpload,
  onRecord,
  onCamera,
  inputRef,
}: SearchOmniboxProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const localInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="bottom-search">
      <form
        className={`search-box${busy ? ' is-searching' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          ref={(node) => {
            localInputRef.current = node;
            if (inputRef) inputRef.current = node;
          }}
          type="text"
          value={value}
          disabled={disabled}
          placeholder="Search anything…"
          aria-label="Search anything"
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label="Upload a file to search"
          title="Upload a file to search"
          onClick={() => fileRef.current?.click()}
        >
          <PlusIcon size={19} />
        </button>
        <button
          type="button"
          className={recording ? 'is-recording' : undefined}
          aria-label={recording ? 'Stop recording' : 'Record audio to search'}
          title={recording ? 'Stop recording' : 'Record audio to search'}
          onClick={onRecord}
        >
          <MicIcon size={19} />
        </button>
        <button type="button" aria-label="Take a photo to search" title="Take a photo to search" onClick={onCamera}>
          <CameraIcon size={19} />
        </button>
        <button type="submit" aria-label="Search" title="Search" disabled={busy || disabled}>
          <SearchIcon size={19} />
        </button>
        <input
          ref={fileRef}
          className="file-input"
          type="file"
          accept="image/*,video/*,audio/*,text/plain,text/markdown"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onUpload(file);
          }}
        />
      </form>
    </div>
  );
}
