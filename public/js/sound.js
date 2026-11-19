import { $, icon } from "./dom.js";

// ── sound (synthesised, no files) ───────────────────────────────────────────

let audio = null;
let soundOn = localStorage.getItem("hf:ger:sound") !== "off";
const soundBtn = $("#sound");
const paintSound = () => {
  soundBtn.replaceChildren(icon(soundOn ? "sound" : "mute"));
  soundBtn.setAttribute("aria-pressed", String(soundOn));
};
paintSound();
soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  localStorage.setItem("hf:ger:sound", soundOn ? "on" : "off");
  paintSound();
  if (soundOn) ctx(); // this click unlocks audio and starts the music
  else stopMusic();
});
/** The audio context. Browsers only allow it after a click, so the first call also starts the music. */
export function ctx() {
  if (!audio) {
    // iPhone: play through the media channel, so the ring/silent switch does not mute the game
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch { /* older Safari */ }
    audio = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audio.state !== "running") audio.resume(); // "suspended", or iOS "interrupted" after a call / app switch
  unlockMediaChannel();
  if (soundOn && !music.on) startMusic();
  return audio;
}

/**
 * Older iPhones ignore audioSession: a looping silent <audio> element, started from a tap,
 * moves Web Audio onto the media channel so it plays even with the silent switch on.
 */
let silentEl = null;
function unlockMediaChannel() {
  if (silentEl) return;
  const rate = 8000, n = rate / 2; // half a second of silence, 8-bit mono WAV
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  silentEl = document.createElement("audio");
  silentEl.src = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  silentEl.loop = true;
  silentEl.setAttribute("playsinline", "");
  silentEl.play().catch(() => { silentEl = null; }); // try again on the next tap
}

// the first tap anywhere unlocks sound (phones need a real touch, not just a page load)
const firstTouch = () => { if (soundOn) ctx(); };
addEventListener("pointerdown", firstTouch, { once: true });
addEventListener("touchend", firstTouch, { once: true });
// coming back to the tab (or after a phone call): wake the audio again
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && audio && soundOn && audio.state !== "running") audio.resume();
});

// ── background music (synthesised): a low drone + a slow pentatonic tune ────

const MUSIC_VOLUME = 0.06;   // overall music loudness (sound effects are louder)
const STEP = 0.42;           // seconds per melody step; smaller = faster tune

// D minor pentatonic (D F G A C), in Hz
const N = { A3: 220, C4: 261.63, D4: 293.66, F4: 349.23, G4: 392, A4: 440, C5: 523.25, D5: 587.33 };
// each phrase is [note, steps]; null is a rest. Every phrase is 16 steps long.
const PHRASES = [
  [["A3", 2], ["D4", 2], ["F4", 1], ["G4", 1], ["A4", 4], ["G4", 1], ["F4", 1], ["D4", 4]],
  [["A4", 2], ["C5", 2], ["D5", 2], ["C5", 1], ["A4", 1], ["G4", 2], ["F4", 2], ["G4", 4]],
  [["A3", 2], ["D4", 2], ["F4", 1], ["G4", 1], ["A4", 4], ["G4", 1], ["F4", 1], ["D4", 4]],
  [["F4", 2], ["G4", 2], ["A4", 2], ["G4", 1], ["F4", 1], ["D4", 2], ["C4", 2], ["D4", 4]],
  [[null, 16]], // a breath before it starts over
];
// flatten to one list of {freq, at, len} in steps
const TUNE = [];
{
  let at = 0;
  for (const phrase of PHRASES) {
    for (const [note, len] of phrase) {
      if (note) TUNE.push({ freq: N[note], at, len });
      at += len;
    }
  }
  TUNE.loopSteps = at;
}

const music = { on: false, bus: null, drone: [], timer: 0, next: 0, start: 0 };

/** One bowed-string note: a filtered sawtooth with a soft attack and a little vibrato. */
function playNote(freq, t, dur) {
  const a = audio;
  const o = a.createOscillator();
  o.type = "sawtooth";
  o.frequency.value = freq;
  const vib = a.createOscillator();
  vib.frequency.value = 5.2;
  const vibAmt = a.createGain();
  vibAmt.gain.value = freq * 0.006;
  vib.connect(vibAmt).connect(o.frequency);
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 1400;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
  g.gain.setValueAtTime(0.5, t + Math.max(0.12, dur - 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
  o.connect(f).connect(g).connect(music.bus);
  o.start(t); vib.start(t);
  o.stop(t + dur + 0.3); vib.stop(t + dur + 0.3);
}

/** Look a little ahead and queue the notes that fall inside that window. */
function schedule() {
  const ahead = audio.currentTime + 0.4;
  const loopLen = TUNE.loopSteps * STEP;
  while (true) {
    const loop = Math.floor(music.next / TUNE.length);
    const n = TUNE[music.next % TUNE.length];
    const t = music.start + loop * loopLen + n.at * STEP;
    if (t > ahead) break;
    if (t >= audio.currentTime - 0.05) playNote(n.freq, t, n.len * STEP);
    music.next++;
  }
}

export function startMusic() {
  if (music.on || !audio || !soundOn) return;
  music.on = true;
  const a = audio;
  music.bus = a.createGain();
  music.bus.gain.setValueAtTime(0.0001, a.currentTime);
  music.bus.gain.exponentialRampToValueAtTime(MUSIC_VOLUME, a.currentTime + 2.5); // fade in
  music.bus.connect(a.destination);
  // drone: D2 + A2, low-passed, slowly swelling
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 380;
  const swell = a.createOscillator();
  swell.frequency.value = 0.08;
  const swellAmt = a.createGain();
  swellAmt.gain.value = 120;
  swell.connect(swellAmt).connect(lp.frequency);
  const droneGain = a.createGain();
  droneGain.gain.value = 0.35;
  lp.connect(droneGain).connect(music.bus);
  music.drone = [73.42, 110].map((freq) => {
    const o = a.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.connect(lp);
    o.start();
    return o;
  });
  swell.start();
  music.drone.push(swell);
  music.start = a.currentTime + 1;
  music.next = 0;
  schedule();
  music.timer = setInterval(schedule, 100);
}

export function stopMusic() {
  if (!music.on) return;
  music.on = false;
  clearInterval(music.timer);
  const a = audio;
  const bus = music.bus;
  const drone = music.drone;
  bus.gain.cancelScheduledValues(a.currentTime);
  bus.gain.setValueAtTime(bus.gain.value, a.currentTime);
  bus.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.8); // fade out
  setTimeout(() => { drone.forEach((o) => o.stop()); bus.disconnect(); }, 900);
}
export function tone(freq, dur, type = "sine", gain = 0.15, when = 0) {
  if (!soundOn) return;
  const a = ctx();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = a.currentTime + when;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur);
}
function noise(dur, from, to, gain = 0.25) {
  if (!soundOn) return;
  const a = ctx();
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, a.currentTime);
  f.frequency.exponentialRampToValueAtTime(to, a.currentTime + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}
export const sfx = {
  place: () => { tone(140, 0.18, "triangle", 0.25); tone(320, 0.08, "square", 0.05, 0.02); },
  storm: () => noise(1.1, 300, 2400, 0.3),
  swap: () => { tone(520, 0.08, "triangle", 0.08); tone(660, 0.08, "triangle", 0.08, 0.07); },
  turn: () => { tone(880, 0.35, "sine", 0.08); tone(1320, 0.3, "sine", 0.05, 0.08); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, "triangle", 0.12, i * 0.13)),
};
