// ============================================================================
// BSV CHESS - Sound Manager
// ============================================================================
// Web Audio API generated sounds for chess events
// No external MP3 files needed — all synthesized
// ============================================================================

class SoundManager {
  private audioContext: AudioContext | null = null;
  public muted: boolean = false;
  private effectsVolume: number = 0.5;

  init(): this {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this;
  }

  private ensureContext(): AudioContext | null {
    if (!this.audioContext) this.init();
    return this.audioContext;
  }

  // ========================================================================
  // CHESS SOUNDS
  // ========================================================================

  /** Standard piece move — short wooden tap */
  playMove(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4);
    }
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.effectsVolume * 0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);
  }

  /** Capture — sharper, louder impact */
  playCapture(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    }
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, now);
    filter.frequency.exponentialRampToValueAtTime(500, now + 0.12);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.effectsVolume * 0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);
  }

  /** Check — warning tone */
  playCheck(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.12);
      gain.gain.linearRampToValueAtTime(this.effectsVolume * 0.4, now + i * 0.12 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.2);
    });
  }

  /** Checkmate / Victory — triumphant ascending tones */
  playVictory(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.15);
      gain.gain.linearRampToValueAtTime(this.effectsVolume * 0.35, now + i * 0.15 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.15 + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.5);
    });
  }

  /** Defeat — descending sad tones */
  playDefeat(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    [440, 370, 330, 262].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.2);
      gain.gain.linearRampToValueAtTime(this.effectsVolume * 0.3, now + i * 0.2 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.2 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.2);
      osc.stop(now + i * 0.2 + 0.6);
    });
  }

  /** Coin sound — payment confirmed */
  playCoin(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    [800, 1000, 1200].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.1);
      gain.gain.linearRampToValueAtTime(this.effectsVolume * 0.3, now + i * 0.1 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.3);
    });
  }

  /** Draw — neutral tone */
  playDraw(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(this.effectsVolume * 0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.7);
  }

  // ========================================================================
  // PIECE-SPECIFIC SOUNDS
  // ========================================================================

  /** Piece slide — wooden drag sound, heavier for bigger pieces */
  playPieceMove(piece?: string): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Piece weight affects pitch and duration
    const weights: Record<string, { freq: number; dur: number; vol: number }> = {
      'p': { freq: 2200, dur: 0.06, vol: 0.4 },   // pawn — light tap
      'n': { freq: 1600, dur: 0.09, vol: 0.5 },   // knight — medium clop
      'b': { freq: 1400, dur: 0.08, vol: 0.5 },   // bishop — smooth slide
      'r': { freq: 900, dur: 0.12, vol: 0.6 },    // rook — heavy thud
      'q': { freq: 700, dur: 0.15, vol: 0.65 },   // queen — deep resonant
      'k': { freq: 600, dur: 0.14, vol: 0.6 },    // king — authoritative
    };
    const p = piece?.toLowerCase() || 'p';
    const w = weights[p] || weights['p'];

    // Noise burst (wood impact)
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * w.dur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3.5);
    }
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = w.freq;
    filter.Q.value = 1.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.effectsVolume * w.vol, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + w.dur);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);

    // Subtle tonal body for heavier pieces
    if (['r', 'q', 'k'].includes(p)) {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = w.freq * 0.5;
      oscGain.gain.setValueAtTime(this.effectsVolume * 0.1, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + w.dur * 0.8);
      osc.connect(oscGain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + w.dur);
    }
  }

  /** Pawn capture — quick snap */
  playCaptPawn(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4);
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass'; filter.frequency.value = 1500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.effectsVolume * 0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);
  }

  /** Knight capture — metallic clang */
  playCaptKnight(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    [1200, 1800].forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.7, now + 0.15);
      gain.gain.setValueAtTime(this.effectsVolume * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.2);
    });

    // Impact noise
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 5);
    noise.buffer = buffer;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(this.effectsVolume * 0.5, now);
    nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    noise.connect(nGain).connect(ctx.destination);
    noise.start(now);
  }

  /** Bishop capture — glass shatter / crystalline break */
  playCaptBishop(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    [2000, 2800, 3600].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.02);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.4, now + i * 0.02 + 0.2);
      gain.gain.setValueAtTime(this.effectsVolume * 0.25, now + i * 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.02 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.02); osc.stop(now + i * 0.02 + 0.25);
    });

    // Shatter noise
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2) * 0.6;
    noise.buffer = buffer;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 3000;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(this.effectsVolume * 0.4, now);
    nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    noise.connect(hpf).connect(nGain).connect(ctx.destination);
    noise.start(now);
  }

  /** Rook capture — heavy stone slam */
  playCaptRook(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Deep impact
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.3);
    gain.gain.setValueAtTime(this.effectsVolume * 0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.35);

    // Stone crack noise
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.5);
    noise.buffer = buffer;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 800;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(this.effectsVolume * 0.7, now);
    nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    noise.connect(lpf).connect(nGain).connect(ctx.destination);
    noise.start(now);
  }

  /** Queen capture — dramatic explosion with reverb tail */
  playCaptQueen(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Deep boom
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(180, now);
    boom.frequency.exponentialRampToValueAtTime(40, now + 0.4);
    boomGain.gain.setValueAtTime(this.effectsVolume * 0.7, now);
    boomGain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    boom.connect(boomGain).connect(ctx.destination);
    boom.start(now); boom.stop(now + 0.45);

    // Mid crack
    const crack = ctx.createOscillator();
    const crackGain = ctx.createGain();
    crack.type = 'sawtooth';
    crack.frequency.setValueAtTime(600, now);
    crack.frequency.exponentialRampToValueAtTime(100, now + 0.2);
    crackGain.gain.setValueAtTime(this.effectsVolume * 0.35, now);
    crackGain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    crack.connect(crackGain).connect(ctx.destination);
    crack.start(now); crack.stop(now + 0.25);

    // Explosion debris noise
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.8);
    noise.buffer = buffer;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(this.effectsVolume * 0.5, now);
    nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    noise.connect(nGain).connect(ctx.destination);
    noise.start(now);

    // High sparkle tail
    [1500, 2200, 3000].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, now + 0.05 + i * 0.06);
      g.gain.linearRampToValueAtTime(this.effectsVolume * 0.15, now + 0.08 + i * 0.06);
      g.gain.exponentialRampToValueAtTime(0.01, now + 0.3 + i * 0.06);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + 0.05 + i * 0.06); osc.stop(now + 0.4 + i * 0.06);
    });
  }

  /** King capture / checkmate — epic death knell with bell toll */
  playCaptKing(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Deep bell toll
    [130, 196, 262].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(this.effectsVolume * 0.5, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.08 + 1.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.08); osc.stop(now + i * 0.08 + 1.5);
    });

    // Metallic overtones
    [523, 784, 1047].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(this.effectsVolume * 0.2, now + 0.02 + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5 + i * 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + 0.02 + i * 0.05); osc.stop(now + 0.7 + i * 0.1);
    });

    // Dramatic impact
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    noise.buffer = buffer;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 500;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(this.effectsVolume * 0.6, now);
    nGain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
    noise.connect(lpf).connect(nGain).connect(ctx.destination);
    noise.start(now);
  }

  /** Castle (rook move) — stone sliding */
  playCastle(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Long sliding noise
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = Math.sin(Math.PI * i / data.length);
      data[i] = (Math.random() * 2 - 1) * env * 0.5;
    }
    noise.buffer = buffer;
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 600; bpf.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.effectsVolume * 0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    noise.connect(bpf).connect(gain).connect(ctx.destination);
    noise.start(now);

    // Two thumps (king + rook placement)
    [0.12, 0.25].forEach(t => {
      const n2 = ctx.createBufferSource();
      const b2 = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
      const d2 = b2.getChannelData(0);
      for (let i = 0; i < d2.length; i++) d2[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d2.length, 5);
      n2.buffer = b2;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(this.effectsVolume * 0.5, now + t);
      g2.gain.exponentialRampToValueAtTime(0.01, now + t + 0.05);
      n2.connect(g2).connect(ctx.destination);
      n2.start(now + t);
    });
  }

  /** Play capture sound based on captured piece type */
  playCaptureByPiece(piece?: string): void {
    const p = piece?.toLowerCase() || 'p';
    switch (p) {
      case 'k': this.playCaptKing(); break;
      case 'q': this.playCaptQueen(); break;
      case 'r': this.playCaptRook(); break;
      case 'n': this.playCaptKnight(); break;
      case 'b': this.playCaptBishop(); break;
      default: this.playCaptPawn(); break;
    }
  }

  /** Click — UI interaction */
  playClick(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 600;
    gain.gain.setValueAtTime(this.effectsVolume * 0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }
}

export const soundManager = new SoundManager();