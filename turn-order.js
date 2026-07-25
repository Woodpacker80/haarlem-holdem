// Haarlem Hold'em — Phase 2, Step 2: dealer button, blinds, turn order.
// Pure logic again, no Firebase/UI. Seats are just integers 0..numSeats-1.

// Given the current dealer seat and which seats are still active (still
// seated with chips — folding mid-hand does NOT remove a seat from this
// list; only busting out of the game does), returns the next dealer seat,
// wrapping around and skipping any seat that isn't active.
export function advanceDealerButton(currentDealerSeat, numSeats, activeSeats) {
  if (activeSeats.length < 2) throw new Error('Need at least 2 active seats to advance the button.');
  let seat = (currentDealerSeat + 1) % numSeats;
  for (let i = 0; i < numSeats; i++) {
    if (activeSeats.includes(seat)) return seat;
    seat = (seat + 1) % numSeats;
  }
  throw new Error('No active seat found.');
}

// Returns the next active seat after `fromSeat`, wrapping around. Used both
// for advancing the dealer button and for stepping through betting order.
function nextActiveSeat(fromSeat, numSeats, activeSeats) {
  let seat = (fromSeat + 1) % numSeats;
  for (let i = 0; i < numSeats; i++) {
    if (activeSeats.includes(seat)) return seat;
    seat = (seat + 1) % numSeats;
  }
  throw new Error('No active seat found.');
}

// Assigns small/big blind seats for this hand. Heads-up (exactly 2 active
// players) is a special case in real poker: the dealer posts the SMALL
// blind (not the big blind), because with only 2 players "left of the
// dealer" and "the dealer" are the same rotation point either way — this
// is the rule itself, not a workaround.
export function assignBlinds(dealerSeat, numSeats, activeSeats) {
  if (activeSeats.length < 2) throw new Error('Need at least 2 active seats.');
  if (activeSeats.length === 2) {
    const smallBlindSeat = dealerSeat;
    const bigBlindSeat = nextActiveSeat(dealerSeat, numSeats, activeSeats);
    return { smallBlindSeat, bigBlindSeat };
  }
  const smallBlindSeat = nextActiveSeat(dealerSeat, numSeats, activeSeats);
  const bigBlindSeat = nextActiveSeat(smallBlindSeat, numSeats, activeSeats);
  return { smallBlindSeat, bigBlindSeat };
}

// First seat to act in the PRE-FLOP betting round.
// 3+ players: the seat after the big blind ("under the gun").
// Heads-up: the dealer/small blind acts first pre-flop — the one heads-up
// exception where the button acts before the other player, before the flop.
export function firstToActPreflop(dealerSeat, numSeats, activeSeats) {
  if (activeSeats.length === 2) return dealerSeat;
  const { bigBlindSeat } = assignBlinds(dealerSeat, numSeats, activeSeats);
  return nextActiveSeat(bigBlindSeat, numSeats, activeSeats);
}

// First seat to act in every round AFTER the flop (flop, turn, river).
// 3+ players: first active seat left of the dealer button.
// Heads-up: the big blind (non-dealer) acts first post-flop — the button
// acts last post-flop instead, the reverse of pre-flop.
export function firstToActPostflop(dealerSeat, numSeats, activeSeats) {
  if (activeSeats.length === 2) {
    const { bigBlindSeat } = assignBlinds(dealerSeat, numSeats, activeSeats);
    return bigBlindSeat;
  }
  return nextActiveSeat(dealerSeat, numSeats, activeSeats);
}

// Steps to the next seat still in the HAND (hasn't folded) for the current
// betting round. `inHandSeats` should exclude folded players but still
// include all-in players (they stay "in the hand" for showdown, they just
// can't act again — that distinction matters for Step 3, not here).
export function nextToAct(currentSeat, numSeats, inHandSeats) {
  return nextActiveSeat(currentSeat, numSeats, inHandSeats);
}
