/**
 * The playback controls of the focused audio / video.
 *
 * Port of the recovered `F` component: a real media element, a seek bar, a
 * mute toggle and a live time readout.
 */
import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../media/catalog';
import type { MediaItem } from '../media/types';
import type { SpatialField } from '../engine/SpatialField';
import { MuteIcon, PauseIcon, PlayIcon, VolumeIcon } from './icons';

export interface PlaybackProps {
  item: MediaItem;
  engine: SpatialField;
}

interface PlaybackState {
  playing: boolean;
  muted: boolean;
  time: number;
  duration: number;
}

export function Playback({ item, engine }: PlaybackProps) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const durationRef = useRef(item.durationSeconds);
  const playbackEnd = (item as { playbackEndSeconds?: number }).playbackEndSeconds;
  // The media element listens to the item it was mounted with; the progress
  // callbacks always use the freshest one.
  const itemRef = useRef(item);
  itemRef.current = item;
  const [state, setState] = useState<PlaybackState>({
    playing: false,
    muted: item.type === 'video',
    time: 0,
    duration: 0,
  });
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    durationRef.current = item.durationSeconds;
    const element = mediaRef.current;
    if (!element) return;
    if (item.durationSeconds && !(element.duration && Number.isFinite(element.duration))) {
      setState((current) => ({ ...current, duration: item.durationSeconds! }));
    }
  }, [item.durationSeconds]);

  useEffect(() => {
    const element = itemRef.current.type === 'video' ? engine.getFocusedVideo(itemRef.current) : mediaRef.current;
    if (!element) return;
    mediaRef.current = element;
    let timeout = 0;

    const limit = () =>
      Math.min(
        Number.isFinite(element.duration) && element.duration > 0 ? element.duration : (durationRef.current ?? 0),
        playbackEnd ?? Infinity,
      );

    const update = () => {
      const end = limit();
      if (playbackEnd != null && element.currentTime >= playbackEnd && !element.paused) {
        element.pause();
        element.currentTime = playbackEnd;
      }
      setState({
        playing: !element.paused && !element.ended,
        muted: element.muted,
        time: Number.isFinite(element.currentTime) ? Math.min(element.currentTime, end) : 0,
        duration: end,
      });
      if (element.readyState >= 2) setFailed(false);
      if (itemRef.current.type !== 'audio' || document.hidden) return;
      engine.setFocusedAudioProgress(itemRef.current, element.currentTime, end);
      if (!element.paused && !element.ended) timeout = window.setTimeout(update, 100);
    };

    const onError = () => setFailed(true);
    const onWaiting = () => setBuffering(true);
    const events = [
      'play',
      'pause',
      'ended',
      'timeupdate',
      'loadedmetadata',
      'durationchange',
      'volumechange',
      'seeking',
      'seeked',
      'canplay',
    ];
    for (const name of events) element.addEventListener(name, update);
    element.addEventListener('error', onError);
    element.addEventListener('waiting', onWaiting);
    document.addEventListener('visibilitychange', update);
    if (element.error) setFailed(true);
    update();

    return () => {
      for (const name of events) element.removeEventListener(name, update);
      element.removeEventListener('error', onError);
      element.removeEventListener('waiting', onWaiting);
      document.removeEventListener('visibilitychange', update);
      clearTimeout(timeout);
      if (itemRef.current.type === 'audio') element.pause();
    };
  }, [engine, item.id, item.src, item.type, playbackEnd]);

  const toggle = async () => {
    const element = mediaRef.current;
    if (!element) return;
    if (item.type === 'video') {
      engine.playFocused(element.paused || element.ended);
      return;
    }
    if (!element.paused) {
      element.pause();
      return;
    }
    try {
      if (element.ended || (playbackEnd != null && element.currentTime >= playbackEnd)) element.currentTime = 0;
      await element.play();
    } catch {
      /* the browser refused to start playback */
    }
  };

  const seek = (value: number) => {
    const element = mediaRef.current;
    if (!element || !state.duration) return;
    element.currentTime = Math.max(0, Math.min(value, state.duration));
    if (item.type === 'audio') engine.setFocusedAudioProgress(item, element.currentTime, state.duration);
    setState((current) => ({ ...current, time: element.currentTime }));
  };

  const toggleMute = () => {
    const element = mediaRef.current;
    if (!element) return;
    element.muted = !element.muted;
    setState((current) => ({ ...current, muted: element.muted }));
  };

  return (
    <>
      {item.type === 'audio' && (
        <>
          <audio ref={mediaRef} src={item.src} preload="metadata" />
          {item.waveformStatus && item.waveformStatus !== 'ready' && (
            <p className="waveform-status" role="status">
              {item.waveformStatus === 'loading' ? 'Reading waveform…' : 'Waveform unavailable'}
            </p>
          )}
        </>
      )}
      <div className="viewer-playback" data-playing={state.playing} role="group" aria-label={`${item.type} playback`}>
        <button
          className="playback-toggle"
          aria-label={`${state.playing ? 'Pause' : 'Play'} ${item.type}`}
          onClick={() => void toggle()}
          disabled={failed}
        >
          {state.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
        </button>
        <input
          className="playback-seek"
          type="range"
          min={0}
          max={state.duration || 1}
          step={0.1}
          value={Math.min(state.time, state.duration || 1)}
          disabled={!state.duration || failed}
          aria-label={`Seek ${item.type}`}
          aria-valuetext={`${formatDuration(state.time)} of ${formatDuration(state.duration)}`}
          onChange={(event) => seek(Number(event.currentTarget.value))}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              seek(state.time + (event.key === 'ArrowRight' ? 5 : -5));
            }
          }}
          style={{
            backgroundSize: `${state.duration ? Math.min(100, (state.time / state.duration) * 100) : 0}% 4px, 100% 4px`,
          }}
        />
        <div className="playback-time" role={failed ? 'status' : undefined} aria-hidden={!failed}>
          {failed ? (
            'Unavailable'
          ) : (
            <>
              <span>{formatDuration(state.time)}</span>
              <span className="playback-time-divider">/</span>
              <span>{state.duration ? formatDuration(state.duration) : '—:—'}</span>
            </>
          )}
        </div>
        {item.type === 'video' && (
          <button className="playback-mute" aria-label={state.muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
            {state.muted ? <MuteIcon size={18} /> : <VolumeIcon size={18} />}
          </button>
        )}
      </div>
      {buffering && <div className="playback-buffering">Loading…</div>}
    </>
  );
}
