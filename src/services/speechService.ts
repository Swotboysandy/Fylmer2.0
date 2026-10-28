/**
 * Browser Speech Synthesis (window.speechSynthesis) & Web Audio API Tactile Earcons
 * Engineered for blind, low-vision, and multimodal filmmakers.
 */

class AccessibleAudioService {
  private audioCtx: AudioContext | null = null;
  private isMuted: boolean = false;
  private speechRate: number = 1.05;
  private onSpeakingChange?: (speaking: boolean) => void;

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public setSpeakingCallback(cb: (speaking: boolean) => void) {
    this.onSpeakingChange = cb;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      this.onSpeakingChange?.(false);
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setSpeechRate(rate: number) {
    this.speechRate = Math.max(0.75, Math.min(1.75, rate));
  }

  public getSpeechRate(): number {
    return this.speechRate;
  }

  /**
   * Speaks text aloud via native Web Speech API (window.speechSynthesis)
   */
  public speak(text: string, interrupt: boolean = true) {
    if (this.isMuted || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    try {
      if (interrupt) {
        window.speechSynthesis.cancel();
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = this.speechRate;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(
        (v) =>
          v.lang.startsWith('en') &&
          (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.default)
      );
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.onstart = () => this.onSpeakingChange?.(true);
      utterance.onend = () => this.onSpeakingChange?.(false);
      utterance.onerror = () => this.onSpeakingChange?.(false);

      window.speechSynthesis.speak(utterance);
    } catch {
      this.onSpeakingChange?.(false);
    }
  }

  public stopSpeaking() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      this.onSpeakingChange?.(false);
    }
  }

  /**
   * Tactile Audio Earcons for spatial & continuity status without visual reliance
   */
  public playEarcon(
    type: 'focus' | 'recordStart' | 'recordStop' | 'consistent' | 'mismatch' | 'fixApplied' | 'scrub'
  ) {
    if (this.isMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    switch (type) {
      case 'focus': {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(640, now + 0.045);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.055);
        break;
      }
      case 'recordStart': {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(660, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.24);
        break;
      }
      case 'recordStop': {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.setValueAtTime(440, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.24);
        break;
      }
      case 'consistent': {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.09); // A5
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
        osc.start(now);
        osc.stop(now + 0.28);
        break;
      }
      case 'mismatch': {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(311.13, now); // D#4
        osc.frequency.setValueAtTime(277.18, now + 0.11); // C#4 dissonant alert
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        osc.start(now);
        osc.stop(now + 0.34);
        break;
      }
      case 'fixApplied': {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.07); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.14); // G5
        osc.frequency.setValueAtTime(1046.5, now + 0.21); // C6
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
        osc.start(now);
        osc.stop(now + 0.45);
        break;
      }
      case 'scrub': {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(380, now);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
        osc.start(now);
        osc.stop(now + 0.03);
        break;
      }
    }
  }
}

export const speechService = new AccessibleAudioService();
