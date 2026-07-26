// Haarlem Hold'em — Phase 2, Step 6: stitching one full hand together.
// This is glue code, not new poker rules — it wires together the five
// already-tested modules (deck.js, turn-order.js, betting-round.js,
// pots.js, hand-eval.js) into the sequence a real hand actually follows:
//   deal -> preflop betting -> flop -> betting -> turn -> betting ->
//   river -> betting -> showdown -> award pot(s)
// with two early-exit paths a real hand also needs:
//   - everyone folds but one player -> they win immediately, no showdown
//   - two or more players are all-in and no one else CAN act -> the rest
//     of the board gets dealt out with no more betting, straight to showdown

import { shuffle, createDeck, dealHoleCards, dealBoardStage } from './deck.js';
import { assignBlinds, firstToActPreflop, firstToActPostflop, nextToAct } from './turn-order.js';
import { initBettingRound, applyAction, isRoundComplete, roundPotTotal } from './betting-round.js';
import { buildPots } from './pots.js';
import { bestHand, rankHands } from './hand-eval.js';

const STREETS = ['preflop', 'flop', 'turn', 'river'];

// Starts a brand-new hand. `stacks` and `dealerSeat` persist across hands
// (the caller carries these forward); everything else here is fresh.
export function startHand({ numSeats, activeSeats, stacks, dealerSeat, smallBlindAmount, bigBlindAmount }) {
  let deck = shuffle(createDeck());
  const { smallBlindSeat, bigBlindSeat } = assignBlinds(dealerSeat, numSeats, activeSeats);

  const bets = {};
  const workingStacks = { ...stacks };
  const postBlind = (seat, amount) => {
    const actual = Math.min(amount, workingStacks[seat]);
    bets[seat] = actual;
    workingStacks[seat] -= actual;
  };
  postBlind(smallBlindSeat, smallBlindAmount);
  postBlind(bigBlindSeat, bigBlindAmount);

  const { hands: holeCardsBySeat, remainingDeck } = dealHoleCards(deck, activeSeats.length, (dealerSeat + 1) % numSeats);
  deck = remainingDeck;
  const holeCards = {};
  activeSeats.forEach((seat, i) => { holeCards[seat] = holeCardsBySeat[i]; });

  const firstToAct = firstToActPreflop(dealerSeat, numSeats, activeSeats);

  return {
    numSeats,
    activeSeats: activeSeats.slice(),
    dealerSeat,
    smallBlindAmount,
    bigBlindAmount,
    deck,
    holeCards,
    board: [],
    street: 'preflop',
    foldedSeats: [],
    totalBets: { ...bets }, // accumulates across ALL streets, for pot calculation at the end
    stacks: workingStacks,
    lastAggressorThisStreet: null, // who last bet/raise this street — decides who shows first at showdown
    bettingRound: initBettingRound({
      numSeats, activeSeats, stacks: workingStacks, firstToAct, minRaiseAmount: bigBlindAmount, bets,
    }),
    result: null, // filled in once the hand ends
    pendingReveal: null, // filled in during a non-all-in showdown's turn-based reveal
    pendingVoluntaryShow: null, // filled in after an uncontested win, for the optional "show your bluff" moment
  };
}

// The seat still holding a stack of exactly 0 chips is "all-in" — this
// module doesn't track that as a separate list; it derives it from stacks,
// since betting-round.js already keeps stacks accurate per seat.
function allInSeats(state) {
  return state.activeSeats.filter(s => !state.foldedSeats.includes(s) && state.stacks[s] === 0);
}
function contenders(state) {
  return state.activeSeats.filter(s => !state.foldedSeats.includes(s) && state.stacks[s] > 0);
}
function seatsStillInHand(state) {
  return state.activeSeats.filter(s => !state.foldedSeats.includes(s));
}

