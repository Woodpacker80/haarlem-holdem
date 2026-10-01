/**
 * announcer.js — spoken-word action callouts for Haarlem Hold'em.
 *
 * TV only (and, once it exists, tablet.html) — never phone.html. This is
 * real recorded audio (Mark's own voice), unlike sfx.js, which is pure
 * synthesis by design. Kept in its own file/namespace (`Announcer`) rather
 * than folded into sfx.js, so sfx.js's "no audio files" header stays true
 * to what's actually in that file.
 *
 * Playback order is always: spoken word(s) first, THEN the existing
 * synthesized chip/table sound effect — never layered together. That's why
 * this module takes a callback instead of just playing a sound: the caller
 * fires the matching SFX.* cue from inside `onDone`, once the voice clip(s)
 * have actually finished.
 *
 * Usage (see tv.html's action-request handler for the real call site):
 *   Announcer.announceAction({ type: 'raise', openingBet: true, allIn: false }, () => {
 *     SFX.raise();
 *   });
 */
(function (global) {
  'use strict';

  const CLIP_SRC = {
    check: 'voice/check.wav',
    call: 'voice/call.wav',
    raise: 'voice/raise.wav',
    bet: 'voice/bet.wav',
    fold: 'voice/fold.wav',
    allin: 'voice/allin.wav',
  };

  // Lazily-created <audio> elements, one per word, reused across plays
  // rather than rebuilt every time.
  const clips = {};
  function getClip(word) {
    if (!clips[word]) {
      const a = new Audio(CLIP_SRC[word]);
      a.preload = 'auto';
      clips[word] = a;
    }
    return clips[word];
  }

  // How long to wait for a clip to actually finish before giving up on it
  // and moving on. Without this, a clip that never fires 'ended' — e.g. a
  // missing file that the browser doesn't reject play() for, just silently
  // never starts — would hang the ENTIRE sequence forever, since nothing
  // else was listening for that case. Every real clip here is well under
  // 1.2s, so 3s is generous padding, not a normal-case delay.
  const CLIP_TIMEOUT_MS = 3000;

  // Plays a list of words back-to-back (e.g. ['raise', 'allin']), each one
  // waiting for the previous to actually finish, then calls `onDone`. If a
  // clip fails for any reason (missing file, decode error, autoplay block,
  // or simply never firing 'ended' within CLIP_TIMEOUT_MS) this moves on
  // rather than hanging the sequence — a missing announcer line should
  // never stop the chip sound or the game itself. The failure is still
  // reported (not swallowed silently): logged to the console AND, if the
  // caller passed `onError`, handed to it too — tv.html uses that to show
  // the error directly on screen, since Mark's actual setup (an NVIDIA
  // Shield, mouse-only, no keyboard, no computer) has no practical way to
  // open a browser console.
  function playSequence(words, onDone, onError) {
    let i = 0;
    function playNext() {
      if (i >= words.length) { onDone && onDone(); return; }
      const word = words[i];
      const clip = getClip(word);
      i++;
      let settled = false;
      const cleanup = () => {
        clip.removeEventListener('ended', onEnded);
        clip.removeEventListener('error', onError_);
        clearTimeout(timer);
      };
      const fail = (label) => {
        if (settled) return;
        settled = true;
        cleanup();
        console.warn(`[Announcer] couldn't play "${word}" (${CLIP_SRC[word]}):`, label);
        onError && onError(word, label);
        playNext();
      };
      const onEnded = () => {
        if (settled) return;
        settled = true;
        cleanup();
        playNext();
      };
      const onError_ = () => fail((clip.error && clip.error.message) || 'media error');
      const timer = setTimeout(() => fail(`timed out after ${CLIP_TIMEOUT_MS}ms (no 'ended' event — likely a missing/unreachable file)`), CLIP_TIMEOUT_MS);
      clip.currentTime = 0;
      clip.addEventListener('ended', onEnded);
      clip.addEventListener('error', onError_);
      clip.play().catch((err) => fail((err && (err.name || err.message)) || String(err)));
    }
    playNext();
  }

  // Call this once, inside a real click/tap handler, same spirit as
  // SFX.unlock() — primes every clip (play immediately paused again) while
  // still inside a user gesture, so browsers that gate HTMLAudioElement
  // playback on a gesture (some TV/set-top browsers are stricter about this
  // than desktop Chrome) have already granted it before the first REAL
  // announcement, which happens later from a Firebase event, not a click.
  function unlock() {
    Object.keys(CLIP_SRC).forEach((word) => {
      const clip = getClip(word);
      const p = clip.play();
      if (p && p.catch) p.catch(() => {}); // expected to be silently fine/no-op on browsers that don't need this
      clip.pause();
      clip.currentTime = 0;
    });
  }

  // Decides which word(s) to speak for a betting action and plays them in
  // order, then invokes onDone so the caller can follow up with the
  // existing chip SFX.
  //
  //   type:       'fold' | 'check' | 'call' | 'raise'
  //   openingBet: for a 'raise', true when there's no existing bet to call
  //               on this street yet (an opening bet) — says "Bet" instead
  //               of "Raise"
  //   allIn:      true when this action puts the player all-in — "All-in"
  //               plays right after the main word (both words, not a
  //               replacement — Mark's call)
  function announceAction({ type, openingBet = false, allIn = false }, onDone, onError) {
    const words = [];
    switch (type) {
      case 'fold': words.push('fold'); break;
      case 'check': words.push('check'); break;
      case 'call': words.push('call'); break;
      case 'raise': words.push(openingBet ? 'bet' : 'raise'); break;
      default: onDone && onDone(); return;
    }
    if (allIn) words.push('allin');
    playSequence(words, onDone, onError);
  }

  global.Announcer = { announceAction, playSequence, unlock };
})(typeof window !== 'undefined' ? window : globalThis);
