/**
 * Fuzzy transaction matcher.
 *
 * Phase 1 — fuzzy match (all three must pass):
 *   1. Dollar amounts match exactly (milliunits).
 *   2. Posting date within DATE_MAX days.
 *   3. Payee similarity >= PAYEE_MIN.
 *
 * Phase 2 — amount+date fallback for anything still unmatched:
 *   Pairs where amounts match exactly and dates are within DATE_MAX days,
 *   but ONLY when the pairing is unambiguous (each side has exactly one
 *   candidate at that amount in the date window). These require user approval.
 *
 * Returns:
 *   { matched, pendingMatches, unmatchedOfx, unmatchedYnab }
 *   matched        — confirmed matches [{ ofx, ynab, payeeScore, daysDiff, manual?, approved? }]
 *   pendingMatches — amount/date-only matches [{ ofx, ynab, payeeScore:null, daysDiff, pending:true }]
 *   unmatchedOfx   — OFX transactions with no confirmed or pending match
 *   unmatchedYnab  — YNAB transactions with no confirmed or pending match
 */

const PAYEE_MIN = 0.35;
const DATE_MAX  = 5;

// Noise words common in bank statement descriptions that dilute payee similarity.
const NOISE = new Set([
  'the','a','an','and','or','of','at','in','on','for','to','by',
  'inc','llc','ltd','co','corp','store','purchase','payment',
  'pos','debit','credit','card',
]);

function normalizePayee(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantWords(normalized) {
  return normalized.split(' ').filter(w => w.length >= 2 && !NOISE.has(w));
}

/**
 * Score payee similarity using:
 *  1. Full-string containment (one normalized string contains the other).
 *  2. Word-level containment with prefix/abbreviation support
 *     (e.g. "GR" matches "GROUP" because "GROUP".startsWith("GR")).
 *  3. Classic Jaccard word-overlap as a fallback.
 * Returns a value in [0, 1]; higher is more similar.
 */
function payeeScore(statementName, ynabName) {
  const a = normalizePayee(statementName);
  const b = normalizePayee(ynabName);
  if (!a || !b) return 0;
  if (a === b) return 1;

  // One normalized string is a substring of the other.
  if (a.includes(b) || b.includes(a)) return 0.85;

  const wa = significantWords(a);
  const wb = significantWords(b);
  if (wa.length === 0 || wb.length === 0) return 0;

  // Word-level scoring against the shorter word list as the reference.
  // Exact matches score 1.0; prefix/abbreviation matches score 0.8.
  const shorter = wa.length <= wb.length ? wa : wb;
  const longer  = wa.length <= wb.length ? wb : wa;

  let hit = 0;
  for (const sw of shorter) {
    if (longer.includes(sw)) {
      hit++;
    } else if (sw.length >= 2 && longer.some(lw => lw.startsWith(sw) && lw.length > sw.length)) {
      // sw is an abbreviation prefix of some word in longer  (e.g. "GR" → "GROUP")
      hit += 0.8;
    } else if (sw.length >= 2 && longer.some(lw => lw.length >= 2 && sw.startsWith(lw) && lw.length < sw.length)) {
      // a word in longer is an abbreviation prefix of sw (reverse direction)
      hit += 0.8;
    }
  }
  const containment = hit / shorter.length;

  // Classic Jaccard for comparison.
  const setA   = new Set(wa);
  const setB   = new Set(wb);
  const shared = [...setA].filter(w => setB.has(w)).length;
  const union  = new Set([...wa, ...wb]).size;
  const jaccard = union > 0 ? shared / union : 0;

  return Math.max(containment, jaccard);
}

function daysDiff(dateA, dateB) {
  const a = new Date(dateA + 'T00:00:00');
  const b = new Date(dateB + 'T00:00:00');
  return Math.abs((a - b) / 86_400_000);
}

export function matchTransactions(ynabTxns, ofxTxns) {
  // ── Phase 1: fuzzy matching ──────────────────────────────────────────────
  const usedYnab = new Set();
  const matched  = [];

  for (const ofx of ofxTxns) {
    let bestMatch = null;
    let bestScore = -1;

    for (const ynab of ynabTxns) {
      if (usedYnab.has(ynab.id)) continue;
      if (ynab.amount !== ofx.amountMilliunits) continue;

      const dd = daysDiff(ofx.date, ynab.date);
      if (dd > DATE_MAX) continue;

      const ps = payeeScore(ofx.name, ynab.payee_name);
      if (ps < PAYEE_MIN) continue;

      const score = ps * 10 + (DATE_MAX - dd);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { ynab, payeeScore: ps, daysDiff: dd };
      }
    }

    if (bestMatch) {
      usedYnab.add(bestMatch.ynab.id);
      matched.push({ ofx, ynab: bestMatch.ynab, payeeScore: bestMatch.payeeScore, daysDiff: bestMatch.daysDiff });
    }
  }

  const matchedOfxIds  = new Set(matched.map(m => m.ofx.fitid));
  const matchedYnabIds = new Set(matched.map(m => m.ynab.id));

  const remainingOfx  = ofxTxns.filter(t => !matchedOfxIds.has(t.fitid));
  const remainingYnab = ynabTxns.filter(t => !matchedYnabIds.has(t.id));

  // ── Phase 2: amount+date fallback ────────────────────────────────────────
  // Build candidate maps so we can enforce uniqueness on both sides.
  const ofxCandidates  = new Map(); // fitid  → ynab[]
  const ynabCandidates = new Map(); // ynab.id → ofx[]

  for (const ofx of remainingOfx) {
    const hits = remainingYnab.filter(
      ynab => ynab.amount === ofx.amountMilliunits && daysDiff(ofx.date, ynab.date) <= DATE_MAX
    );
    ofxCandidates.set(ofx.fitid, hits);
    for (const ynab of hits) {
      if (!ynabCandidates.has(ynab.id)) ynabCandidates.set(ynab.id, []);
      ynabCandidates.get(ynab.id).push(ofx);
    }
  }

  const pendingMatches = [];
  const pendingOfxIds  = new Set();
  const pendingYnabIds = new Set();

  for (const ofx of remainingOfx) {
    const yMatches = ofxCandidates.get(ofx.fitid) || [];
    if (yMatches.length !== 1) continue;              // ambiguous or no hit on OFX side

    const ynab = yMatches[0];
    const oMatches = ynabCandidates.get(ynab.id) || [];
    if (oMatches.length !== 1) continue;              // ambiguous on YNAB side

    pendingMatches.push({
      ofx,
      ynab,
      payeeScore: null,
      daysDiff:   daysDiff(ofx.date, ynab.date),
      pending:    true,
    });
    pendingOfxIds.add(ofx.fitid);
    pendingYnabIds.add(ynab.id);
  }

  return {
    matched,
    pendingMatches,
    unmatchedOfx:  remainingOfx.filter(t => !pendingOfxIds.has(t.fitid)),
    unmatchedYnab: remainingYnab.filter(t => !pendingYnabIds.has(t.id)),
  };
}