// Applies one player action. Returns the new hand state. If that action
// completes the current betting round, this automatically advances the
// hand — dealing the next street, running out remaining streets with no
// betting if everyone's all-in, or reaching showdown and awarding pots.
export function applyHandAction(state, seat, action) {
  if (state.result) throw new Error('This hand is already complete.');

  let bettingRound = applyAction(state.bettingRound, seat, action);
  // Official showdown rule: the last player to bet/raise THIS street must
  // show their hand first (see the note above goToShowdown). Only tracked
  // per-street — reset to null whenever a new street's betting round starts.
  const lastAggressorThisStreet = action.type === 'raise' ? seat : state.lastAggressorThisStreet;
  // BUG FIX: this used to be `stacks: bettingRound.stacks`, which REPLACED
  // the whole-hand stacks object with the current betting round's version.
  // A betting round only tracks seats that are actually in it — once
  // someone folds, the next street's round is created with just the
  // remaining players, and its .stacks object has no entry for the folded
  // seat at all. That silently erased folded players' chip counts from the
  // hand's state (they'd show up as 0 chips at showdown), rather than just
  // freezing at whatever they had when they folded. Merging instead of
  // replacing keeps every seat's most recent known stack.
  let next = { ...state, bettingRound, stacks: { ...state.stacks, ...bettingRound.stacks }, lastAggressorThisStreet };

  if (action.type === 'fold') {
    next.foldedSeats = [...state.foldedSeats, seat];
  }
  // Roll this action's bet contribution into the whole-hand total so pot
  // calculation at showdown has the full picture, not just this street.
  next.totalBets = { ...state.totalBets };
  for (const s of next.activeSeats) {
    // BUG FIX: a folded seat isn't included in a NEW street's betting round
    // at all (correctly — they can't act), so bettingRound.bets[s] is
    // undefined for them from that point on. The old code only guarded the
    // PREVIOUS round's value with `|| 0`, not this round's, so the delta
    // came out as `undefined - 0` = NaN, silently corrupting that seat's
    // total for the rest of the hand. Both sides need the guard.
    next.totalBets[s] = (state.totalBets[s] || 0) + ((bettingRound.bets[s] || 0) - (state.bettingRound.bets[s] || 0));
  }

  if (!isRoundComplete(bettingRound)) {
    // BUG FIX: a fold can end the HAND (only one player left at all)
    // without the betting ROUND considering itself complete — those are
    // different questions. The betting round only tracks "does someone
    // still need to act to close this street's betting", which has no
    // concept of "there's only one player left in the entire hand, so
    // there's no one left to bet against regardless of what street-level
    // logic says." This came up specifically when a player folds despite
    // facing no bet (a "free fold", legal but unusual) — the betting round
    // still wanted the sole survivor to act, who then had nothing to
    // meaningfully do except also "fold", leaving the hand with nobody in
    // it at all and no winner. Checking this immediately after every fold,
    // regardless of the betting round's own state, closes that gap.
    const stillIn = seatsStillInHand(next);
    if (stillIn.length === 1) {
      return finishHand(next, { uncontested: true, winnerSeat: stillIn[0] });
    }
    return next;
  }
  return advanceAfterRoundComplete(next);
}

// Called once a betting round finishes. Decides what happens next: someone
// already won by everyone else folding, showdown, the next street, or
// (if everyone left is all-in) dealing out every remaining street with no
// more betting before going to showdown.
function advanceAfterRoundComplete(state) {
  const inHand = seatsStillInHand(state);

  if (inHand.length === 1) {
    return finishHand(state, { uncontested: true, winnerSeat: inHand[0] });
  }

  const streetIndex = STREETS.indexOf(state.street);
  const isLastStreet = state.street === 'river';

  // If 0 or 1 people left could even act, no more betting can happen this
  // hand — deal out every remaining street with no betting, straight to
  // showdown, exactly like a real all-in runout.
  const noMoreBettingPossible = contenders(state).length <= 1;

  if (isLastStreet) {
    return goToShowdown(state);
  }

  let dealt = state;
  const nextStreet = STREETS[streetIndex + 1];
  dealt = dealNextStreet(dealt, nextStreet);
  dealt.lastAggressorThisStreet = null; // fresh street, no aggressor yet

  if (noMoreBettingPossible) {
    // Keep dealing streets with no betting until we reach the river, then showdown.
    return advanceAfterRoundComplete({ ...dealt, street: nextStreet, bettingRound: null });
  }

  const firstToAct = findFirstContenderToAct(dealt, dealt.dealerSeat);
  const newBettingRound = initBettingRound({
    numSeats: dealt.numSeats,
    activeSeats: inHand,
    stacks: dealt.stacks,
    firstToAct,
    minRaiseAmount: dealt.bigBlindAmount,
  });
  return { ...dealt, street: nextStreet, bettingRound: newBettingRound };
}

