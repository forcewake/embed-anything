/**
 * The webcam capture dialog.
 *
 * A real, permission-aware camera dialog: it asks for the camera, shows a
 * live preview, and turns the capture into a JPEG file that is ingested like
 * any other upload.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AlertIcon, CloseIcon, SpinnerIcon } from './icons';

export interface CameraDialogProps {
  onClose: () => void;
  onCapture: (file: File) => void;
}

export function CameraDialog({ onClose, onCapture }: CameraDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const captureTimerRef = useRef<number | undefined>(undefined);
  const titleId = useId();
  const descriptionId = useId();
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    let disposed = false;
    cancelledRef.current = true;
    setReady(false);
    setError('');
    // Captured so the cleanup closes over this attempt, not over the ref.
    const video = videoRef.current;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is unavailable in this browser. You can upload a photo instead.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        });
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
      } catch (caught) {
        if (disposed) return;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        const failure = caught instanceof Error ? caught : new Error('Could not open your camera.');
        setError(
          failure.name === 'NotAllowedError'
            ? 'Allow camera access to take a photo, or upload one instead.'
            : failure.name === 'NotFoundError'
              ? 'No camera was found. You can upload a photo instead.'
              : failure.name === 'NotReadableError'
                ? 'Your camera is busy. Close other camera apps and try again.'
                : failure.name === 'NotSupportedError' || /not supported/i.test(failure.message)
                  ? 'This browser cannot open a camera. You can upload a photo instead.'
                  : failure.message,
        );
      }
    })();
    return () => {
      disposed = true;
      cancelledRef.current = false;
      clearTimeout(captureTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (video) video.srcObject = null;
    };
  }, [attempt]);

  const capture = () => {
    const video = videoRef.current;
    if (!ready || capturing || !video?.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setError('Could not capture a photo. Please try again.');
      return;
    }
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0);
    setCapturing(true);
    canvas.toBlob(
      (blob) => {
        if (cancelledRef.current) {
          if (!blob) {
            setCapturing(false);
            setError('Could not capture a photo. Please try again.');
          }
          return;
        }
        if (!blob) {
          setCapturing(false);
          setError('Could not capture a photo. Please try again.');
          return;
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        captureTimerRef.current = window.setTimeout(
          () => {
            if (!cancelledRef.current) onCapture(new File([blob], 'Webcam photo.jpg', { type: 'image/jpeg' }));
          },
          matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180,
        );
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <dialog
      ref={dialogRef}
      className="demo-dialog webcam-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom;
        if (outside) onClose();
      }}
    >
      <h2 id={titleId} className="dialog-title">
        Take a photo
      </h2>
      <p id={descriptionId} className="dialog-description">
        Use your front camera to search with a photo.
      </p>
      <div className={`webcam-preview${capturing ? ' is-capturing' : ''}`}>
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          onLoadedData={() => setReady(true)}
          aria-label="Front camera preview"
        />
        <div className="webcam-guides" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        {!ready && !error && (
          <div className="webcam-message" role="status">
            <SpinnerIcon className="spinner" size={24} />
            <span>Opening camera…</span>
          </div>
        )}
        {error && (
          <div className="webcam-message" role="alert">
            <AlertIcon size={30} strokeWidth={1.3} />
            <p>{error}</p>
            <button className="plain-button" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
          </div>
        )}
      </div>
      <button className="capture-button" disabled={!ready || capturing || !!error} onClick={capture}>
        <span aria-hidden="true" />
        <span>{capturing ? 'Photo captured' : 'Capture & search'}</span>
      </button>
      <button className="dialog-close" aria-label="Close" onClick={onClose}>
        <CloseIcon size={18} strokeWidth={1.5} />
      </button>
    </dialog>
  );
}
