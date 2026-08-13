/**
 * sfx.js — subtle, synthesized sound cues for Haarlem Hold'em.
 *
 * No audio files involved — everything here is generated on the fly with
 * the Web Audio API (oscillators + filtered noise). That's a deliberate
 * choice: there's no way to source or embed real recorded casino sound
 * effects here, so this aims for clean, subtle, casino-*adjacent* cues
 * (a soft paper-like flip, a gentle chip-like click, a warm short chime)
 * rather than trying to fake realism it can't actually deliver.
 *
 * Usage:
 *   SFX.cardFlip();
 *   SFX.win();
 *   SFX.fold(); SFX.checkCall(); SFX.raise();
 *
 * All volumes are kept low and durations short (<350ms) on purpose — the
 * brief was "realistic casino, but subtle," not attention-grabbing.
 */
(function (global) {
  'use strict';

  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume(); // browsers suspend until a user gesture — every call here is already downstream of one (a click), so this just clears it
    return ctx;
  }

  // A short burst of filtered noise — the basis for both the card-flip
  // "paper" sound and the softer parts of the chip click.
  function noiseBurst({ duration = 0.08, filterFreq = 2000, filterType = 'bandpass', gain = 0.15 }) {
    const c = getCtx();
    const bufferSize = Math.floor(c.sampleRate * duration);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // decay envelope baked into the noise itself
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(c.destination);
    src.start();
  }

  function tone({ freq = 440, duration = 0.15, type = 'sine', gain = 0.12, delay = 0 }) {
    const c = getCtx();
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = c.createGain();
    const startAt = c.currentTime + delay;
    g.gain.setValueAtTime(0, startAt);
    g.gain.linearRampToValueAtTime(gain, startAt + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(g).connect(c.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  // ---- TV moments ----

  // Card being revealed (flop/turn/river) — a short, soft paper-like flip.
  function cardFlip() {
    noiseBurst({ duration: 0.09, filterFreq: 2400, filterType: 'bandpass', gain: 0.13 });
  }

  // Hand won — a brief, warm two-note rise. Deliberately understated, not
  // a jingle — this plays every single hand, so it can't afford to grate.
  function win() {
    tone({ freq: 523.25, duration: 0.22, type: 'triangle', gain: 0.09 });      // C5
    tone({ freq: 659.25, duration: 0.28, type: 'triangle', gain: 0.09, delay: 0.09 }); // E5
  }

  // ---- Phone (betting) moments ----

  // A soft, low, short sound — deliberately the quietest and shortest cue,
  // since folding is the one action a player usually doesn't want draws
  // attention to.
  function fold() {
    tone({ freq: 180, duration: 0.12, type: 'sine', gain: 0.07 });
  }

  // Check or call — a small neutral tap. Same cue for both since neither
  // changes the pot size in a way worth distinguishing by ear.
  function checkCall() {
    noiseBurst({ duration: 0.04, filterFreq: 900, filterType: 'lowpass', gain: 0.1 });
  }

  // Raise (including all-in) — a slightly brighter, chip-like double-click,
  // the one betting sound allowed to stand out a little, since it's the
  // one action that actually escalates the hand.
  function raise() {
    noiseBurst({ duration: 0.035, filterFreq: 3200, filterType: 'highpass', gain: 0.12 });
    setTimeout(() => noiseBurst({ duration: 0.035, filterFreq: 3200, filterType: 'highpass', gain: 0.1 }), 55);
  }

  // Call this directly inside a real click handler, as early as possible.
  // Browsers can permanently refuse to let an AudioContext start if its
  // VERY FIRST creation wasn't tied to an immediate user gesture — and on
  // the TV, every sound actually plays from a setTimeout inside the reveal
  // animation, a moment AFTER a click, not from the click itself. Calling
  // this at the top of an actual button handler creates/resumes the
  // context while still inside that gesture, so the later timer-triggered
  // sounds have something already-unlocked to play through.
  function unlock() {
    getCtx();
  }

  // A gentle heads-up that a decision window is about to close (muck/show
  // countdown). Deliberately a single, calm tone — not a repeating tick —
  // since the point is a quiet reminder, not urgency. Every cue in this
  // file so far is a one-shot sound, never an alarm-style repeat; this
  // keeps that same subtle character rather than introducing a new one.
  function decisionWarning() {
    tone({ freq: 480, duration: 0.2, type: 'triangle', gain: 0.08 });
  }

  // Blinds actually going up — the one moment in the whole game worth a
  // genuinely distinct, attention-getting cue rather than another subtle
  // one-shot. A clean two-note "ding-dong" attention chime, like the cue
  // airports use right before a PA announcement — catches attention
  // without being harsh — played twice. Deliberately much louder than
  // every other cue in this file on purpose; a bell-then-gong version was
  // tried first and reported as too quiet/lame to actually notice.
  function blindsUp() {
    const playChime = (delay) => {
      tone({ freq: 880, duration: 0.35, type: 'sine', gain: 0.26, delay });
      tone({ freq: 659.25, duration: 0.5, type: 'sine', gain: 0.24, delay: delay + 0.32 });
    };
    playChime(0);
    playChime(1.1);
  }

  global.SFX = { cardFlip, win, fold, checkCall, raise, unlock, decisionWarning, blindsUp };
})(typeof window !== 'undefined' ? window : globalThis);
