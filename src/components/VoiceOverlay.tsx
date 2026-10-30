import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { VoiceOrb } from './agents/voice-orb';
import './voiceOverlay.css';
import { SPRING_PRESS } from '../lib/ease';

const COLORS = ['#b7b7b7', '#ffffff', '#252525'] as const;
type Props = { open: boolean; onOpenChange: (open: boolean) => void; onType: () => void };

/** Persistent entry to voice. The mic test is local metering, not transcription. */
export function VoiceOverlay({ open, onOpenChange }: Props) {
  const reduced = useReducedMotion();
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [renderError, setRenderError] = useState(false);
  const resources = useRef<{ stream: MediaStream; context: AudioContext } | null>(null);
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current++;
    resources.current?.stream.getTracks().forEach((track) => track.stop());
    void resources.current?.context.close().catch(() => {});
    resources.current = null;
    setAnalyser(null);
    setPending(false);
  }, []);
  useEffect(() => {
    if (!open) {
      stop();
      setError('');
      setRenderError(false);
    }
  }, [open, stop]);
  useEffect(
    () => () => {
      generation.current++;
      resources.current?.stream.getTracks().forEach((track) => track.stop());
      void resources.current?.context.close().catch(() => {});
    },
    [],
  );
  const start = async () => {
    if (pending || analyser) return;
    const request = ++generation.current;
    setPending(true);
    setError('');
    let stream: MediaStream | null = null,
      context: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Microphone access is unavailable in this browser.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (request !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new AudioContext();
      await context.resume();
      if (request !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        return;
      }
      const meter = context.createAnalyser();
      meter.fftSize = 256;
      context.createMediaStreamSource(stream).connect(meter);
      // Deliberately not connected to speakers and never recorded or uploaded.
      resources.current = { stream, context };
      setAnalyser(meter);
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => {});
      if (request === generation.current)
        setError(
          reason instanceof DOMException && reason.name === 'NotAllowedError'
            ? 'Microphone permission was denied. You can still type your direction.'
            : reason instanceof Error
              ? reason.message
              : 'Microphone could not start.',
        );
    } finally {
      if (request === generation.current) setPending(false);
    }
  };
  // Opening is a deliberate voice action; the browser still owns permission consent.
  useEffect(() => { if (open) void start(); }, [open]);
  const changeOpen = (next: boolean) => {
    if (!next) stop();
    onOpenChange(next);
  };
  return (
    <div className="voice-orb-only">
      <motion.button type="button" className="voice-orb-toggle"
        animate={{scale: reduced ? 1 : analyser ? 1.12 : 1}}
        whileHover={reduced ? undefined : {scale: analyser ? 1.16 : 1.04}}
        whileTap={reduced ? undefined : {scale: 0.92}}
        transition={reduced ? {duration:0} : SPRING_PRESS}
        title={open ? 'Stop voice chat microphone' : 'Voice chat — click to start microphone (local preview)'}
        aria-label={open ? 'Stop voice chat microphone' : 'Start voice chat microphone — local preview'}
        aria-pressed={open} aria-describedby="voice-orb-status"
        onClick={() => changeOpen(!open)}
        onKeyDown={event => { if(event.key === 'Escape') changeOpen(false); }}>
        <motion.div animate={{rotate: !reduced && analyser ? 360 : 0}}
          transition={{duration: analyser && !reduced ? 14 : 0, repeat: analyser && !reduced ? Infinity : 0, ease:'linear'}}>
          <VoiceOrb colors={COLORS} analyser={analyser} active={!!analyser}
            speed={1.15} className="w-24" aria-label="Voice orb"
            onError={() => {setRenderError(true);stop();}} />
        </motion.div>
      </motion.button>
      <span id="voice-orb-status" className="sr-only" role="status">
        {error || (renderError ? 'Orb unavailable' : pending ? 'Waiting for microphone permission' : analyser ? 'Microphone on. Local visualization only; transcription is not connected.' : 'Microphone off')}
      </span>
    </div>
  );
}