function dealNextStreet(state, street) {
  const { cards, remainingDeck } = dealBoardStage(state.deck, street);
  return { ...state, deck: remainingDeck, board: [...state.board, ...cards] };
}

// Post-flop first-to-act, skipping anyone who's folded or already all-in
// (turn-order.js's firstToActPostflop assumes everyone passed in can act).
function findFirstContenderToAct(state, dealerSeat) {
  const inHand = seatsStillInHand(state);
  const nominal = firstToActPostflop(dealerSeat, state.numSeats, inHand);
  const eligible = contenders(state);
  if (eligible.includes(nominal)) return nominal;
  // Walk forward from the nominal seat until we find someone who can act.
  let seat = nominal;
  for (let i = 0; i < state.numSeats; i++) {
    if (eligible.includes(seat)) return seat;
    seat = nextToAct(seat, state.numSeats, inHand);
  }
  return null; // no one can act (shouldn't happen if caller already checked noMoreBettingPossible)
}

// Official rule (Robert's Rules of Poker / WSOP): the last player to bet or
// raise on the final betting round must show first; if everyone checked,
// the first active seat left of the dealer shows first. Everyone else then
// decides show/muck in turn order after that. EXCEPTION: if the showdown
// involves anyone all-in, tournaments (WSOP included) require everyone to
// show — no mucking at all. That's the ALREADY-EXISTING behavior below
// (immediate full reveal), so only the non-all-in case gets the new
// turn-based reveal phase.
function goToShowdown(state) {
  let dealt = state;
  // Deal any remaining board cards if we somehow reached here without them
  // (e.g. everyone went all-in before the flop was dealt at all).
  const streetIndex = STREETS.indexOf(dealt.street);
  for (let i = streetIndex + 1; i < STREETS.length; i++) {
    dealt = dealNextStreet(dealt, STREETS[i]);
  }

  const inHand = seatsStillInHand(dealt);
  const players = inHand.map(seat => ({ seat, holeCards: dealt.holeCards[seat] }));
  const ranking = rankHands(players, dealt.board);

  if (allInSeats(dealt).length > 0) {
    return finishHand(dealt, { uncontested: false, ranking });
  }

  const forcedShower = (dealt.lastAggressorThisStreet !== null && inHand.includes(dealt.lastAggressorThisStreet))
    ? dealt.lastAggressorThisStreet
    : firstToActPostflop(dealt.dealerSeat, dealt.numSeats, inHand);
  const order = [forcedShower];
  let seat = forcedShower;
  for (let i = 1; i < inHand.length; i++) {
    seat = nextToAct(seat, dealt.numSeats, inHand);
    order.push(seat);
  }

  return {
    ...dealt,
    pendingReveal: { order, currentIndex: 1, decisions: { [forcedShower]: 'shown' }, ranking },
    result: null,
  };
}

// Called when it's a seat's turn to Show or Muck during a non-all-in
// showdown's reveal phase (see goToShowdown above). Once everyone in the
// order has decided, awards the pot(s) using ONLY the shown hands — a
// mucked hand is dead and can never win, even if it was actually best.
export function applyRevealDecision(state, seat, decision) {
  if (!state.pendingReveal) throw new Error('No reveal is in progress.');
  if (decision !== 'show' && decision !== 'muck') throw new Error('Decision must be "show" or "muck".');
  const { order, currentIndex, decisions, ranking } = state.pendingReveal;
  if (currentIndex >= order.length) throw new Error('The reveal is already complete.');
  if (order[currentIndex] !== seat) throw new Error(`It's Seat ${order[currentIndex] + 1}'s turn to show or muck, not yours.`);

  const newDecisions = { ...decisions, [seat]: decision === 'show' ? 'shown' : 'mucked' };
  const newIndex = currentIndex + 1;

  if (newIndex < order.length) {
    return { ...state, pendingReveal: { ...state.pendingReveal, currentIndex: newIndex, decisions: newDecisions } };
  }

  // Everyone's decided — drop mucked seats from contention entirely (they
  // can't win regardless of what they were actually holding) and award the
  // pot(s) to the best hand among whoever actually showed.
  const shownOnlyRanking = ranking
    .map(group => group.filter(entry => newDecisions[entry.seat] === 'shown'))
    .filter(group => group.length > 0);
  const finished = finishHand({ ...state, pendingReveal: null }, { uncontested: false, ranking: shownOnlyRanking });
  return { ...finished, result: { ...finished.result, revealDecisions: newDecisions } };
}

