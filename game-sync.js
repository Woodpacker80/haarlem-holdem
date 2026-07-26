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

// Tries to claim the lowest-numbered open seat for this device's uid, using
// a transaction so two phones claiming at once can't both grab the same
// seat. Returns the claimed seat index, or null if the room is full or this
// uid already holds a seat (in which case it returns that existing seat).
export async function claimSeat(uid) {
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

// Host-only: a genuinely complete reset. Clears seats, public state, hole
// cards, and any queued actions, so a "New Game" click can never leave
// stale data (like leftover hole cards) sitting around for a phone to
// accidentally display. Everyone has to rejoin/re-claim a seat afterward —
// deliberately, so there's no ambiguity about who's playing next.
export function clearGameState() {
  return Promise.all([
    remove(roomRef('game/seats')),
    remove(roomRef('game/public')),
    remove(roomRef('game/holeCards')),
    remove(roomRef('game/actionQueue')),
  ]);
}

export { ensureAuth };
