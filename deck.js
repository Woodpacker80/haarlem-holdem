// Haarlem Hold'em — Phase 2, Step 1: deck creation, shuffling, dealing.
// Deliberately has zero dependency on Firebase or the UI — this is pure
// game logic we can test on its own before wiring it into anything else.

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

// Returns a fresh, ordered 52-card deck. Each card is a small plain object
// so it's easy to serialize into Firebase later — no classes, no methods.
export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, id: `${rank}${suit}` });
    }
  }
  return deck;
}

// Fisher-Yates shuffle. Returns a NEW array — never mutates the input, so
// callers can't accidentally shuffle a deck that's already been dealt from.
export function shuffle(deck) {
  const result = deck.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Deals hole cards to `numPlayers`, one card at a time in rotation (the way
// a real dealer deals — not all of one player's cards at once), starting
// from `startSeat` (the seat left of the dealer button, once seating exists).
// Returns { hands, remainingDeck } — never mutates the deck it's given.
export function dealHoleCards(deck, numPlayers, startSeat = 0) {
  if (numPlayers < 2) throw new Error('Need at least 2 players to deal hole cards.');
  const cardsNeeded = numPlayers * 2;
  if (deck.length < cardsNeeded) throw new Error('Not enough cards left in the deck.');

  const hands = Array.from({ length: numPlayers }, () => []);
  const remainingDeck = deck.slice();
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < numPlayers; i++) {
      const seat = (startSeat + i) % numPlayers;
      hands[seat].push(remainingDeck.shift());
    }
  }
  return { hands, remainingDeck };
}

// Deals community cards for one board stage. Burns one card first, exactly
// like a real dealer, to match the deck accounting friends will expect if
// they ever watch cards get burned in a physical game.
// stage: 'flop' (3 cards), 'turn' (1), or 'river' (1).
const STAGE_COUNTS = { flop: 3, turn: 1, river: 1 };
export function dealBoardStage(deck, stage) {
  const count = STAGE_COUNTS[stage];
  if (!count) throw new Error(`Unknown board stage: ${stage}`);
  if (deck.length < count + 1) throw new Error('Not enough cards left to deal this stage.');

  const remainingDeck = deck.slice();
  const burned = remainingDeck.shift();
  const cards = remainingDeck.splice(0, count);
  return { cards, burned, remainingDeck };
}
