import { useState, useCallback, useEffect } from 'react';
import {
  getBudgets, getAccounts, getUnclearedTransactions, getAccountDetails,
  clearTransactions, formatCurrency,
} from './ynab';
import { parseOFX } from './ofx';
import { matchTransactions } from './matcher';
import { format, subMonths, startOfMonth } from 'date-fns';
import './App.css';

// ─── Token Setup Screen ───────────────────────────────────────────────────────
function TokenScreen({ onSave }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    try {
      const budgets = await getBudgets(token.trim());
      if (budgets.length === 0) throw new Error('No budgets found on this account.');
      onSave(token.trim(), budgets);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen token-screen">
      <div className="token-card">
        <div className="logo-mark">Y</div>
        <h1>YNAB Reconciler</h1>
        <p className="subtitle">
          Enter your YNAB Personal Access Token to get started. Generate one at{' '}
          <a href="https://app.ynab.com/settings/developer" target="_blank" rel="noreferrer">
            Account Settings → Developer Settings
          </a>.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="token">Personal Access Token</label>
            <input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your token here…"
              autoComplete="off"
              spellCheck="false"
            />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading || !token.trim()}>
            {loading ? 'Connecting…' : 'Connect to YNAB'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Balance Tile ─────────────────────────────────────────────────────────────
function BalanceTile({ label, amount, highlight, warn, dim }) {
  const cls = [
    'balance-tile',
    highlight ? 'highlight' : '',
    warn      ? 'warn'      : '',
    dim       ? 'dim-tile'  : '',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <span className="btile-label">{label}</span>
      <span className="btile-amount">{formatCurrency(amount)}</span>
    </div>
  );
}

// ─── Sort Header ──────────────────────────────────────────────────────────────
function SortTh({ label, colKey, config, onSort, right }) {
  const active = config.key === colKey;
  const arrow  = active ? (config.dir === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <th
      className={['sortable', right ? 'right' : '', active ? 'active' : ''].filter(Boolean).join(' ')}
      onClick={() => onSort(colKey)}
    >
      {label}{arrow}
    </th>
  );
}

// ─── Confidence Badge ─────────────────────────────────────────────────────────
function ConfidenceBadge({ score, manual }) {
  if (manual) return <span className="badge badge-manual">Manual</span>;
  if (score >= 0.8) return <span className="badge badge-high">High</span>;
  if (score >= 0.5) return <span className="badge badge-med">Medium</span>;
  return <span className="badge badge-low">Low</span>;
}

// ─── Import Modal ─────────────────────────────────────────────────────────────
function ImportModal({ onClose, onRun }) {
  const [pendingFile, setPendingFile] = useState(null);
  const [parseError, setParseError]   = useState('');

  async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setParseError('');
    setPendingFile(null);
    try {
      const text   = await file.text();
      const parsed = parseOFX(text);
      setPendingFile({ name: file.name, parsed });
    } catch (err) {
      setParseError(err.message);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Import Bank Statement</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <label className="file-dropzone">
            <input type="file" accept=".ofx,.qfx" onChange={handleFileSelect} style={{ display: 'none' }} />
            {pendingFile ? (
              <>
                <span className="dropzone-icon file-ok">✓</span>
                <span className="dropzone-text">{pendingFile.name}</span>
                <span className="dropzone-sub">
                  {pendingFile.parsed.transactions.length} transactions ·{' '}
                  Beginning: {formatCurrency(pendingFile.parsed.startingBalanceMilliunits)} ·{' '}
                  Ending: {formatCurrency(pendingFile.parsed.endingBalanceMilliunits)}
                  {pendingFile.parsed.endingBalanceDate && ` (as of ${pendingFile.parsed.endingBalanceDate})`}
                </span>
                <span className="dropzone-sub" style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>
                  Beginning = Ending − sum of statement transactions
                </span>
                <span className="dropzone-change">Click to change file</span>
              </>
            ) : (
              <>
                <span className="dropzone-icon">↑</span>
                <span className="dropzone-text">Click to choose OFX / QFX file</span>
                <span className="dropzone-sub">TD Bank, Capital One, and most banks support this format</span>
              </>
            )}
          </label>
          {parseError && <div className="error-msg" style={{ marginTop: '0.75rem' }}>{parseError}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => pendingFile && onRun(pendingFile.parsed)} disabled={!pendingFile}>
            Run Reconciliation
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reconciliation Panel ─────────────────────────────────────────────────────
function ReconcilePanel({
  matches, unmatchedOfx, unmatchedYnab,
  ofxData, startingBalanceCheck, endingCheck,
  onManualMatch, onUnmatch,
  onClear, clearing, clearError, clearedIds,
}) {
  const [selOfxId, setSelOfxId]   = useState(null);
  const [selYnabId, setSelYnabId] = useState(null);

  const alreadyCleared = clearedIds.size > 0;
  const hasIssues      = !startingBalanceCheck.matches || unmatchedOfx.length > 0;
  const canMatch       = selOfxId !== null && selYnabId !== null;

  function handleMatchSelected() {
    onManualMatch(selOfxId, selYnabId);
    setSelOfxId(null);
    setSelYnabId(null);
  }

  // Interleave unmatched OFX and YNAB rows sorted by date for easy visual pairing.
  const unmatchedRows = [
    ...unmatchedOfx.map(t => ({ src: 'file', id: t.fitid, date: t.date, payee: t.name,       amount: t.amountMilliunits })),
    ...unmatchedYnab.map(t => ({ src: 'ynab', id: t.id,    date: t.date, payee: t.payee_name, amount: t.amount })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return (
    <div className="recon-panel">
      <div className="recon-header">
        <h2 className="recon-title">Reconciliation</h2>
        <div className="recon-meta">
          {ofxData.statementStart && ofxData.statementEnd
            ? `Statement period: ${ofxData.statementStart} → ${ofxData.statementEnd}`
            : ofxData.endingBalanceDate
              ? `Statement as of ${ofxData.endingBalanceDate}`
              : ''}
        </div>
      </div>

      {/* ── Step 1: Starting Balance ──────────────────────────────────────── */}
      <div className="recon-step">
        <div className="step-label">
          <span className={`step-icon ${startingBalanceCheck.matches ? 'ok' : 'fail'}`}>
            {startingBalanceCheck.matches ? '✓' : '✗'}
          </span>
          Step 1 — Starting Balance
        </div>
        <div className="step-body">
          <div className="balance-compare">
            <div className="bc-item">
              <span className="bc-label">YNAB Cleared Balance</span>
              <span className="bc-value mono">{formatCurrency(startingBalanceCheck.ynabCleared)}</span>
            </div>
            <div className="bc-sep">=</div>
            <div className="bc-item">
              <span className="bc-label">Statement Beginning Balance</span>
              <span className="bc-value mono">{formatCurrency(startingBalanceCheck.statementStarting)}</span>
            </div>
          </div>
          {!startingBalanceCheck.matches && (
            <div className="step-flag">
              Difference of {formatCurrency(Math.abs(startingBalanceCheck.diff))} — YNAB cleared
              balance does not match the statement beginning balance. Check that the correct account
              and date range are selected, and that all prior transactions are cleared in YNAB.
            </div>
          )}
        </div>
      </div>

      {/* ── Step 2: Transaction Matching ──────────────────────────────────── */}
      <div className="recon-step">
        <div className="step-label">
          <span className={`step-icon ${unmatchedOfx.length === 0 ? 'ok' : 'fail'}`}>
            {unmatchedOfx.length === 0 ? '✓' : '✗'}
          </span>
          Step 2 — Transaction Matching
          <span className="step-count">
            {matches.length} matched · {unmatchedOfx.length} file unmatched · {unmatchedYnab.length} YNAB unmatched
          </span>
        </div>

        {/* Matched pairs */}
        {matches.length > 0 && (
          <div className="table-wrap">
            <table className="txn-table match-table">
              <thead>
                <tr>
                  <th className="col-source">Source</th>
                  <th>Date</th>
                  <th>Payee</th>
                  <th className="right">Amount</th>
                  <th>Match</th>
                  <th className="col-action"></th>
                </tr>
              </thead>
              <tbody>
                {matches.map(({ ofx, ynab, payeeScore, daysDiff, manual }, i) => {
                  const cleared = clearedIds.has(ynab.id);
                  const amtCls  = ofx.amountMilliunits < 0 ? 'neg' : 'pos';
                  const pairCls = `pair-${i % 2 === 0 ? 'even' : 'odd'}${cleared ? ' pair-cleared' : ''}`;
                  return (
                    <>
                      <tr key={`${ofx.fitid}-file`} className={`row-pair row-file ${pairCls}`}>
                        <td><span className="source-badge source-file">File</span></td>
                        <td className="col-date">{ofx.date}</td>
                        <td className="col-payee">{ofx.name || <span className="dim">—</span>}</td>
                        <td className={`col-amount ${amtCls}`}>{formatCurrency(ofx.amountMilliunits)}</td>
                        <td></td>
                        <td></td>
                      </tr>
                      <tr key={`${ofx.fitid}-ynab`} className={`row-pair row-ynab ${pairCls}`}>
                        <td>
                          <span className="source-badge source-ynab">
                            {cleared ? '★ YNAB' : '✓ YNAB'}
                          </span>
                        </td>
                        <td className="col-date">
                          {ynab.date}
                          {daysDiff > 0 && <span className="day-drift"> ({daysDiff}d)</span>}
                        </td>
                        <td className="col-payee">{ynab.payee_name || <span className="dim">—</span>}</td>
                        <td className={`col-amount ${amtCls}`}>{formatCurrency(ynab.amount)}</td>
                        <td><ConfidenceBadge score={payeeScore} manual={manual} /></td>
                        <td className="col-action">
                          {!cleared && (
                            <button className="btn-unmatch" onClick={() => onUnmatch(ofx.fitid)}>
                              Unmatch
                            </button>
                          )}
                        </td>
                      </tr>
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Unmatched transactions — interleaved, selectable for manual match */}
        {unmatchedRows.length > 0 && (
          <div className="unmatched-section">
            <div className="unmatched-section-hdr">
              <span>Unmatched</span>
              <span className="step-count">
                {unmatchedOfx.length} file · {unmatchedYnab.length} YNAB
              </span>
            </div>

            {canMatch && (
              <div className="match-action-bar">
                <span className="match-action-hint">1 file + 1 YNAB transaction selected</span>
                <div className="match-action-btns">
                  <button className="btn-ghost btn-sm" onClick={() => { setSelOfxId(null); setSelYnabId(null); }}>
                    Clear
                  </button>
                  <button className="btn-primary btn-sm" onClick={handleMatchSelected}>
                    Match Selected
                  </button>
                </div>
              </div>
            )}

            <div className="table-wrap">
              <table className="txn-table match-table">
                <thead>
                  <tr>
                    <th className="col-source">Source</th>
                    <th>Date</th>
                    <th>Payee</th>
                    <th className="right">Amount</th>
                    <th className="col-sel"></th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedRows.map(row => {
                    const isFile     = row.src === 'file';
                    const isSelected = isFile ? selOfxId === row.id : selYnabId === row.id;
                    const amtCls     = row.amount < 0 ? 'neg' : 'pos';
                    return (
                      <tr
                        key={`${row.src}-${row.id}`}
                        className={`row-pair row-unmatched${isSelected ? ' row-selected' : ''}`}
                        onClick={() => {
                          if (isFile) setSelOfxId(p => p === row.id ? null : row.id);
                          else        setSelYnabId(p => p === row.id ? null : row.id);
                        }}
                      >
                        <td>
                          <span className={`source-badge ${isFile ? 'source-file' : 'source-ynab'}`}>
                            {isFile ? 'File' : 'YNAB'}
                          </span>
                        </td>
                        <td className="col-date">{row.date}</td>
                        <td className="col-payee">{row.payee || <span className="dim">—</span>}</td>
                        <td className={`col-amount ${amtCls}`}>{formatCurrency(row.amount)}</td>
                        <td className="col-sel">
                          <span className={`sel-dot ${isSelected ? 'sel-on' : ''}`}>{isSelected ? '●' : '○'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!canMatch && (unmatchedOfx.length > 0 || unmatchedYnab.length > 0) && (
              <p className="unmatched-hint">
                Click a File row and a YNAB row to select them, then use "Match Selected" to manually link them.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Step 3: Balance Verification ─────────────────────────────────── */}
      <div className="recon-step">
        <div className="step-label">
          <span className={`step-icon ${endingCheck.matches ? 'ok' : (hasIssues ? 'warn' : 'fail')}`}>
            {endingCheck.matches ? '✓' : (hasIssues ? '?' : '✗')}
          </span>
          Step 3 — Final Balance Verification
        </div>
        <div className="step-body">
          <div className="balance-compare">
            <div className="bc-item">
              <span className="bc-label">
                {endingCheck.alreadyCleared ? 'YNAB Cleared (refreshed)' : 'Projected after clearing matched'}
              </span>
              <span className="bc-value mono">{formatCurrency(endingCheck.projected)}</span>
            </div>
            <div className="bc-sep">=</div>
            <div className="bc-item">
              <span className="bc-label">Statement Ending Balance</span>
              <span className="bc-value mono">{formatCurrency(endingCheck.statementEnding)}</span>
            </div>
          </div>
          {!endingCheck.matches && !hasIssues && (
            <div className="step-flag">
              Difference of {formatCurrency(Math.abs(endingCheck.diff))} — balances do not reconcile after
              clearing all matched transactions. Check for missing or incorrect-amount transactions.
            </div>
          )}
          {!endingCheck.matches && hasIssues && (
            <div className="step-note">
              Resolve the issues in Steps 1 and 2 before this balance can be verified.
            </div>
          )}
          {endingCheck.matches && endingCheck.alreadyCleared && (
            <div className="step-success">
              Reconciliation complete — YNAB cleared balance matches the statement ending balance.
            </div>
          )}
        </div>
      </div>

      {/* ── Action ───────────────────────────────────────────────────────── */}
      {!alreadyCleared && matches.length > 0 && (
        <div className="recon-action">
          {clearError && <div className="error-banner" style={{ marginBottom: '0.75rem' }}>{clearError}</div>}
          <button className="btn-primary" onClick={onClear} disabled={clearing}>
            {clearing
              ? 'Clearing…'
              : `Clear ${matches.length} Matched Transaction${matches.length !== 1 ? 's' : ''} in YNAB`}
          </button>
          <p className="recon-action-note">
            Marks each matched YNAB transaction as "cleared" via the API. Unmatched transactions are not touched.
          </p>
        </div>
      )}
      {alreadyCleared && (
        <div className="recon-action">
          <div className="step-success" style={{ marginBottom: 0 }}>
            {clearedIds.size} transaction{clearedIds.size !== 1 ? 's' : ''} marked as cleared in YNAB.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
function Dashboard({ token, budgets, onReset }) {
  const [selectedBudget, setSelectedBudget]   = useState(budgets[0] || null);
  const [accounts, setAccounts]               = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [accountDetails, setAccountDetails]   = useState(null);
  const [transactions, setTransactions]       = useState([]);
  const [fromDate, setFromDate]               = useState(
    () => format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd')
  );
  const [toDate, setToDate]                   = useState(
    () => format(new Date(), 'yyyy-MM-dd')
  );
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [fetched, setFetched]   = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'date', dir: 'desc' });

  // ── Reconciliation state (mutable so matches can be added/removed) ─────────
  const [showImportModal, setShowImportModal] = useState(false);
  const [ofxData, setOfxData]                 = useState(null);
  const [matches, setMatches]                 = useState([]);
  const [unmatchedOfx, setUnmatchedOfx]       = useState([]);
  const [unmatchedYnab, setUnmatchedYnab]     = useState([]);
  const [reconStartingCheck, setReconStartingCheck] = useState(null); // null = not active
  const [clearing, setClearing]               = useState(false);
  const [clearError, setClearError]           = useState('');
  const [clearedIds, setClearedIds]           = useState(new Set());

  const reconActive = reconStartingCheck !== null;

  // ── Derived: dynamic ending balance check (updates as matches change) ──────
  const endingCheck = reconActive && accountDetails && ofxData
    ? (() => {
        const alreadyCleared = clearedIds.size > 0;
        // After clearing: accountDetails is refreshed, use it directly.
        // Before clearing: project what cleared balance will be.
        const projected = alreadyCleared
          ? accountDetails.cleared_balance
          : accountDetails.cleared_balance + matches.reduce((s, m) => s + m.ynab.amount, 0);
        const statementEnding = ofxData.endingBalanceMilliunits;
        return {
          statementEnding,
          projected,
          matches:       projected === statementEnding,
          diff:          projected - statementEnding,
          alreadyCleared,
        };
      })()
    : null;

  // ── Derived: unmatched balance totals for the strip ───────────────────────
  const unmatchedCredits = reconActive
    ? unmatchedOfx.filter(t => t.amountMilliunits > 0).reduce((s, t) => s + t.amountMilliunits, 0)
    : 0;
  const unmatchedDebits = reconActive
    ? unmatchedOfx.filter(t => t.amountMilliunits < 0).reduce((s, t) => s + t.amountMilliunits, 0)
    : 0;

  // ── Auto-load accounts whenever the selected budget changes ───────────────
  const loadAccounts = useCallback(async (budget) => {
    if (!budget) return;
    setLoading(true);
    setError('');
    setFetched(false);
    try {
      const accts = await getAccounts(token, budget.id);
      setAccounts(accts);
      setSelectedAccount(null);
      setAccountDetails(null);
      setTransactions([]);
      resetPhase2();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadAccounts(selectedBudget);
  }, [selectedBudget?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetPhase2() {
    setOfxData(null);
    setMatches([]);
    setUnmatchedOfx([]);
    setUnmatchedYnab([]);
    setReconStartingCheck(null);
    setClearError('');
    setClearedIds(new Set());
  }

  async function loadTransactions() {
    if (!selectedAccount) return;
    setLoading(true);
    setError('');
    setFetched(false);
    resetPhase2();
    try {
      const [txns, details] = await Promise.all([
        getUnclearedTransactions(token, selectedBudget.id, selectedAccount.id, fromDate, toDate),
        getAccountDetails(token, selectedBudget.id, selectedAccount.id),
      ]);
      setTransactions(txns);
      setAccountDetails(details);
      setFetched(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleBudgetChange(e) {
    const budget = budgets.find(b => b.id === e.target.value);
    setAccounts([]);
    setSelectedAccount(null);
    setAccountDetails(null);
    setTransactions([]);
    setFetched(false);
    resetPhase2();
    setSelectedBudget(budget); // triggers useEffect → loadAccounts
  }

  function handleSort(key) {
    setSortConfig(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  }

  // ── Reconciliation handlers ───────────────────────────────────────────────
  function handleRunReconciliation(parsed) {
    setOfxData(parsed);
    const result      = matchTransactions(transactions, parsed.transactions);
    setMatches(result.matched);
    setUnmatchedOfx(result.unmatchedOfx);
    setUnmatchedYnab(result.unmatchedYnab);
    const ynabCleared = accountDetails.cleared_balance;
    const begBal      = parsed.startingBalanceMilliunits;
    setReconStartingCheck({
      statementStarting: begBal,
      ynabCleared,
      matches: begBal === ynabCleared,
      diff:    begBal - ynabCleared,
    });
    setClearedIds(new Set());
    setShowImportModal(false);
  }

  function handleManualMatch(ofxFitid, ynabId) {
    const ofxTxn  = unmatchedOfx.find(t => t.fitid === ofxFitid);
    const ynabTxn = unmatchedYnab.find(t => t.id === ynabId);
    if (!ofxTxn || !ynabTxn) return;
    const dd = Math.round(
      Math.abs(new Date(ofxTxn.date + 'T00:00:00') - new Date(ynabTxn.date + 'T00:00:00')) / 86_400_000
    );
    setMatches(prev => [...prev, { ofx: ofxTxn, ynab: ynabTxn, payeeScore: null, daysDiff: dd, manual: true }]);
    setUnmatchedOfx(prev => prev.filter(t => t.fitid !== ofxFitid));
    setUnmatchedYnab(prev => prev.filter(t => t.id !== ynabId));
  }

  function handleUnmatch(ofxFitid) {
    const match = matches.find(m => m.ofx.fitid === ofxFitid);
    if (!match) return;
    setMatches(prev => prev.filter(m => m.ofx.fitid !== ofxFitid));
    setUnmatchedOfx(prev => [...prev, match.ofx].sort((a, b) => a.date < b.date ? -1 : 1));
    setUnmatchedYnab(prev => [...prev, match.ynab].sort((a, b) => a.date < b.date ? -1 : 1));
  }

  async function handleClearMatched() {
    if (matches.length === 0) return;
    const ids = matches.map(m => m.ynab.id);
    setClearing(true);
    setClearError('');
    try {
      await clearTransactions(token, selectedBudget.id, ids);
      const idSet = new Set(ids);
      setTransactions(prev => prev.filter(t => !idSet.has(t.id)));
      const details = await getAccountDetails(token, selectedBudget.id, selectedAccount.id);
      setAccountDetails(details); // endingCheck recomputes automatically
      setClearedIds(idSet);
    } catch (err) {
      setClearError(err.message);
    } finally {
      setClearing(false);
    }
  }

  // ── Derived display values ────────────────────────────────────────────────
  const sorted = [...transactions].sort((a, b) => {
    const { key, dir } = sortConfig;
    const av = a[key] ?? '';
    const bv = b[key] ?? '';
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });

  const totalUncleared = transactions.reduce((sum, t) => sum + t.amount, 0);
  const canImport      = fetched && accountDetails !== null;

  return (
    <div className="screen dashboard">
      {/* ── Topbar ─────────────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="topbar-brand">
          <span className="logo-mark-sm">Y</span>
          YNAB Reconciler
        </div>
        <div className="topbar-actions">
          {canImport && (
            ofxData ? (
              <button className="btn-topbar-loaded" onClick={() => setShowImportModal(true)}>
                ✓ Statement loaded
                <span className="btn-topbar-change">Change</span>
              </button>
            ) : (
              <button className="btn-secondary" onClick={() => setShowImportModal(true)}>
                Import Statement
              </button>
            )
          )}
          <button className="btn-ghost" onClick={onReset}>← Change Token</button>
        </div>
      </header>

      {/* ── Controls Bar ───────────────────────────────────────────────── */}
      <div className="controls-bar">
        <div className="control-group">
          <label>Account</label>
          <select
            value={selectedAccount?.id || ''}
            onChange={e => {
              setSelectedAccount(accounts.find(a => a.id === e.target.value) || null);
              setAccountDetails(null);
              setTransactions([]);
              setFetched(false);
              resetPhase2();
            }}
            disabled={accounts.length === 0}
          >
            <option value="">{loading ? 'Loading accounts…' : '— Select account —'}</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div className="control-group">
          <label>From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>

        <div className="control-group">
          <label>To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>

        {selectedAccount && (
          <button className="btn-primary" onClick={loadTransactions} disabled={loading}>
            {loading ? 'Fetching…' : 'Fetch Uncleared'}
          </button>
        )}

        {budgets.length > 1 && (
          <div className="control-group budget-group">
            <label>Budget</label>
            <select value={selectedBudget?.id || ''} onChange={handleBudgetChange}>
              {budgets.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* ── Balance Strip ──────────────────────────────────────────────── */}
      {accountDetails && (
        <div className="balance-strip">
          {reconActive ? (
            // Reconciliation mode — show file + YNAB balances and unmatched totals
            <>
              <BalanceTile label="YNAB Cleared"    amount={accountDetails.cleared_balance} highlight />
              <BalanceTile label="YNAB Working"    amount={accountDetails.balance} />
              <div className="strip-divider" />
              <BalanceTile label="Stmt Beginning"  amount={ofxData.startingBalanceMilliunits} dim />
              <BalanceTile label="Stmt Ending"     amount={ofxData.endingBalanceMilliunits}   dim />
              <div className="strip-divider" />
              <div className="balance-tile count-tile">
                <span className="btile-label">Unmatched</span>
                <span className="btile-count">{unmatchedOfx.length + unmatchedYnab.length}</span>
              </div>
              {unmatchedCredits !== 0 && (
                <BalanceTile label="Unmatched Credits" amount={unmatchedCredits} />
              )}
              {unmatchedDebits !== 0 && (
                <BalanceTile label="Unmatched Debits" amount={unmatchedDebits} warn />
              )}
            </>
          ) : (
            // Normal mode
            <>
              <BalanceTile label="Cleared Balance"   amount={accountDetails.cleared_balance} highlight />
              <BalanceTile
                label="Uncleared Balance"
                amount={accountDetails.uncleared_balance}
                warn={accountDetails.uncleared_balance !== 0}
              />
              <BalanceTile label="Working Balance" amount={accountDetails.balance} />
              <div className="balance-tile count-tile">
                <span className="btile-label">Uncleared Txns</span>
                <span className="btile-count">{transactions.length}</span>
              </div>
              {transactions.length > 0 && (
                <BalanceTile label="Uncleared Sum" amount={totalUncleared} warn={totalUncleared !== 0} />
              )}
            </>
          )}
        </div>
      )}

      {/* ── YNAB transactions (hidden during reconciliation) ───────────── */}
      {sorted.length > 0 && !reconActive && (
        <div className="table-wrap">
          <table className="txn-table">
            <thead>
              <tr>
                <SortTh label="Date"   colKey="date"       config={sortConfig} onSort={handleSort} />
                <SortTh label="Payee"  colKey="payee_name" config={sortConfig} onSort={handleSort} />
                <th>Memo</th>
                <SortTh label="Amount" colKey="amount"     config={sortConfig} onSort={handleSort} right />
              </tr>
            </thead>
            <tbody>
              {sorted.map(t => (
                <tr key={t.id} className={t.amount < 0 ? 'row-debit' : 'row-credit'}>
                  <td className="col-date">{t.date}</td>
                  <td className="col-payee">{t.payee_name || <span className="dim">—</span>}</td>
                  <td className="col-memo">{t.memo || <span className="dim">—</span>}</td>
                  <td className={`col-amount ${t.amount < 0 ? 'neg' : 'pos'}`}>{formatCurrency(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fetched && transactions.length === 0 && !reconActive && (
        <div className="empty-state">
          <span className="check-icon">✓</span>
          <p>No uncleared transactions from <strong>{fromDate}</strong> to <strong>{toDate}</strong>.</p>
          <p className="dim">All transactions in this window are cleared or reconciled.</p>
        </div>
      )}

      {/* ── Reconciliation Panel ───────────────────────────────────────── */}
      {reconActive && ofxData && endingCheck && (
        <ReconcilePanel
          matches={matches}
          unmatchedOfx={unmatchedOfx}
          unmatchedYnab={unmatchedYnab}
          ofxData={ofxData}
          startingBalanceCheck={reconStartingCheck}
          endingCheck={endingCheck}
          onManualMatch={handleManualMatch}
          onUnmatch={handleUnmatch}
          onClear={handleClearMatched}
          clearing={clearing}
          clearError={clearError}
          clearedIds={clearedIds}
        />
      )}

      {/* ── Import Modal ───────────────────────────────────────────────── */}
      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onRun={handleRunReconciliation}
        />
      )}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken]     = useState(null);
  const [budgets, setBudgets] = useState([]);

  function handleSave(t, b) {
    setToken(t);
    setBudgets(b);
  }

  if (!token) return <TokenScreen onSave={handleSave} />;
  return <Dashboard token={token} budgets={budgets} onReset={() => setToken(null)} />;
}
