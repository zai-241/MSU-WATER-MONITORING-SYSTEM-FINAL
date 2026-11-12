/**
 * @file alertSound.ts
 * @description Web Audio API sound synthesizer for unacknowledged critical and warning alerts.
 * Plays a pulsing audio chime when unacknowledged alerts are active, and silences immediately
 * when acknowledged or resolved across all open dashboard tabs.
 * Includes local mute, 15-minute snooze controls, and browser autoplay unlock handling (R7).
 */

class AlertSoundManager {
  private audioCtx: AudioContext | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isPlaying = false;
  private listeners: Set<() => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      // Auto-unlock audio context on first user interaction
      const unlockHandler = () => {
        this.unlockAudio();
        window.removeEventListener('click', unlockHandler);
        window.removeEventListener('keydown', unlockHandler);
      };
      window.addEventListener('click', unlockHandler, { once: true });
      window.addEventListener('keydown', unlockHandler, { once: true });
    }
  }

  public subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify() {
    this.listeners.forEach(cb => {
      try { cb(); } catch (err) { console.error('Sound listener error:', err); }
    });
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContextClass();
      } catch {
        return null;
      }
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    return this.audioCtx;
  }

  public unlockAudio(): Promise<void> {
    const ctx = this.getContext();
    if (ctx && ctx.state === 'suspended') {
      return ctx.resume().then(() => this.notify());
    }
    this.notify();
    return Promise.resolve();
  }

  public isAudioBlocked(): boolean {
    if (typeof window === 'undefined') return false;
    return !!this.audioCtx && this.audioCtx.state === 'suspended';
  }

  public isMuted(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('wm_sound_muted') === 'true';
    } catch {
      return false;
    }
  }

  public setMuted(muted: boolean) {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('wm_sound_muted', String(muted));
      if (muted && this.isPlaying) {
        if (this.intervalId) {
          clearInterval(this.intervalId);
          this.intervalId = null;
        }
        this.isPlaying = false;
      }
      this.notify();
    } catch (e) {
      console.warn('Failed to save sound mute state:', e);
    }
  }

  public isSnoozed(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const until = Number(localStorage.getItem('wm_sound_snooze_until') || 0);
      return until > Date.now();
    } catch {
      return false;
    }
  }

  public snooze(minutes = 15) {
    if (typeof window === 'undefined') return;
    try {
      const until = Date.now() + minutes * 60 * 1000;
      localStorage.setItem('wm_sound_snooze_until', String(until));
      if (this.isPlaying) {
        if (this.intervalId) {
          clearInterval(this.intervalId);
          this.intervalId = null;
        }
        this.isPlaying = false;
      }
      this.notify();
    } catch (e) {
      console.warn('Failed to save sound snooze state:', e);
    }
  }

  public clearSnooze() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem('wm_sound_snooze_until');
      this.notify();
    } catch (e) {
      console.warn('Failed to clear sound snooze state:', e);
    }
  }

  private playTone(frequency: number, duration: number, delay = 0, type: OscillatorType = 'triangle') {
    try {
      const ctx = this.getContext();
      if (!ctx || ctx.state !== 'running') return;

      const startTime = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(frequency, startTime);

      // Volume envelope to prevent popping sounds
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.12, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    } catch {
      // Audio restriction handled silently
    }
  }

  private triggerChime() {
    if (this.isMuted() || this.isSnoozed()) return;
    // Two-tone warning chime (880Hz -> 1046Hz)
    this.playTone(880, 0.18, 0, 'triangle');
    this.playTone(1046.5, 0.22, 0.2, 'triangle');
  }

  public startAlert() {
    if (this.isPlaying) return;
    if (this.isMuted() || this.isSnoozed()) return;

    this.isPlaying = true;
    this.triggerChime();

    // Pulse chime every 4 seconds until acknowledged or resolved
    this.intervalId = setInterval(() => {
      if (this.isPlaying) {
        if (this.isMuted() || this.isSnoozed()) {
          this.stopAlert();
        } else {
          this.triggerChime();
        }
      }
    }, 4000);
    this.notify();
  }

  public stopAlert() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isPlaying = false;
    this.notify();
  }

  public isAlerting(): boolean {
    return this.isPlaying;
  }
}

export const alertSound = new AlertSoundManager();
