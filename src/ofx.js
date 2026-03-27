/**
 * OFX/QFX file parser.
 * Handles both modern XML variant and legacy SGML variant (no closing tags).
 * Returns: { startingBalanceMilliunits, endingBalanceMilliunits, endingBalanceDate,
 *            statementStart, statementEnd, transactions }
 * Each transaction: { fitid, date, amountMilliunits, name, memo, type }
 */

function parseDate(raw) {
  // OFX dates: YYYYMMDD or YYYYMMDDHHMMSS[.mmm][TZ]
  const digits = String(raw).replace(/\D/g, '').slice(0, 8);
  if (digits.length < 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

// Extract the value of a leaf tag — works for both XML (<TAG>val</TAG>) and
// SGML (<TAG>val\n or <TAG>val<NEXTTAG>).
function leafVal(text, tag) {
  let m = text.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`, 'i'));
  if (m) return m[1].trim();
  m = text.match(new RegExp(`<${tag}>([^\r\n<]+)`, 'i'));
  return m ? m[1].trim() : null;
}

export function parseOFX(rawText) {
  // Strip SGML header — everything before the first <OFX> tag.
  const ofxIdx = rawText.indexOf('<OFX>');
  const body = ofxIdx >= 0 ? rawText.slice(ofxIdx) : rawText;

  // ── Ending balance ─────────────────────────────────────────────────────────
  const balStart = body.search(/<LEDGERBAL>/i);
  if (balStart === -1) throw new Error('OFX parse error: could not find <LEDGERBAL> block.');
  // Take a generous window after the tag — enough to capture BALAMT and DTASOF.
  const balSlice = body.slice(balStart, balStart + 500);
  const balAmtStr = leafVal(balSlice, 'BALAMT');
  if (!balAmtStr) throw new Error('OFX parse error: could not find BALAMT inside LEDGERBAL.');
  const endingBalanceMilliunits = Math.round(parseFloat(balAmtStr) * 1000);
  const dtAsofRaw = leafVal(balSlice, 'DTASOF');
  const endingBalanceDate = dtAsofRaw ? parseDate(dtAsofRaw) : null;

  // ── Statement period ───────────────────────────────────────────────────────
  const dtStartRaw = leafVal(body, 'DTSTART');
  const dtEndRaw   = leafVal(body, 'DTEND');
  const statementStart = dtStartRaw ? parseDate(dtStartRaw) : null;
  const statementEnd   = dtEndRaw   ? parseDate(dtEndRaw)   : endingBalanceDate;

  // ── Transactions ───────────────────────────────────────────────────────────
  // Split on <STMTTRN> — valid for both XML and SGML since the opening tag is
  // always present. For XML we then strip content after </STMTTRN>.
  const parts = body.split(/<STMTTRN>/i);
  const transactions = parts.slice(1).map((chunk, i) => {
    const content = chunk.split(/<\/STMTTRN>/i)[0];
    const fitid        = leafVal(content, 'FITID') || `auto-${i}`;
    const dtPosted     = leafVal(content, 'DTPOSTED');
    const date         = dtPosted ? parseDate(dtPosted) : null;
    const amtStr       = leafVal(content, 'TRNAMT') || '0';
    const amountMilliunits = Math.round(parseFloat(amtStr) * 1000);
    const name         = leafVal(content, 'NAME')    || '';
    const memo         = leafVal(content, 'MEMO')    || '';
    const type         = leafVal(content, 'TRNTYPE') || '';
    return { fitid, date, amountMilliunits, name, memo, type };
  }).filter(t => t.date);

  if (transactions.length === 0) {
    throw new Error('OFX parse error: no transactions found. Make sure this is a valid OFX/QFX file.');
  }

  // ── Derive starting balance ────────────────────────────────────────────────
  // Starting balance = ending balance minus the sum of all statement transactions.
  const txnSum = transactions.reduce((s, t) => s + t.amountMilliunits, 0);
  const startingBalanceMilliunits = endingBalanceMilliunits - txnSum;

  return {
    startingBalanceMilliunits,
    endingBalanceMilliunits,
    endingBalanceDate,
    statementStart,
    statementEnd,
    transactions,
  };
}
