// Generative soundtrack for the intro, synthesised with the Web Audio API (no audio files).
// Every sound is scheduled against the intro timeline, so pause / seek / skip stay in sync:
// start(t) schedules everything from timeline second t; stop() fades the current pass out.

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

// chords per chapter (MIDI notes) with the pad's filter brightness; times come from the intro's cues
function chords(c) {
  return [
    { t0: 0, t1: 6.6, notes: [45, 52, 59, 60], cutoff: 900 },                       // Milky Way: A minor add9, distant
    { t0: 6.2, t1: c.sunDive + 0.4, notes: [41, 48, 52, 57], cutoff: 2600 },          // Sun: Fmaj7, opening up
    { t0: c.sunDive, t1: c.inner + 0.4, notes: [48, 55, 62, 64], cutoff: 2000 },      // whole solar system: C add9, wonder
    { t0: c.inner, t1: c.earth + 0.4, notes: [40, 47, 50, 55, 62], cutoff: 1800 },    // inner planets: E minor 7
    { t0: c.earth, t1: c.mars + 0.4, notes: [47, 50, 55, 62], cutoff: 1700 },         // Earth: G/B, warm
    { t0: c.mars, t1: c.arrive + 0.3, notes: [38, 45, 53, 60, 64], cutoff: 1400 },    // Mars: D minor 9, mystery
    { t0: c.arrive, t1: c.unroll0 + 0.2, notes: [41, 48, 52, 55, 57], cutoff: 2200 }, // anywhere on Mars: Fmaj9
    { t0: c.unroll0 - 0.1, t1: c.end + 2.3, notes: [45, 52, 59, 61, 64], cutoff: 3400 }, // the map: A add9, resolved
  ];
}

export class Score {
  constructor(cues) {
    this.cues = cues;
    this.CHORDS = chords(cues);
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    this.out.connect(comp).connect(ctx.destination);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(4.2);
    const wet = ctx.createGain(); wet.gain.value = 0.9;
    this.verb.connect(wet).connect(this.out);
    this.noise = this.noiseBuffer(3);
    this.pass = null;
    this.muted = false;
  }

  impulse(seconds) {
    const { ctx } = this, len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return b;
  }
  noiseBuffer(seconds) {
    const { ctx } = this, len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  setMuted(m) {
    this.muted = m;
    this.out.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.08);
  }

