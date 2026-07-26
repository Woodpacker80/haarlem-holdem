// Haarlem Hold'em — Phase 2, Step 3: betting rounds.
// Same pattern as deck.js / turn-order.js: pure functions, no Firebase/UI.
// State is a plain object; every action returns a NEW state, never mutates.
//
// Scope note: side pots (multiple players all-in for different amounts) are
// Step 4's job. This step handles a single all-in player correctly for
// their own stack, but doesn't yet split the pot into side pots — that's
// tracked in Step 4, not silently ignored.
//
// KNOWN SIMPLIFICATION (also deferred to Step 4, since it's tangled up with
// side pots): in real poker, an all-in raise for LESS than a full minimum
// raise does not "reopen" betting for players who already called the
// previous bet — they can only call/fold against a short all-in, not
// re-raise. This module currently treats every all-in raise as fully
// reopening the action. Rare in practice (needs a specific short-stack
// situation), but flagging it now so it doesn't get silently forgotten.

// Creates the starting state for one betting round (pre-flop, flop, turn,
// or river all use this the same way — pre-flop just starts with the
// blinds already posted, passed in via `bets`).
export function initBettingRound({ numSeats, activeSeats, stacks, firstToAct, minRaiseAmount, bets = {} }) {
  const startingBets = {};
  const startingStacks = {};
  for (const seat of activeSeats) {
    startingBets[seat] = bets[seat] || 0;
    startingStacks[seat] = stacks[seat];
  }
  const currentBet = Math.max(0, ...Object.values(startingBets));
  return {
    numSeats,
    activeSeats: activeSeats.slice(),
    bets: startingBets,
    stacks: startingStacks,
    folded: [],
    allIn: activeSeats.filter(seat => startingStacks[seat] === 0),
    currentBet,
    minRaiseAmount,
    actingSeat: firstToAct,
    lastAggressor: currentBet > 0 ? seatWithHighestBet(startingBets) : null,
    actedSinceLastAggression: [],
  };
}

function seatWithHighestBet(bets) {
  let best = null, bestAmount = -1;
  for (const [seat, amount] of Object.entries(bets)) {
    if (amount > bestAmount) { best = Number(seat); bestAmount = amount; }
  }
  return best;
}

function inHandSeats(state) {
  return state.activeSeats.filter(s => !state.folded.includes(s));
}

function canAct(state, seat) {
  return inHandSeats(state).includes(seat) && !state.allIn.includes(seat);
}

// Returns the set of legal actions for the seat currently acting, plus the
// numbers the UI needs (amount to call, min/max raise total). Call this
// before showing action buttons so folded/wrong-turn taps can't happen.
export function getLegalActions(state, seat) {
  if (state.actingSeat !== seat) return { legal: [], reason: 'not your turn' };
  if (!canAct(state, seat)) return { legal: [], reason: 'cannot act (folded or all-in)' };

  const toCall = state.currentBet - state.bets[seat];
  const stack = state.stacks[seat];
  const legal = ['fold'];

  if (toCall <= 0) {
    legal.push('check');
  } else {
    legal.push('call'); // if stack < toCall, this call is implicitly all-in for the full stack
  }

  // Raising requires enough stack to at least call PLUS the minimum raise
  // increment. A player short of that can only call-all-in or fold, not raise.
  const minRaiseTotal = state.currentBet + state.minRaiseAmount;
  const minRaiseCallPortion = toCall > 0 ? toCall : 0;
  if (stack > minRaiseCallPortion) {
    legal.push('raise');
  }

  return {
    legal,
    toCall: Math.min(toCall, stack),
    minRaiseTotal: Math.min(minRaiseTotal, state.bets[seat] + stack),
    maxRaiseTotal: state.bets[seat] + stack, // all-in
  };
}

