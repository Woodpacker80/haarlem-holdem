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

  // Plays a list of words back-to-back (e.g. ['raise', 'allin']), each one
  // waiting for the previous to actually finish, then calls `onDone`. If a
  // clip fails to play for any reason (missing file, autoplay block, etc.)
  // this moves on rather than silently hanging the sequence — a missing
  // announcer line should never stop the chip sound or the game itself.
  function playSequence(words, onDone) {
    let i = 0;
    function playNext() {
      if (i >= words.length) { onDone && onDone(); return; }
      const clip = getClip(words[i]);
      i++;
      const advance = () => { clip.removeEventListener('ended', advance); playNext(); };
      clip.currentTime = 0;
      clip.addEventListener('ended', advance);
      clip.play().catch(advance);
    }
    playNext();
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
  function announceAction({ type, openingBet = false, allIn = false }, onDone) {
    const words = [];
    switch (type) {
      case 'fold': words.push('fold'); break;
      case 'check': words.push('check'); break;
      case 'call': words.push('call'); break;
      case 'raise': words.push(openingBet ? 'bet' : 'raise'); break;
      default: onDone && onDone(); return;
    }
    if (allIn) words.push('allin');
    playSequence(words, onDone);
  }

  global.Announcer = { announceAction, playSequence };
})(typeof window !== 'undefined' ? window : globalThis);