// Shared ending path for both "everyone folded but one" and "showdown".
// Builds the pot(s) from the WHOLE hand's total bets and works out who
// gets what, including side pots for uneven all-ins.
function finishHand(state, outcome) {
  const pots = buildPots(state.totalBets, state.foldedSeats);
  const payouts = {}; // seat -> chips won
  state.activeSeats.forEach(s => { payouts[s] = 0; });

  if (outcome.uncontested) {
    // Uncontested wins still respect side-pot eligibility in the rare case
    // a side-pot-only player is the last one standing against folds, but
    // in the overwhelmingly common case this is just "give them everything".
    for (const pot of pots) {
      const winner = pot.eligibleSeats.includes(outcome.winnerSeat)
        ? outcome.winnerSeat
        : pot.eligibleSeats[0]; // shouldn't happen in practice; guard anyway
      payouts[winner] += pot.amount;
    }
  } else {
    // outcome.ranking is best-to-worst groups of tied {seat, hand}. For each
    // pot, award it to the best-ranked group that has at least one eligible
    // seat, split evenly among ties within that group.
    for (const pot of pots) {
      const winningGroup = outcome.ranking.find(group =>
        group.some(entry => pot.eligibleSeats.includes(entry.seat))
      );
      const eligibleInGroup = winningGroup.filter(entry => pot.eligibleSeats.includes(entry.seat));
      const share = Math.floor(pot.amount / eligibleInGroup.length);
      let remainder = pot.amount - share * eligibleInGroup.length;
      eligibleInGroup.forEach((entry, i) => {
        payouts[entry.seat] += share + (i < remainder ? 1 : 0);
      });
    }
  }

  const finalStacks = { ...state.stacks };
  Object.entries(payouts).forEach(([seat, amount]) => {
    finalStacks[Number(seat)] = (finalStacks[Number(seat)] || 0) + amount;
  });

  return {
    ...state,
    stacks: finalStacks,
    result: {
      pots,
      payouts,
      uncontested: outcome.uncontested,
      ranking: outcome.ranking || null,
    },
    // Uncontested wins never went to a real showdown, so nothing was ever
    // required to be revealed — but winning without a fight is exactly the
    // moment a voluntary "want to show your bluff?" prompt is fun. This is
    // purely cosmetic: the pot's already awarded above either way.
    pendingVoluntaryShow: outcome.uncontested ? { seat: outcome.winnerSeat, decided: false } : null,
  };
}

// Called when the winner of an uncontested hand decides whether to
// voluntarily reveal their hand. Purely cosmetic — the pot was already
// awarded in finishHand above, this can't change who won anything.
export function applyVoluntaryShowDecision(state, seat, decision) {
  if (!state.pendingVoluntaryShow) throw new Error('No voluntary show is pending.');
  if (state.pendingVoluntaryShow.decided) throw new Error('That decision has already been made.');
  if (state.pendingVoluntaryShow.seat !== seat) throw new Error('That choice belongs to a different seat.');
  if (decision !== 'show' && decision !== 'muck') throw new Error('Decision must be "show" or "muck".');

  return {
    ...state,
    pendingVoluntaryShow: { ...state.pendingVoluntaryShow, decided: true },
    result: decision === 'show'
      ? { ...state.result, voluntaryReveal: { seat, holeCards: state.holeCards[seat] } }
      : state.result,
  };
}