// Applies one action for `seat`. Throws on anything illegal — the caller
// (UI or a future Cloud Function) is expected to have used getLegalActions
// first, so reaching an illegal action here means a bug upstream, not a
// normal "can't do that" case to display politely.
export function applyAction(state, seat, action) {
  if (state.actingSeat !== seat) throw new Error(`Seat ${seat + 1} tried to act out of turn.`);
  if (!canAct(state, seat)) throw new Error(`Seat ${seat + 1} cannot act (folded or all-in).`);

  const { legal, toCall, minRaiseTotal, maxRaiseTotal } = getLegalActions(state, seat);
  if (!legal.includes(action.type)) {
    throw new Error(`Seat ${seat + 1} cannot ${action.type} right now. Legal actions: ${legal.join(', ')}`);
  }

  let next = {
    ...state,
    bets: { ...state.bets },
    stacks: { ...state.stacks },
    folded: state.folded.slice(),
    allIn: state.allIn.slice(),
    actedSinceLastAggression: state.actedSinceLastAggression.slice(),
  };

  if (action.type === 'fold') {
    next.folded.push(seat);
  } else if (action.type === 'check') {
    next.actedSinceLastAggression.push(seat);
  } else if (action.type === 'call') {
    const amount = Math.min(toCall, next.stacks[seat]);
    next.bets[seat] += amount;
    next.stacks[seat] -= amount;
    if (next.stacks[seat] === 0) next.allIn.push(seat);
    next.actedSinceLastAggression.push(seat);
  } else if (action.type === 'raise') {
    const raiseTotal = action.amount;
    if (raiseTotal < minRaiseTotal && raiseTotal !== maxRaiseTotal) {
      throw new Error(`Raise of ${raiseTotal} is below the minimum of ${minRaiseTotal} (unless going all-in for ${maxRaiseTotal}).`);
    }
    if (raiseTotal > maxRaiseTotal) {
      throw new Error(`Raise of ${raiseTotal} exceeds seat ${seat + 1}'s available total of ${maxRaiseTotal}.`);
    }
    const additional = raiseTotal - next.bets[seat];
    next.bets[seat] = raiseTotal;
    next.stacks[seat] -= additional;
    if (next.stacks[seat] === 0) next.allIn.push(seat);
    next.currentBet = raiseTotal;
    next.minRaiseAmount = Math.max(next.minRaiseAmount, raiseTotal - state.currentBet);
    next.lastAggressor = seat;
    next.actedSinceLastAggression = [seat];
  }

  next.actingSeat = advanceToNextActor(next, seat);
  return next;
}

// Finds the next seat that still needs to act, or null if the round is over.
// Closing rule: the round ends once every remaining contender has acted at
// least once since the last voluntary bet/raise (or, if no one has raised
// yet, since the start of the round). This is deliberately the ONLY closing
// rule — earlier drafts also special-cased "we've come back around to
// whoever raised", but that incorrectly closed the round the moment action
// returned to the big blind, even though a posted blind isn't a voluntary
// action and the BB still gets their option to check or raise. Posted
// blinds intentionally do NOT go into actedSinceLastAggression at init, so
// the unified rule below naturally gives the BB their option.
function advanceToNextActor(state, fromSeat) {
  const contenders = inHandSeats(state).filter(s => !state.allIn.includes(s));
  // NOTE: there used to be a shortcut here — `if (contenders.length <= 1)
  // return null` — reasoning "everyone else folded or is all-in, nothing
  // left to decide". That's WRONG when the lone remaining contender hasn't
  // matched the current bet yet: e.g. seat A raises all-in, seat B calls
  // all-in for less, leaving seat C as the only contender — but seat C
  // still owes a call and must get to act. The loop below already handles
  // both the 0-contenders and 1-contender cases correctly via the
  // actedSinceLastAggression check, so the shortcut was redundant in the
  // safe cases and actively wrong in this one. Found via full-hand
  // integration testing, not by the betting-round tests alone — a good
  // reminder that a module can pass all its own tests and still have a bug
  // that only shows up once something else calls it in combination.

  let seat = fromSeat;
  for (let i = 0; i < state.numSeats; i++) {
    seat = (seat + 1) % state.numSeats;
    if (!contenders.includes(seat)) continue;
    if (state.actedSinceLastAggression.includes(seat)) return null;
    return seat;
  }
  return null;
}

export function isRoundComplete(state) {
  return state.actingSeat === null;
}

// Convenience: how much is in the pot from this betting round so far.
export function roundPotTotal(state) {
  return Object.values(state.bets).reduce((sum, b) => sum + b, 0);
}
