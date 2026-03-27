/**
 * Fuzzy transaction matcher: pairs OFX/QFX statement transactions with
 * YNAB uncleared transactions.
 *
 * Matching rules (all three must pass):
 *  1. Dollar amounts must match exactly (YNAB milliunits === OFX milliunits).
 *  2. Posting date must be within DATE_MAX days of the YNAB transaction date.
 *  3. Payee names must meet PAYEE_MIN fuzzy similarity threshold.
 *
 * Returns:
 *  { matched, unmatchedOfx, unmatchedYnab }
 *  matched      — [{ ofx, ynab, payeeScore, daysDiff }]
 *  unmatchedOfx — OFX transactions with no YNAB counterpart
 *  unmatchedYnab— YNAB transactions with no OFX counterpart
 */

const PAYEE_MIN = 0.35;   // minimum Jaccard word-overlap score
const DATE_MAX  = 5;      // maximum allowed days between dates

function normalizePayee(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    // Strip common noise words that differ between bank and YNAB names
    .replace(/\b(the|a|an|and|or|inc|llc|ltd|co|corp|store|purchase|payment|pos|debit|credit)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function payeeScore(statementName, ynabName) {
  const a = normalizePayee(statementName);
  const b = normalizePayee(ynabName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Substring containment (one name is a prefix/suffix of the other)
  if (a.includes(b) || b.includes(a)) return 0.85;
  // Jaccard word overlap
  const wa = a.split(' ').filter(Boolean);
  const wb = new Set(b.split(' ').filter(Boolean));
  const shared = wa.filter(w => wb.has(w)).length;
  const union  = new Set([...wa, ...wb]).size;
  return union > 0 ? shared / union : 0;
}

function daysDiff(dateA, dateB) {
  const a = new Date(dateA + 'T00:00:00');
  const b = new Date(dateB + 'T00:00:00');
  return Math.abs((a - b) / 86_400_000);
}

export function matchTransactions(ynabTxns, ofxTxns) {
  const usedYnab = new Set();
  const matched  = [];

  for (const ofx of ofxTxns) {
    let bestMatch = null;
    let bestScore = -1;

    for (const ynab of ynabTxns) {
      if (usedYnab.has(ynab.id)) continue;

      // Amounts must match exactly (both in milliunits, signed).
      if (ynab.amount !== ofx.amountMilliunits) continue;

      const dd = daysDiff(ofx.date, ynab.date);
      if (dd > DATE_MAX) continue;

      const ps = payeeScore(ofx.name, ynab.payee_name);
      if (ps < PAYEE_MIN) continue;

      // Composite score: payee is primary signal, date recency is tiebreak.
      const score = ps * 10 + (DATE_MAX - dd);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { ynab, payeeScore: ps, daysDiff: dd };
      }
    }

    if (bestMatch) {
      usedYnab.add(bestMatch.ynab.id);
      matched.push({
        ofx,
        ynab:       bestMatch.ynab,
        payeeScore: bestMatch.payeeScore,
        daysDiff:   bestMatch.daysDiff,
      });
    }
  }

  const matchedOfxIds  = new Set(matched.map(m => m.ofx.fitid));
  const matchedYnabIds = new Set(matched.map(m => m.ynab.id));

  return {
    matched,
    unmatchedOfx:  ofxTxns.filter(t => !matchedOfxIds.has(t.fitid)),
    unmatchedYnab: ynabTxns.filter(t => !matchedYnabIds.has(t.id)),
  };
}
