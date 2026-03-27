import { useState, useCallback } from 'react';
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
function BalanceTile({ label, amount, highlight, warn }) {
  const cls = ['balance-tile', highlight ? 'highlight' : '', warn ? 'warn' : ''].filter(Boolean).join(' ');
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
  const arrow = active ? (config.dir === 'asc' ? ' ↑' : ' ↓') : '';
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
function ConfidenceBadge({ score }) {
  if (score >= 0.8) return <span className="badge badge-high">High</span>;
  if (score >= 0.5) return <span className="badge badge-med">Medium</span>;
  return <span className="badge badge-low">Low</span>;
}

// ─── Import Modal ─────────────────────────────────────────────────────────────
function ImportModal({ onClose, onRun }) {
  const [pendingFile, setPendingFile] = useState(null); // { name, parsed }
  const [parseError, setParseError]   = useState('');

  async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setParseError('');
    setPendingFile(null);
    try {
      const text = await file.text();
      const parsed = parseOFX(text);
      setPendingFile({ name: file.name, parsed });
    } catch (err) {
      setParseError(err.message);
    }
  }

  function handleRun() {
    if (!pendingFile) return;
    onRun(pendingFile.parsed);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Import Bank Statement</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* File selection — input is a child of the label so clicking the label
              natively opens the file dialog; no onClick needed on the label itself. */}
          <label className="file-dropzone">
            <input
              type="file"
              accept=".ofx,.qfx"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
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
          <button className="btn-primary" onClick={handleRun} disabled={!pendingFile}>
            Run Reconciliation
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reconciliation Panel ─────────────────────────────────────────────────────
function ReconcilePanel({ reconciliation, ofxData, onClear, clearing, clearError, clearedIds }) {
  const { matched, unmatchedOfx, unmatchedYnab, startingBalanceCheck, endingCheck } = reconciliation;
  const alreadyCleared = clearedIds.size > 0;
  const hasIssues = !startingBalanceCheck.matches || unmatchedOfx.length > 0;

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

      {/* ── Step 1: Starting Balance ── */}
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
              Difference of {formatCurrency(Math.abs(startingBalanceCheck.diff))} — your YNAB cleared
              balance does not match the statement beginning balance you entered. Check that the
              correct account is selected and that all prior transactions are cleared in YNAB.
            </div>
          )}
        </div>
      </div>

      {/* ── Step 2: Transaction Matching ── */}
      <div className="recon-step">
        <div className="step-label">
          <span className={`step-icon ${unmatchedOfx.length === 0 ? 'ok' : 'fail'}`}>
            {unmatchedOfx.length === 0 ? '✓' : '✗'}
          </span>
          Step 2 — Transaction Matching
          <span className="step-count">
            {matched.length} of {ofxData.transactions.length} matched
          </span>
        </div>

        <div className="table-wrap">
          <table className="txn-table match-table">
            <thead>
              <tr>
                <th className="col-source">Source</th>
                <th>Date</th>
                <th>Payee</th>
                <th className="right">Amount</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {/* Matched pairs: two rows each — File row then YNAB row */}
              {matched.map(({ ofx, ynab, payeeScore, daysDiff }, i) => {
                const cleared = clearedIds.has(ynab.id);
                const amtCls  = ofx.amountMilliunits < 0 ? 'neg' : 'pos';
                const pairCls = `pair-${i % 2 === 0 ? 'even' : 'odd'}${cleared ? ' pair-cleared' : ''}`;
                return (
                  <>
                    <tr key={`${ofx.fitid}-file`} className={`row-pair row-file ${pairCls}`}>
                      <td className="col-source">
                        <span className="source-badge source-file">File</span>
                      </td>
                      <td className="col-date">{ofx.date}</td>
                      <td className="col-payee">{ofx.name || <span className="dim">—</span>}</td>
                      <td className={`col-amount ${amtCls}`}>{formatCurrency(ofx.amountMilliunits)}</td>
                      <td></td>
                    </tr>
                    <tr key={`${ofx.fitid}-ynab`} className={`row-pair row-ynab ${pairCls}`}>
                      <td className="col-source">
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
                      <td><ConfidenceBadge score={payeeScore} /></td>
                    </tr>
                  </>
                );
              })}

              {/* Unmatched statement transactions — single row, flagged */}
              {unmatchedOfx.map(ofx => {
                const amtCls = ofx.amountMilliunits < 0 ? 'neg' : 'pos';
                return (
                  <tr key={ofx.fitid} className="row-pair row-unmatched">
                    <td className="col-source">
                      <span className="source-badge source-file">File</span>
                    </td>
                    <td className="col-date">{ofx.date}</td>
                    <td className="col-payee">{ofx.name || <span className="dim">—</span>}</td>
                    <td className={`col-amount ${amtCls}`}>{formatCurrency(ofx.amountMilliunits)}</td>
                    <td className="col-flag">✗ Not in YNAB</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* YNAB transactions not on the statement */}
        {unmatchedYnab.length > 0 && (
          <div className="unmatched-ynab">
            <div className="unmatched-label">
              <span className="step-icon warn">!</span>
              {unmatchedYnab.length} YNAB uncleared transaction{unmatchedYnab.length > 1 ? 's' : ''} not on statement
            </div>
            <table className="txn-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Memo</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {unmatchedYnab.map(t => (
                  <tr key={t.id} className={t.amount < 0 ? 'row-debit' : 'row-credit'}>
                    <td className="col-date">{t.date}</td>
                    <td className="col-payee">{t.payee_name || <span className="dim">—</span>}</td>
                    <td className="col-memo">{t.memo || <span className="dim">—</span>}</td>
                    <td className={`col-amount ${t.amount < 0 ? 'neg' : 'pos'}`}>
                      {formatCurrency(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="unmatched-note">
              These are uncleared in YNAB but do not appear on the statement. They may be
              pending, post-dated, or need investigation.
            </p>
          </div>
        )}
      </div>

      {/* ── Step 3: Balance Verification ── */}
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
                {alreadyCleared ? 'YNAB Cleared Balance (refreshed)' : 'Projected after clearing matched'}
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
              Difference of {formatCurrency(Math.abs(endingCheck.diff))} — after clearing all
              matched transactions the balances do not reconcile. Check for missing or
              incorrect-amount transactions.
            </div>
          )}
          {!endingCheck.matches && hasIssues && (
            <div className="step-note">
              Resolve the issues in Steps 1 and 2 before this balance can be verified.
            </div>
          )}
          {endingCheck.matches && alreadyCleared && (
            <div className="step-success">
              Reconciliation complete — YNAB cleared balance matches the statement ending balance.
            </div>
          )}
        </div>
      </div>

      {/* ── Action ── */}
      {!alreadyCleared && matched.length > 0 && (
        <div className="recon-action">
          {clearError && <div className="error-banner" style={{ marginBottom: '0.75rem' }}>{clearError}</div>}
          <button className="btn-primary" onClick={onClear} disabled={clearing}>
            {clearing
              ? 'Clearing…'
              : `Clear ${matched.length} Matched Transaction${matched.length > 1 ? 's' : ''} in YNAB`}
          </button>
          <p className="recon-action-note">
            Marks each matched YNAB transaction as "cleared" via the API.
            Unmatched transactions are not touched.
          </p>
        </div>
      )}

      {alreadyCleared && (
        <div className="recon-action">
          <div className="step-success" style={{ marginBottom: 0 }}>
            {clearedIds.size} transaction{clearedIds.size > 1 ? 's' : ''} marked as cleared in YNAB.
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
  const [sinceDate, setSinceDate]             = useState(
    () => format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd')
  );
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [fetched, setFetched]           = useState(false);
  const [sortConfig, setSortConfig]     = useState({ key: 'date', dir: 'desc' });

  // Phase 2 state
  const [showImportModal, setShowImportModal] = useState(false);
  const [ofxData, setOfxData]                 = useState(null);
  const [reconciliation, setReconciliation]   = useState(null);
  const [clearing, setClearing]               = useState(false);
  const [clearError, setClearError]           = useState('');
  const [clearedIds, setClearedIds]           = useState(new Set());

  const loadAccounts = useCallback(async (budget) => {
    setLoading(true);
    setError('');
    setFetched(false);
    try {
      const accts = await getAccounts(token, budget.id);
      setAccounts(accts);
      setSelectedAccount(null);
      setAccountDetails(null);
      setTransactions([]);
      setAccountsLoaded(true);
      resetPhase2();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  function resetPhase2() {
    setOfxData(null);
    setReconciliation(null);
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
        getUnclearedTransactions(token, selectedBudget.id, selectedAccount.id, sinceDate),
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
    setSelectedBudget(budget);
    setAccountsLoaded(false);
    setAccounts([]);
    setSelectedAccount(null);
    setAccountDetails(null);
    setTransactions([]);
    setFetched(false);
    resetPhase2();
  }

  function handleSort(key) {
    setSortConfig(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  }

  // Called by ImportModal when the user clicks "Run Reconciliation".
  function handleRunReconciliation(parsed) {
    setOfxData(parsed);

    const result = matchTransactions(transactions, parsed.transactions);

    const ynabCleared     = accountDetails.cleared_balance;
    const begBalMilliunits = parsed.startingBalanceMilliunits;
    const startingBalanceCheck = {
      statementStarting: begBalMilliunits,
      ynabCleared,
      matches: begBalMilliunits === ynabCleared,
      diff:    begBalMilliunits - ynabCleared,
    };

    const matchedSum       = result.matched.reduce((s, m) => s + m.ynab.amount, 0);
    const projectedCleared = ynabCleared + matchedSum;
    const endingCheck = {
      statementEnding: parsed.endingBalanceMilliunits,
      projected:       projectedCleared,
      matches:         projectedCleared === parsed.endingBalanceMilliunits,
      diff:            projectedCleared  - parsed.endingBalanceMilliunits,
    };

    setReconciliation({ ...result, startingBalanceCheck, endingCheck });
    setClearedIds(new Set());
    setShowImportModal(false);
  }

  async function handleClearMatched() {
    if (!reconciliation || reconciliation.matched.length === 0) return;
    const ids = reconciliation.matched.map(m => m.ynab.id);
    setClearing(true);
    setClearError('');
    try {
      await clearTransactions(token, selectedBudget.id, ids);
      const idSet = new Set(ids);
      setTransactions(prev => prev.filter(t => !idSet.has(t.id)));
      const details = await getAccountDetails(token, selectedBudget.id, selectedAccount.id);
      setAccountDetails(details);
      setClearedIds(idSet);
      setReconciliation(prev => ({
        ...prev,
        endingCheck: {
          ...prev.endingCheck,
          projected: details.cleared_balance,
          matches:   details.cleared_balance === prev.endingCheck.statementEnding,
          diff:      details.cleared_balance  - prev.endingCheck.statementEnding,
        },
      }));
    } catch (err) {
      setClearError(err.message);
    } finally {
      setClearing(false);
    }
  }

  const sorted = [...transactions].sort((a, b) => {
    const { key, dir } = sortConfig;
    const av = a[key] ?? '';
    const bv = b[key] ?? '';
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });

  const totalUncleared = transactions.reduce((sum, t) => sum + t.amount, 0);
  const canImport = fetched && accountDetails !== null;

  return (
    <div className="screen dashboard">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="logo-mark-sm">Y</span>
          YNAB Reconciler
        </div>
        <div className="topbar-actions">
          {canImport && (
            ofxData ? (
              <button
                className="btn-topbar-loaded"
                onClick={() => setShowImportModal(true)}
                title="Statement loaded — click to change"
              >
                ✓ Statement loaded
                <span className="btn-topbar-change">Change</span>
              </button>
            ) : (
              <button
                className="btn-secondary"
                onClick={() => setShowImportModal(true)}
              >
                Import Statement
              </button>
            )
          )}
          <button className="btn-ghost" onClick={onReset}>← Change Token</button>
        </div>
      </header>

      <div className="controls-bar">
        <div className="control-group">
          <label>Budget</label>
          <select value={selectedBudget?.id || ''} onChange={handleBudgetChange}>
            {budgets.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {!accountsLoaded && (
            <button
              className="btn-secondary"
              onClick={() => loadAccounts(selectedBudget)}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Load Accounts'}
            </button>
          )}
        </div>

        {accountsLoaded && (
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
            >
              <option value="">— Select account —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}

        {accountsLoaded && (
          <div className="control-group">
            <label>Transactions since</label>
            <input
              type="date"
              value={sinceDate}
              onChange={e => setSinceDate(e.target.value)}
            />
          </div>
        )}

        {selectedAccount && (
          <button className="btn-primary" onClick={loadTransactions} disabled={loading}>
            {loading ? 'Fetching…' : 'Fetch Uncleared'}
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {accountDetails && (
        <div className="balance-strip">
          <BalanceTile label="Cleared Balance"   amount={accountDetails.cleared_balance}   highlight />
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
            <BalanceTile
              label="Uncleared Sum"
              amount={totalUncleared}
              warn={totalUncleared !== 0}
            />
          )}
        </div>
      )}

      {/* ── YNAB Uncleared Transactions Table ─────────────────────────────── */}
      {sorted.length > 0 && !reconciliation && (
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
                  <td className={`col-amount ${t.amount < 0 ? 'neg' : 'pos'}`}>
                    {formatCurrency(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fetched && transactions.length === 0 && !reconciliation && !ofxData && (
        <div className="empty-state">
          <span className="check-icon">✓</span>
          <p>No uncleared transactions since <strong>{sinceDate}</strong>.</p>
          <p className="dim">All transactions in this window are cleared or reconciled.</p>
        </div>
      )}

      {/* ── Phase 2: Reconciliation Panel ─────────────────────────────────── */}
      {reconciliation && ofxData && (
        <ReconcilePanel
          reconciliation={reconciliation}
          ofxData={ofxData}
          onClear={handleClearMatched}
          clearing={clearing}
          clearError={clearError}
          clearedIds={clearedIds}
        />
      )}

      {/* ── Import Modal ───────────────────────────────────────────────────── */}
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
