// Haarlem Hold'em — wiring Phase 2's tested game logic into real Firebase
// sync. Builds on firebase-config.js (Phase 1) rather than replacing it.
//
// Architecture: the TV is the single "host" — it's the only device that
// runs full-hand.js and writes the canonical game state. Phones never
// mutate shared state directly; they push action REQUESTS to a queue, the
// TV validates and applies each one (via the already-tested full-hand.js),
// then publishes the result. This avoids two phones racing to write
// conflicting state with no server to arbitrate.
//
// HONEST LIMITATION: hole cards are written to a path scoped per seat
// (game/holeCards/{seat}) so this is architecturally ready for real
// per-seat access control — but that control doesn't exist yet (it needs
// player identity/session management, which is Phase 4). Right now anyone
// who opened dev tools could read another seat's cards from the database
// directly, even though the phone UI only displays your own. Fine for
// testing with people you trust in the room; not a real privacy guarantee.

import { db, roomRef, ensureAuth } from './firebase-config.js';
import {
  ref, set, get, remove, push, onValue, onChildAdded, runTransaction, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const MAX_SEATS = 6;

// This phone's own in-flight claim, if any. See the note in claimSeat below
// for why this exists — it's not about two different phones racing (the
// runTransaction below already handles that correctly), it's about THIS
// phone's own two listeners (disconnect-recovery and reset-recovery)
// potentially both trying to claim a seat around the same moment.
let inFlightClaim = null;

// Tries to claim the lowest-numbered open seat for this device's uid, using
// a transaction so two phones claiming at once can't both grab the same
// seat. Returns the claimed seat index, or null if the room is full or this
// uid already holds a seat (in which case it returns that existing seat).
//
// REAL BUG FOUND: this phone has two separate listeners that can each call
// claimSeat(myUid) — one reacting to a disconnect/reconnect, one reacting to
// a host reset. If both fire close together (a reset often coincides with a
// brief connection blip), BOTH calls could start their own "do I already
// have a seat?" check before EITHER has written anything — so both see "no"
// and each proceeds to independently claim a seat, landing the same uid on
// two different seats. The transaction below correctly stops two phones
// from grabbing the same seat, but does nothing to stop one phone's own
// two concurrent calls from grabbing two DIFFERENT seats. Fixed by having
// any call that arrives while one's already in flight just wait for that
// one's result instead of racing it.
export function claimSeat(uid) {
  if (inFlightClaim) return inFlightClaim;
  inFlightClaim = doClaimSeat(uid).finally(() => { inFlightClaim = null; });
  return inFlightClaim;
}

async function doClaimSeat(uid) {
  const bannedSnap = await get(roomRef(`game/banned/${uid}`));
  if (bannedSnap.val()) return null; // host kicked this device — no auto-rejoin

  const seatsSnap = await get(roomRef('game/seats'));
  const seats = seatsSnap.val() || {};
  for (const [seatStr, seatUid] of Object.entries(seats)) {
    if (seatUid === uid) return Number(seatStr); // already have a seat
  }
  for (let i = 0; i < MAX_SEATS; i++) {
    if (seats[i]) continue;
    const seatRef = roomRef(`game/seats/${i}`);
    const result = await runTransaction(seatRef, (current) => {
      if (current) return; // someone else claimed it a moment ago — abort
      return uid;
    });
    if (result.committed) {
      onDisconnectClearSeat(i);
      return i;
    }
    // transaction aborted (lost the race) — try the next seat
  }
  return null; // room full
}

function onDisconnectClearSeat(seatIndex) {
  // Best-effort: if this phone disconnects, free the seat. Real reconnect
  // handling (rejoining the SAME seat after a dropped connection) is Phase
  // 4 scope — for now a disconnect just vacates the seat.
  onDisconnect(roomRef(`game/seats/${seatIndex}`)).remove();
}

const LS_UID_KEY = 'hh_last_uid';
const LS_SEAT_KEY = 'hh_last_seat';

// Safety net for the "one phone, two seats" bug: if THIS browser somehow
// comes back with a different uid than last time (see the persistence note
// in firebase-config.js), the old uid's seat can sit occupied until
// Firebase's own disconnect-detection notices it's gone — which can take
// up to a minute. This uses plain localStorage (independent of whatever
// Firebase Auth's own persistence is doing) to remember this browser's own
// last (uid, seat) and proactively frees it the moment a mismatch is
// noticed, rather than waiting on the server to catch up.
export async function releaseStaleLocalSeat(currentUid) {
  const lastUid = localStorage.getItem(LS_UID_KEY);
  const lastSeat = localStorage.getItem(LS_SEAT_KEY);
  if (lastUid && lastSeat !== null && lastUid !== currentUid) {
    const seatRef = roomRef(`game/seats/${lastSeat}`);
    const snap = await get(seatRef);
    if (snap.val() === lastUid) {
      await remove(seatRef);
    }
  }
}

export function rememberLocalSeat(uid, seat) {
  localStorage.setItem(LS_UID_KEY, uid);
  localStorage.setItem(LS_SEAT_KEY, String(seat));
}

export function watchSeats(cb) {
  onValue(roomRef('game/seats'), (snap) => cb(snap.val() || {}));
}

// Player names, keyed by seat — separate from game/seats (uid ownership) and
// game/public (per-hand state), since a name belongs to the SESSION, not to
// any one hand, and shouldn't get wiped by Quit Game / Start New Game.
//
// Each entry is { base, display }: `base` is exactly what the player typed
// (used to detect future collisions), `display` is what's actually shown —
// identical to `base` unless there's a duplicate, in which case BOTH the
// original joiner and the new one get a letter suffix (first "Mark" becomes
// "Mark A", second becomes "Mark B", a third "Mark" later becomes "Mark C",
// and so on). This has to live here rather than in phone.html because
// assigning a letter means looking at (and sometimes rewriting) every OTHER
// seat's name too, not just the one joining.
export async function claimName(seat, rawName) {
  const base = rawName.trim();
  const [namesSnap, seatsSnap] = await Promise.all([
    get(roomRef('game/playerNames')),
    get(roomRef('game/seats')),
  ]);
  const names = namesSnap.val() || {};
  const occupiedSeats = seatsSnap.val() || {};
  // A name only counts as a real collision if that OTHER seat is actually
  // occupied by someone right now. Without this check, a phone that
  // reloads and lands on a different seat than before would see its own
  // orphaned name (left behind on the seat it vacated) as a "second
  // person" with the same name, and wrongly relabel itself "Mark B"
  // against nobody but its own leftover data.
  const matches = Object.entries(names).filter(([s, v]) =>
    Number(s) !== seat && occupiedSeats[s] && v && v.base && v.base.toLowerCase() === base.toLowerCase());

  if (matches.length === 0) {
    await set(roomRef(`game/playerNames/${seat}`), { base, display: base });
    return;
  }

  const usedLetters = matches
    .map(([, v]) => v.display.slice(base.length).trim())
    .filter((suffix) => /^[A-Z]$/.test(suffix));

  let letterIndex = usedLetters.length; // e.g. "A" and "B" already used -> this one is "C"
  if (usedLetters.length === 0) {
    // First-ever collision for this name — relabel the ORIGINAL joiner to
    // "A" too, retroactively, since up to now they were shown with no
    // suffix at all.
    const [firstSeat] = matches[0];
    await set(roomRef(`game/playerNames/${firstSeat}`), { base, display: `${base} A` });
    letterIndex = 1; // this new one becomes "B"
  }
  const letter = String.fromCharCode(65 + letterIndex);
  await set(roomRef(`game/playerNames/${seat}`), { base, display: `${base} ${letter}` });
}
export function watchPlayerNames(cb) {
  onValue(roomRef('game/playerNames'), (snap) => cb(snap.val() || {}));
}

// Public game state: everything except hole cards (board, street, whose
// turn, stacks, bets, folded/all-in status, dealer seat, result). Every
// screen reads this the same way.
export function writePublicState(publicState) {
  return set(roomRef('game/public'), publicState);
}
export function watchPublicState(cb) {
  onValue(roomRef('game/public'), (snap) => cb(snap.val()));
}

// Hole cards, scoped per seat (see the limitation note at the top of this file).
export function writeHoleCards(holeCardsBySeat) {
  return set(roomRef('game/holeCards'), holeCardsBySeat);
}
export function watchOwnHoleCards(seat, cb) {
  return onValue(roomRef(`game/holeCards/${seat}`), (snap) => cb(snap.val() || null));
}

// Phones call this to REQUEST an action — they never apply it themselves.
export function requestAction(seat, action) {
  return push(roomRef('game/actionQueue'), { seat, action, requestedAt: serverTimestamp() });
}

// Host (TV) only: watches for new action requests in arrival order and
// removes each one once processed, so it's never applied twice.
export function watchActionQueue(cb) {
  onChildAdded(roomRef('game/actionQueue'), (snap) => {
    cb(snap.key, snap.val());
  });
}
export function clearActionQueueItem(key) {
  return remove(roomRef(`game/actionQueue/${key}`));
}

// Host (TV) only: kicks whoever's in a seat AND bans their uid, so their
// phone's own auto-rejoin (which exists specifically to survive a reset
// smoothly) can't just grab a seat straight back. This is the fix for: a
// forgotten open tab silently re-claiming a seat every time the host tries
// to start a fresh game.
export function kickSeat(uid, seatIndex) {
  return Promise.all([
    set(roomRef(`game/banned/${uid}`), true),
    remove(roomRef(`game/seats/${seatIndex}`)),
  ]);
}

// Host-only: lifts all kicks. Bans deliberately survive New Game/Reset (see
// clearGameState below) since the whole point is to keep a kicked phone out
// through a reset — so this is a separate, explicit action.
export function clearBans() {
  return remove(roomRef('game/banned'));
}

// Host-only: a genuinely complete reset. Clears seats, public state, hole
// cards, and any queued actions, so a "New Game" click can never leave
// stale data (like leftover hole cards) sitting around for a phone to
// accidentally display. Everyone has to rejoin/re-claim a seat afterward —
// deliberately, so there's no ambiguity about who's playing next.
// Deliberately does NOT clear game/banned — see kickSeat/clearBans above.
export function clearGameState() {
  return Promise.all([
    remove(roomRef('game/seats')),
    remove(roomRef('game/public')),
    remove(roomRef('game/holeCards')),
    remove(roomRef('game/actionQueue')),
  ]);
}

export { ensureAuth };
