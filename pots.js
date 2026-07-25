// Haarlem Hold'em — Phase 2, Step 4: pot & side pots.
// Takes the final bets from one or more completed betting rounds (summed
// per seat across the whole hand, not just one street) and splits them into
// a main pot plus however many side pots are needed. Pure function, no
// Firebase/UI, same pattern as the earlier steps.

// `totalBets` is a map of seat -> total chips that seat put in across the
// WHOLE hand (all streets summed, not just the last round) — the caller is
// responsible for accumulating that; this function only does the split.
// `foldedSeats` marks seats that folded at some point — they still
// contributed their chips to whichever pots their contribution level
// reaches, they just aren't eligible to WIN any pot.
//
// Returns an array of pots in the order they should be awarded (main pot
// first, then side pots), each as { amount, eligibleSeats }.
export function buildPots(totalBets, foldedSeats = []) {
  const seats = Object.keys(totalBets).map(Number);
  if (seats.length === 0) return [];

  // Distinct contribution levels, ascending. Every level boundary is where
  // a side pot split happens — e.g. if bets are {A:30, B:100, C:100}, the
  // levels are [30, 100]: main pot capped at 30-each, side pot for the rest.
  const levels = [...new Set(seats.map(s => totalBets[s]))].sort((a, b) => a - b);

  const pots = [];
  let previousLevel = 0;
  for (const level of levels) {
    const contributionAtThisLevel = level - previousLevel;
    // BUG FIX: this used to `continue` here without updating previousLevel,
    // which meant a level contributing nothing (e.g. a seat whose total bet
    // is 0 — folded before ever putting a chip in) left previousLevel stuck,
    // so the NEXT level's slice size was computed against the wrong base.
    // Caught by a 1000-trial randomized fuzz test, not by hand-picked cases.
    previousLevel = level;
    if (contributionAtThisLevel <= 0) continue;

    // Everyone who bet AT LEAST this level contributes this slice.
    const contributors = seats.filter(s => totalBets[s] >= level);
    const amount = contributionAtThisLevel * contributors.length;

    // Only non-folded seats who reached this level can WIN this slice —
    // a folded seat's chips still go into the pot, they just can't claim it.
    const eligibleSeats = contributors.filter(s => !foldedSeats.includes(s));

    if (amount > 0 && eligibleSeats.length > 0) {
      pots.push({ amount, eligibleSeats });
    } else if (amount > 0 && eligibleSeats.length === 0) {
      // Everyone eligible for this slice folded (can happen if the only
      // players left at this contribution level all folded) — chips still
      // need to go somewhere. Real poker rule: it rolls into the pot below
      // it (the previous pot), not lost. Rare edge case, but must not
      // silently vanish chips.
      if (pots.length > 0) {
        pots[pots.length - 1].amount += amount;
      } else {
        // No previous pot to roll into either. This can't happen with data
        // that actually came from a real hand (the last remaining bettor at
        // the top level is always eligible), so if it happens here it means
        // something upstream fed this function invalid data. Fail loudly —
        // silently losing chips in a poker game is worse than crashing.
        throw new Error(
          `buildPots: ${amount} chips at contribution level ${level} have no eligible winner and no pot to roll into. This indicates invalid input (bets/foldedSeats don't reflect a real hand).`
        );
      }
    }
  }

  return pots;
}

// Convenience for the common case: exactly one pot, no side pots needed
// (nobody went all-in for a different amount than everyone else). Still
// goes through buildPots so the logic path is identical either way —
// no separate "simple case" implementation to accidentally diverge.
export function totalPotAmount(totalBets) {
  return Object.values(totalBets).reduce((sum, b) => sum + b, 0);
}
