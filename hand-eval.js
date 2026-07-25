// Haarlem Hold'em — Phase 2, Step 5: hand evaluation.
// Given a player's 2 hole cards + the 5 board cards, finds their best
// possible 5-card hand and ranks it against other players' best hands.
// Pure logic again, no Firebase/UI. Cards are the same {rank, suit, id}
// shape produced by deck.js.

const RANK_VALUES = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

// Hand category strength, low to high — used as the primary sort key.
const CATEGORY = {
  HIGH_CARD: 0, PAIR: 1, TWO_PAIR: 2, THREE_KIND: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, FOUR_KIND: 7, STRAIGHT_FLUSH: 8,
};
export const CATEGORY_NAMES = Object.fromEntries(Object.entries(CATEGORY).map(([k, v]) => [v, k]));

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

// Evaluates exactly 5 cards. Returns { category, tiebreakers } where
// tiebreakers is an array of rank values used to break ties WITHIN the same
// category, most significant first — e.g. two pair (K,K,4,4,9) tiebreakers
// are [13, 4, 9]: pair rank, other pair rank, kicker.
function evaluateFiveCards(cards) {
  const values = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([v, count]) => ({ value: Number(v), count }))
    .sort((a, b) => (b.count - a.count) || (b.value - a.value));

  // Straight check, handling both normal straights and the wheel (A-2-3-4-5,
  // where the Ace counts LOW instead of its usual high value of 14).
  const distinctDesc = [...new Set(values)];
  let straightHigh = null;
  if (distinctDesc.length >= 5) {
    for (let i = 0; i <= distinctDesc.length - 5; i++) {
      if (distinctDesc[i] - distinctDesc[i + 4] === 4) { straightHigh = distinctDesc[i]; break; }
    }
  }
  if (straightHigh === null && distinctDesc.includes(14) && distinctDesc.includes(5) &&
      distinctDesc.includes(4) && distinctDesc.includes(3) && distinctDesc.includes(2)) {
    straightHigh = 5; // wheel: straight plays as 5-high, not ace-high
  }

  if (isFlush && straightHigh !== null) {
    return { category: CATEGORY.STRAIGHT_FLUSH, tiebreakers: [straightHigh] };
  }
  if (groups[0].count === 4) {
    const kicker = groups.find(g => g.count === 1).value;
    return { category: CATEGORY.FOUR_KIND, tiebreakers: [groups[0].value, kicker] };
  }
  if (groups[0].count === 3 && groups[1] && groups[1].count >= 2) {
    return { category: CATEGORY.FULL_HOUSE, tiebreakers: [groups[0].value, groups[1].value] };
  }
  if (isFlush) {
    return { category: CATEGORY.FLUSH, tiebreakers: values };
  }
  if (straightHigh !== null) {
    return { category: CATEGORY.STRAIGHT, tiebreakers: [straightHigh] };
  }
  if (groups[0].count === 3) {
    const kickers = groups.filter(g => g.count === 1).map(g => g.value).sort((a, b) => b - a);
    return { category: CATEGORY.THREE_KIND, tiebreakers: [groups[0].value, ...kickers] };
  }
  if (groups[0].count === 2 && groups[1] && groups[1].count === 2) {
    const pairValues = [groups[0].value, groups[1].value].sort((a, b) => b - a);
    const kicker = groups.find(g => g.count === 1).value;
    return { category: CATEGORY.TWO_PAIR, tiebreakers: [...pairValues, kicker] };
  }
  if (groups[0].count === 2) {
    const kickers = groups.filter(g => g.count === 1).map(g => g.value).sort((a, b) => b - a);
    return { category: CATEGORY.PAIR, tiebreakers: [groups[0].value, ...kickers] };
  }
  return { category: CATEGORY.HIGH_CARD, tiebreakers: values };
}

// Compares two evaluated hands. Returns positive if `a` wins, negative if
// `b` wins, 0 for a true tie (split pot).
function compareEvaluated(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const diff = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Finds the best possible 5-card hand out of any set of cards (typically 7:
// 2 hole + 5 board). Tries every 5-card combination and keeps the winner.
export function bestHand(cards) {
  if (cards.length < 5) throw new Error('Need at least 5 cards to evaluate a hand.');
  const fiveCardHands = combinations(cards, 5);
  let best = null;
  for (const hand of fiveCardHands) {
    const evaluated = evaluateFiveCards(hand);
    if (best === null || compareEvaluated(evaluated, best.evaluated) > 0) {
      best = { cards: hand, evaluated };
    }
  }
  return {
    cards: best.cards,
    category: best.evaluated.category,
    categoryName: CATEGORY_NAMES[best.evaluated.category],
    tiebreakers: best.evaluated.tiebreakers,
  };
}

// Ranks multiple players' hands (each { seat, holeCards }) against a shared
// board. Returns an array of groups sorted best-to-worst; each group is an
// array of one or more { seat, hand } that are exactly tied (a split pot).
export function rankHands(players, board) {
  const withHands = players.map(p => ({ seat: p.seat, hand: bestHand([...p.holeCards, ...board]) }));
  withHands.sort((a, b) => compareEvaluated(
    { category: b.hand.category, tiebreakers: b.hand.tiebreakers },
    { category: a.hand.category, tiebreakers: a.hand.tiebreakers }
  ));

  const groups = [];
  for (const entry of withHands) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup) {
      const cmp = compareEvaluated(
        { category: entry.hand.category, tiebreakers: entry.hand.tiebreakers },
        { category: lastGroup[0].hand.category, tiebreakers: lastGroup[0].hand.tiebreakers }
      );
      if (cmp === 0) { lastGroup.push(entry); continue; }
    }
    groups.push([entry]);
  }
  return groups;
}