  stop(fade = 0.35) {
    const p = this.pass;
    if (!p) return;
    this.pass = null;
    const now = this.ctx.currentTime;
    p.bus.gain.cancelScheduledValues(now);
    p.bus.gain.setValueAtTime(p.bus.gain.value, now);
    p.bus.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => { p.nodes.forEach((n) => { try { n.stop(); } catch {} }); p.bus.disconnect(); }, (fade + 0.1) * 1000);
  }

  close() { this.stop(1.6); setTimeout(() => this.ctx.close(), 2200); }

  // ---- schedule everything from timeline second `t` ----
  start(t) {
    this.stop(0.2);
    const ctx = this.ctx;
    ctx.resume();
    const now = ctx.currentTime + 0.05;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(1, now + 0.6);
    const send = ctx.createGain(); send.gain.value = 0.55;
    bus.connect(this.out); bus.connect(send).connect(this.verb);
    const pass = { bus, nodes: [] };
    this.pass = pass;
    const at = (x) => Math.max(now, now + (x - t)); // timeline second → audio clock
    const live = (x0, x1) => x1 > t;               // still audible from t onwards?
    const track = (n) => { pass.nodes.push(n); return n; };

    // gain envelope that copes with starting part-way through
    const envelope = (g, x0, x1, level, attack, release) => {
      const a0 = at(x0), aPeak = at(x0 + attack), a1 = at(x1), aEnd = at(x1 + release);
      const startLevel = t > x0 ? level * Math.min(1, (t - x0) / attack) : 0;
      g.gain.setValueAtTime(startLevel, now);
      if (aPeak > now) g.gain.linearRampToValueAtTime(level, aPeak); else g.gain.setValueAtTime(level, now);
      g.gain.setValueAtTime(level, Math.max(a1, aPeak, now));
      g.gain.linearRampToValueAtTime(0.0001, aEnd);
      return [a0, aEnd];
    };

    // 1. sub drone under everything
    for (const [m, lvl] of [[33, 0.16], [40, 0.07]]) {
      if (!live(0, 36)) break;
      const o = track(ctx.createOscillator()); o.type = "sine"; o.frequency.value = midi(m);
      const g = ctx.createGain();
      const [s, e] = envelope(g, 0, this.cues.end - 0.7, lvl, 3, 3);
      o.connect(g).connect(bus); o.start(Math.max(now, s)); o.stop(e + 0.1);
    }

    // 2. evolving pads
    const c = this.cues;
    for (const ch of this.CHORDS) {
      if (!live(ch.t0, ch.t1 + 2.5)) continue;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 0.7;
      f.frequency.setValueAtTime(ch.cutoff * 0.45, now);
      f.frequency.linearRampToValueAtTime(ch.cutoff, at(Math.max(ch.t0 + 2.5, t)));
      const g = ctx.createGain();
      const [s, e] = envelope(g, ch.t0, ch.t1, 0.05, 1.8, 2.4);
      f.connect(g).connect(bus);
      for (const m of ch.notes) for (const det of [-7, 6]) {
        const o = track(ctx.createOscillator()); o.type = "sawtooth";
        o.frequency.value = midi(m); o.detune.value = det;
        o.connect(f); o.start(Math.max(now, s)); o.stop(e + 0.1);
      }
    }

    // 3. riser into the Sun, then the flash: boom + noise burst
    const noiseSweep = (x0, x1, f0, f1, level, q = 1.1) => {
      if (!live(x0, x1)) return;
      const src = track(ctx.createBufferSource()); src.buffer = this.noise; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = q;
      const g = ctx.createGain();
      const u = Math.max(0, (t - x0) / (x1 - x0));
      bp.frequency.setValueAtTime(f0 * Math.pow(f1 / f0, u), now);
      bp.frequency.exponentialRampToValueAtTime(f1, at(x1));
      g.gain.setValueAtTime(level * u * u, now);
      g.gain.linearRampToValueAtTime(level, at(x1 - 0.05));
      g.gain.linearRampToValueAtTime(0.0001, at(x1 + 0.25));
      src.connect(bp).connect(g).connect(bus);
      src.start(Math.max(now, at(x0))); src.stop(at(x1 + 0.4));
    };
    noiseSweep(5.2, c.sunDive, 180, 7000, 0.22);
    const impact = (x, freq0, level) => {
      if (t > x + 2) return;
      const o = track(ctx.createOscillator()); o.type = "sine";
      const g = ctx.createGain();
      o.frequency.setValueAtTime(freq0, at(x)); o.frequency.exponentialRampToValueAtTime(26, at(x + 1.8));
      g.gain.setValueAtTime(0.0001, now); g.gain.setValueAtTime(level, at(x)); g.gain.exponentialRampToValueAtTime(0.0001, at(x + 2.6));
      o.connect(g).connect(bus); o.start(Math.max(now, at(x))); o.stop(at(x + 2.8));
      const n = track(ctx.createBufferSource()); n.buffer = this.noise;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, now); ng.gain.setValueAtTime(level * 0.5, at(x)); ng.gain.exponentialRampToValueAtTime(0.0001, at(x + 1.2));
      n.connect(lp).connect(ng).connect(bus); n.start(Math.max(now, at(x))); n.stop(at(x + 1.4));
    };
    impact(c.sunDive, 95, 0.7);

    // 4. shimmering bell arpeggio from the solar system onwards
    let k = 0;
    for (let x = c.sunDive + 0.8; x < c.unroll1; x += 1 / 3, k++) {
      if (x < t) continue;
      const ch = [...this.CHORDS].reverse().find((h) => x >= h.t0);
      if (x > c.earth && x < c.mars && k % 2) continue; // quieter over Earth
      const pick = ch.notes[(k * 3 + (k >> 2)) % ch.notes.length] + (k % 5 === 0 ? 36 : 24);
      const o = track(ctx.createOscillator()); o.type = "triangle"; o.frequency.value = midi(pick);
      const g = ctx.createGain();
      const pan = ctx.createStereoPanner(); pan.pan.value = Math.sin(k * 1.7) * 0.6;
      const a = at(x), lvl = x > c.unroll0 ? 0.06 : 0.04;
      g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(lvl, a + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, a + 1.7);
      o.connect(g).connect(pan).connect(bus); o.start(a); o.stop(a + 1.8);
    }

    // 5. whoosh across the gap to Mars, and a soft swell as the globe unrolls
    noiseSweep(c.cross, c.arrive - 0.2, 2600, 260, 0.12, 0.8);
    noiseSweep(c.unroll0 - 0.2, c.unroll1, 300, 5200, 0.07, 0.6);

    // 6. arrival: a high chime when the map lands
    if (t < c.unroll1 + 0.1) for (const [m, d] of [[76, 0], [81, 0.12], [88, 0.24]]) {
      const o = track(ctx.createOscillator()); o.type = "sine"; o.frequency.value = midi(m);
      const g = ctx.createGain(); const a = at(c.unroll1 + d);
      g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(0.07, a + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, a + 3.5);
      o.connect(g).connect(bus); o.start(a); o.stop(a + 3.6);
    }
  }
}
