// Every sound is synthesized with WebAudio, so the game ships with no audio files.

let ctx = null;
let master = null;
let noiseBuffer = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = 0.5;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(ctx.destination);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

export function setVolume(v) {
  if (master) master.gain.value = v;
}

// distance falloff: 1 at <= 4m, quiet past 80m
function distGain(dist) {
  if (dist === undefined) return 1;
  return Math.max(0, Math.min(1, 6 / Math.max(6, dist)));
}

function noise(duration, { freq = 1000, q = 1, type = 'lowpass', gain = 1, attack = 0.002, decay = duration, sweepTo, when = 0 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + duration + 0.05);
}

function tone(freq, duration, { type = 'sine', gain = 0.3, slideTo, when = 0, attack = 0.005 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

const GUN_VOICES = {
  rifle: { freq: 2200, thump: 90, gain: 0.9, decay: 0.18 },
  smg: { freq: 2600, thump: 120, gain: 0.6, decay: 0.1 },
  pistol: { freq: 1500, thump: 70, gain: 1.0, decay: 0.3 },
  shotgun: { freq: 1100, thump: 55, gain: 1.0, decay: 0.4 },
  long: { freq: 1800, thump: 50, gain: 1.0, decay: 0.55 },
  arc: { freq: 3800, thump: 300, gain: 0.45, decay: 0.08 },
};

export function playGun(shape, dist) {
  const v = GUN_VOICES[shape] || GUN_VOICES.rifle;
  const g = distGain(dist);
  if (g <= 0.01) return;
  noise(v.decay, { freq: v.freq, sweepTo: 300, gain: v.gain * g, q: 0.7 });
  tone(v.thump, v.decay * 0.8, { type: 'triangle', gain: 0.5 * g, slideTo: 35 });
}

export function playEmpty() {
  tone(1800, 0.03, { type: 'square', gain: 0.08 });
}

export function playReload(stage) {
  if (stage === 0) {
    noise(0.06, { freq: 3000, type: 'bandpass', q: 4, gain: 0.25 });
  } else {
    noise(0.05, { freq: 2200, type: 'bandpass', q: 5, gain: 0.3 });
    tone(600, 0.04, { type: 'square', gain: 0.05, when: 0.03 });
  }
}

export function playHit(weak) {
  tone(weak ? 1700 : 1200, 0.06, { type: 'triangle', gain: 0.18 });
}

export function playKill() {
  tone(900, 0.08, { type: 'triangle', gain: 0.2 });
  tone(1400, 0.12, { type: 'triangle', gain: 0.2, when: 0.07 });
}

export function playMetalHit(dist) {
  const g = distGain(dist);
  noise(0.08, { freq: 4500, type: 'bandpass', q: 6, gain: 0.25 * g });
}

export function playHurt() {
  noise(0.15, { freq: 400, gain: 0.5 });
  tone(140, 0.15, { type: 'sawtooth', gain: 0.1, slideTo: 80 });
}

export function playShieldHit() {
  tone(2200, 0.12, { type: 'sine', gain: 0.12, slideTo: 900 });
  noise(0.1, { freq: 6000, type: 'highpass', gain: 0.12 });
}

export function playShieldBreak() {
  tone(1600, 0.4, { type: 'sawtooth', gain: 0.12, slideTo: 200 });
  noise(0.3, { freq: 5000, type: 'highpass', gain: 0.25 });
}

export function playExplosion(dist) {
  const g = distGain(dist);
  noise(1.2, { freq: 900, sweepTo: 60, gain: 1.2 * g, decay: 1.2 });
  tone(60, 0.8, { type: 'sine', gain: 0.8 * g, slideTo: 25 });
}

export function playBeep(dist, pitch = 1) {
  const g = distGain(dist);
  tone(1800 * pitch, 0.08, { type: 'square', gain: 0.12 * g });
}

export function playAlarm(dist) {
  const g = distGain(dist);
  for (let i = 0; i < 4; i++) {
    tone(900, 0.18, { type: 'sawtooth', gain: 0.15 * g, slideTo: 1500, when: i * 0.25 });
  }
}

export function playArcChirp(dist) {
  const g = distGain(dist);
  if (g < 0.05) return;
  tone(500 + Math.random() * 400, 0.2, { type: 'square', gain: 0.06 * g, slideTo: 1200 + Math.random() * 800 });
  tone(300, 0.1, { type: 'sawtooth', gain: 0.04 * g, when: 0.12, slideTo: 150 });
}

export function playStep(dist, soft) {
  const g = distGain(dist) * (soft ? 0.4 : 1);
  noise(0.07, { freq: 500 + Math.random() * 300, gain: 0.12 * g });
}

export function playPickup() {
  tone(700, 0.06, { type: 'triangle', gain: 0.15 });
  tone(1050, 0.08, { type: 'triangle', gain: 0.15, when: 0.05 });
}

export function playUI() {
  tone(1200, 0.04, { type: 'triangle', gain: 0.1 });
}

export function playDeny() {
  tone(220, 0.15, { type: 'square', gain: 0.1 });
}

export function playRoll() {
  noise(0.3, { freq: 600, sweepTo: 200, gain: 0.3 });
}

export function playLift() {
  tone(110, 2.5, { type: 'sawtooth', gain: 0.08, slideTo: 220, attack: 0.3 });
  noise(2.5, { freq: 300, gain: 0.15, attack: 0.3, decay: 2.5 });
}

export function playChime() {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.4, { type: 'sine', gain: 0.15, when: i * 0.12 }));
}

export function playSearch() {
  noise(0.12, { freq: 1500, type: 'bandpass', q: 2, gain: 0.15 });
}

// Low wind bed for topside.
let windNode = null;
export function setWind(on) {
  if (!ctx) return;
  if (on && !windNode) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start();
    lfo.start();
    windNode = { src, lfo };
  } else if (!on && windNode) {
    windNode.src.stop();
    windNode.lfo.stop();
    windNode = null;
  }
}
