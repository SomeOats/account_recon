import { useState, useCallback, useEffect } from 'react';
import {
  getBudgets, getAccounts, getTransactionsSince, getAccountDetails,
  getCategories, clearTransactions, createTransactions, deleteTransaction, formatCurrency,
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
function ConfidenceBadge({ score, manual, pending, approved }) {
  if (pending)  return <span className="badge badge-pending">Pending</span>;
  if (approved) return <span className="badge badge-approved">Approved</span>;
  if (manual)   return <span className="badge badge-manual">Manual</span>;
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

// ─── Stage as New Modal ───────────────────────────────────────────────────────
function StageAsNewModal({ ofx, onBudget, categoryGroups, categoriesLoading, onStage, onClose }) {
  const [payee,      setPayee]      = useState(ofx.name || '');
  const [categoryId, setCategoryId] = useState('');
  const [memo,       setMemo]       = useState(ofx.memo || '');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Create Transaction in YNAB</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="stmt-ref">
            <span className="source-badge source-file">File</span>
            <span className="stmt-ref-date">{ofx.date}</span>
            <span className="stmt-ref-payee">{ofx.name}</span>
            <span className={`stmt-ref-amount ${ofx.amountMilliunits < 0 ? 'neg' : 'pos'}`}>
              {formatCurrency(ofx.amountMilliunits)}
            </span>
          </div>

          <div className="modal-field">
            <label>Payee</label>
            <input
              type="text"
              value={payee}
              onChange={e => setPayee(e.target.value)}
              autoFocus
            />
          </div>

          {onBudget && (
            <div className="modal-field">
              <label>Category</label>
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                <option value="">
                  {categoriesLoading ? 'Loading categories…' : '— Uncategorized —'}
                </option>
                {categoryGroups.map(g => (
                  <optgroup key={g.id} label={g.name}>
                    {g.categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          <div className="modal-field">
            <label>Memo</label>
            <input
              type="text"
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => onStage({ payee, categoryId: categoryId || null, memo })}
            disabled={!payee.trim()}
          >
            Stage Transaction
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Amount Override Modal ────────────────────────────────────────────────────
function AmountOverrideModal({ ynab, currentAmount, onApply, onClose }) {
  const [value, setValue] = useState((currentAmount / 1000).toFixed(2));
  const [err,   setErr]   = useState('');

  function handleApply() {
    const parsed = parseFloat(value.replace(/[^\-0-9.]/g, ''));
    if (isNaN(parsed)) { setErr('Enter a valid dollar amount, e.g. -42.50'); return; }
    onApply(Math.round(parsed * 1000));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Update Transaction Amount</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <p className="modal-ref-text">
            {ynab.payee_name || '—'} · {ynab.date}
          </p>
          <div className="modal-field">
            <label>New Amount</label>
            <input
              type="text"
              value={value}
              onChange={e => { setValue(e.target.value); setErr(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleApply(); if (e.key === 'Escape') onClose(); }}
              autoFocus
            />
            <p className="field-note">Current YNAB amount: {formatCurrency(ynab.amount)}</p>
            {err && <p className="field-note" style={{ color: 'var(--red)' }}>{err}</p>}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleApply}>Apply</button>
        </div>
      </div>
    </div>
  );
}

// ─── Reconciliation Panel ─────────────────────────────────────────────────────
function ReconcilePanel({
  matches, pendingMatches, unmatchedOfx, unmatchedYnab,
  zeroAmountOfx,
  ofxData, startingBalanceCheck, endingCheck,
  onBudget,
  stagedNew, stagedDeletes, amountOverrides, categoryGroups, categoriesLoading,
  rolledForward, onRollForward, onUndoRollForward,
  onManualMatch, onUnmatch,
  onApprovePending, onRejectPending,
  onPreStageModal, onConfirmStage, onUnstage,
  onStageDelete, onUnstageDelete,
  onOpenAmountOverride, onClearAmountOverride,
  onPush, pushing, pushError,
  onRefresh, clearedIds,
}) {
  const [selOfxId,  setSelOfxId]  = useState(null);
  const [selYnabId, setSelYnabId] = useState(null);
  const [stageTarget,         setStageTarget]         = useState(null); // ofx object
  const [amountOverrideTarget, setAmountOverrideTarget] = useState(null); // { ynab, currentAmount }

  const alreadyCleared = clearedIds.size > 0;
  const hasIssues      = !startingBalanceCheck.matches || unmatchedOfx.length > 0 || pendingMatches.length > 0;

  const selOfxTxn  = selOfxId  ? unmatchedOfx.find(t => t.fitid === selOfxId)  : null;
  const selYnabTxn = selYnabId ? unmatchedYnab.find(t => t.id === selYnabId)   : null;
  const ynabEffAmt = selYnabTxn ? (amountOverrides[selYnabTxn.id] ?? selYnabTxn.amount) : null;
  const bothSelected   = selOfxId !== null && selYnabId !== null;
  const canMatch       = bothSelected && selOfxTxn?.amountMilliunits === ynabEffAmt;
  const amountMismatch = bothSelected && selOfxTxn?.amountMilliunits !== ynabEffAmt;
  const allFileAccountedFor = unmatchedOfx.length === 0 && pendingMatches.length === 0;
  const allYnabAccountedFor = unmatchedYnab.length === 0;
  const allAccountedFor     = allFileAccountedFor && allYnabAccountedFor;
  const hasSomethingToPush  = matches.length > 0 || stagedNew.length > 0 || stagedDeletes.length > 0;
  const canPush = !alreadyCleared
    && startingBalanceCheck.matches
    && allAccountedFor
    && endingCheck.matches
    && hasSomethingToPush;

  function handleMatchSelected() {
    onManualMatch(selOfxId, selYnabId);
    setSelOfxId(null);
    setSelYnabId(null);
  }

  const unmatchedRows = [
    ...unmatchedOfx.map(t => ({ src: 'file', id: t.fitid, date: t.date, payee: t.name,       amount: t.amountMilliunits, raw: t })),
    ...unmatchedYnab.map(t => ({ src: 'ynab', id: t.id,    date: t.date, payee: t.payee_name, amount: t.amount,           raw: t })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const overrideCount = Object.keys(amountOverrides).length;

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

      {/* ── Step 1: Starting Balance ───────────────────────────────────────── */}
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
          <span className={`step-icon ${unmatchedOfx.length === 0 && pendingMatches.length === 0 ? 'ok' : unmatchedOfx.length === 0 && pendingMatches.length > 0 ? 'warn' : 'fail'}`}>
            {unmatchedOfx.length === 0 && pendingMatches.length === 0 ? '✓' : unmatchedOfx.length === 0 && pendingMatches.length > 0 ? '?' : '✗'}
          </span>
          Step 2 — Transaction Matching
          <span className="step-count">
            {matches.length} matched
            {pendingMatches.length > 0 && ` · ${pendingMatches.length} pending approval`}
            {stagedNew.length > 0 && ` · ${stagedNew.length} staged new`}
            {stagedDeletes.length > 0 && ` · ${stagedDeletes.length} staged delete`}
            {unmatchedOfx.length > 0 && ` · ${unmatchedOfx.length} file unmatched`}
            {unmatchedYnab.length > 0 && ` · ${unmatchedYnab.length} YNAB unmatched`}
            {rolledForward.length > 0 && ` · ${rolledForward.length} rolled forward`}
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
                {matches.map(({ ofx, ynab, payeeScore, daysDiff, manual, approved }, i) => {
                  const cleared    = clearedIds.has(ynab.id);
                  const overridden = amountOverrides[ynab.id] !== undefined;
                  const dispAmt    = overridden ? amountOverrides[ynab.id] : ynab.amount;
                  const fileAmtCls = ofx.amountMilliunits < 0 ? 'neg' : 'pos';
                  const ynabAmtCls = dispAmt < 0 ? 'neg' : 'pos';
                  const pairCls    = `pair-${i % 2 === 0 ? 'even' : 'odd'}${cleared ? ' pair-cleared' : ''}`;
                  return (
                    <>
                      <tr key={`${ofx.fitid}-file`} className={`row-pair row-file ${pairCls}`}>
                        <td><span className="source-badge source-file">File</span></td>
                        <td className="col-date">{ofx.date}</td>
                        <td className="col-payee">{ofx.name || <span className="dim">—</span>}</td>
                        <td className={`col-amount ${fileAmtCls}`}>{formatCurrency(ofx.amountMilliunits)}</td>
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
                        <td className={`col-amount ${ynabAmtCls}`}>
                          <span className={overridden ? 'amount-overridden' : ''}>
                            {formatCurrency(dispAmt)}
                          </span>
                          {overridden && (
                            <span className="amount-original">{formatCurrency(ynab.amount)}</span>
                          )}
                        </td>
                        <td><ConfidenceBadge score={payeeScore} manual={manual} approved={approved} /></td>
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

        {/* Zero-dollar OFX transactions — informational, not required to match */}
        {zeroAmountOfx.length > 0 && (
          <div className="zero-amount-section">
            <div className="zero-amount-section-hdr">
              <span>Zero-Amount Statement Entries</span>
              <span className="step-count">{zeroAmountOfx.length} — informational, no match required</span>
            </div>
            <div className="table-wrap">
              <table className="txn-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Payee / Description</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {zeroAmountOfx.map(t => (
                    <tr key={t.fitid} className="row-zero-amount">
                      <td className="col-date">{t.date}</td>
                      <td className="col-payee">{t.name || <span className="dim">—</span>}</td>
                      <td className="col-amount dim">$0.00</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pending approval — amount+date matches that need user confirmation */}
        {pendingMatches.length > 0 && (
          <div className="pending-section">
            <div className="pending-section-hdr">
              <span>Pending Approval</span>
              <span className="step-count">{pendingMatches.length} — amount/date match only, payee unverified</span>
            </div>
            <div className="table-wrap">
              <table className="txn-table match-table">
                <thead>
                  <tr>
                    <th className="col-source">Source</th>
                    <th>Date</th>
                    <th>Payee</th>
                    <th className="right">Amount</th>
                    <th>Match</th>
                    <th className="col-action pending-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingMatches.map(({ ofx, ynab, daysDiff: dd }, i) => {
                    const pairCls    = `pair-pending-${i % 2 === 0 ? 'even' : 'odd'}`;
                    const fileAmtCls = ofx.amountMilliunits < 0 ? 'neg' : 'pos';
                    const ynabAmtCls = ynab.amount < 0 ? 'neg' : 'pos';
                    return (
                      <>
                        <tr key={`${ofx.fitid}-file`} className={`row-pair row-file ${pairCls}`}>
                          <td><span className="source-badge source-file">File</span></td>
                          <td className="col-date">{ofx.date}</td>
                          <td className="col-payee">{ofx.name || <span className="dim">—</span>}</td>
                          <td className={`col-amount ${fileAmtCls}`}>{formatCurrency(ofx.amountMilliunits)}</td>
                          <td></td>
                          <td></td>
                        </tr>
                        <tr key={`${ofx.fitid}-ynab`} className={`row-pair row-ynab ${pairCls}`}>
                          <td><span className="source-badge source-ynab">YNAB</span></td>
                          <td className="col-date">
                            {ynab.date}
                            {dd > 0 && <span className="day-drift"> ({dd}d)</span>}
                          </td>
                          <td className="col-payee">{ynab.payee_name || <span className="dim">—</span>}</td>
                          <td className={`col-amount ${ynabAmtCls}`}>{formatCurrency(ynab.amount)}</td>
                          <td><ConfidenceBadge pending /></td>
                          <td className="col-action pending-actions">
                            <button className="btn-approve" title="Approve match" onClick={() => onApprovePending(ofx.fitid)}>✓</button>
                            <button className="btn-reject"  title="Reject match"  onClick={() => onRejectPending(ofx.fitid)}>✗</button>
                          </td>
                        </tr>
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Unmatched transactions */}
        {unmatchedRows.length > 0 && (
          <div className="unmatched-section">
            <div className="unmatched-section-hdr">
              <span>Unmatched</span>
              <span className="step-count">
                {unmatchedOfx.length} file · {unmatchedYnab.length} YNAB
              </span>
            </div>

            {bothSelected && (
              <div className={`match-action-bar${amountMismatch ? ' match-action-bar-warn' : ''}`}>
                {amountMismatch
                  ? <span className="match-action-hint match-action-warn">Amounts don't match — edit the YNAB amount first</span>
                  : <span className="match-action-hint">1 file + 1 YNAB transaction selected</span>
                }
                <div className="match-action-btns">
                  <button className="btn-ghost btn-sm" onClick={() => { setSelOfxId(null); setSelYnabId(null); }}>
                    Clear
                  </button>
                  <button className="btn-primary btn-sm" onClick={handleMatchSelected} disabled={!canMatch}>
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
                    <th className="col-action"></th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedRows.map(row => {
                    const isFile     = row.src === 'file';
                    const isSelected = isFile ? selOfxId === row.id : selYnabId === row.id;
                    const override   = !isFile ? amountOverrides[row.id] : undefined;
                    const dispAmt    = override !== undefined ? override : row.amount;
                    const amtCls     = dispAmt < 0 ? 'neg' : 'pos';
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
                        <td className={`col-amount ${amtCls}`} onClick={e => e.stopPropagation()}>
                          {isFile ? formatCurrency(row.amount) : (
                            <span className="amount-with-edit">
                              <span className="amount-edit-btns">
                                <button
                                  className="btn-edit-amount"
                                  title="Edit YNAB amount"
                                  onClick={() => setAmountOverrideTarget({ ynab: row.raw, currentAmount: dispAmt })}
                                >✎</button>
                                {override !== undefined && (
                                  <button
                                    className="btn-edit-amount btn-revert"
                                    title="Revert to original"
                                    onClick={() => onClearAmountOverride(row.id)}
                                  >↩</button>
                                )}
                              </span>
                              <span className="amount-value">
                                <span className={override !== undefined ? 'amount-overridden' : ''}>
                                  {formatCurrency(dispAmt)}
                                </span>
                                {override !== undefined && (
                                  <span className="amount-original">{formatCurrency(row.amount)}</span>
                                )}
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="col-sel">
                          <span className={`sel-dot ${isSelected ? 'sel-on' : ''}`}>{isSelected ? '●' : '○'}</span>
                        </td>
                        <td className="col-action col-action-wide" onClick={e => e.stopPropagation()}>
                          {isFile ? (
                            <button
                              className="btn-stage-new"
                              onClick={() => { if (onBudget) onPreStageModal(); setStageTarget(row.raw); }}
                            >
                              + New
                            </button>
                          ) : (
                            <div className="unmatched-ynab-actions">
                              <button
                                className="btn-roll-forward"
                                onClick={() => { if (selYnabId === row.id) setSelYnabId(null); onRollForward(row.id); }}
                              >
                                Roll Fwd
                              </button>
                              <button
                                className="btn-stage-delete"
                                onClick={() => { if (selYnabId === row.id) setSelYnabId(null); onStageDelete(row.id); }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!canMatch && (
              <p className="unmatched-hint">
                Select a File row and a YNAB row to manually match them, click "+ New" on a file row to create it in YNAB, or click "Roll Forward" on a YNAB row to defer it to the next statement.
              </p>
            )}
          </div>
        )}

        {/* Rolled forward */}
        {rolledForward.length > 0 && (
          <div className="rolledfwd-section">
            <div className="rolledfwd-section-hdr">
              <span>Rolled Forward — will remain uncleared</span>
              <span className="step-count">{rolledForward.length}</span>
            </div>
            <div className="table-wrap">
              <table className="txn-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Payee</th>
                    <th className="right">Amount</th>
                    <th className="col-action"></th>
                  </tr>
                </thead>
                <tbody>
                  {rolledForward.map(t => (
                    <tr key={t.id} className="row-rolledfwd">
                      <td className="col-date">{t.date}</td>
                      <td className="col-payee">{t.payee_name || <span className="dim">—</span>}</td>
                      <td className={`col-amount ${t.amount < 0 ? 'neg' : 'pos'}`}>{formatCurrency(t.amount)}</td>
                      {!alreadyCleared && (
                        <td className="col-action">
                          <button className="btn-unmatch" onClick={() => onUndoRollForward(t.id)}>
                            Undo
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Staged for creation */}
        {stagedNew.length > 0 && (
          <div className="staged-section">
            <div className="staged-section-hdr">
              <span>Staged for Creation</span>
              <span className="step-count">{stagedNew.length} transaction{stagedNew.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="table-wrap">
              <table className="txn-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Payee (YNAB)</th>
                    <th>Category</th>
                    <th>Memo</th>
                    <th className="right">Amount</th>
                    <th className="col-action"></th>
                  </tr>
                </thead>
                <tbody>
                  {stagedNew.map(s => {
                    const cat    = categoryGroups.flatMap(g => g.categories).find(c => c.id === s.categoryId);
                    const amtCls = s.ofx.amountMilliunits < 0 ? 'neg' : 'pos';
                    return (
                      <tr key={s.ofx.fitid}>
                        <td className="col-date">{s.ofx.date}</td>
                        <td className="col-payee">{s.payee || <span className="dim">—</span>}</td>
                        <td className="col-memo">{cat ? cat.name : <span className="dim">Uncategorized</span>}</td>
                        <td className="col-memo">{s.memo || <span className="dim">—</span>}</td>
                        <td className={`col-amount ${amtCls}`}>{formatCurrency(s.ofx.amountMilliunits)}</td>
                        {!alreadyCleared && (
                          <td className="col-action">
                            <button className="btn-unmatch" onClick={() => onUnstage(s.ofx.fitid)}>
                              Unstage
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Staged for deletion */}
        {stagedDeletes.length > 0 && (
          <div className="delete-section">
            <div className="delete-section-hdr">
              <span>Staged for Deletion</span>
              <span className="step-count">{stagedDeletes.length} transaction{stagedDeletes.length !== 1 ? 's' : ''} — will be removed from YNAB</span>
            </div>
            <div className="table-wrap">
              <table className="txn-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Payee</th>
                    <th className="right">Amount</th>
                    <th className="col-action"></th>
                  </tr>
                </thead>
                <tbody>
                  {stagedDeletes.map(t => (
                    <tr key={t.id} className="row-staged-delete">
                      <td className="col-date">{t.date}</td>
                      <td className="col-payee">{t.payee_name || <span className="dim">—</span>}</td>
                      <td className={`col-amount ${t.amount < 0 ? 'neg' : 'pos'}`}>{formatCurrency(t.amount)}</td>
                      {!alreadyCleared && (
                        <td className="col-action">
                          <button className="btn-unmatch" onClick={() => onUnstageDelete(t.id)}>
                            Undo
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Step 3: Balance Verification ──────────────────────────────────── */}
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
      {!alreadyCleared && (
        <div className="recon-action">
          <div className="push-checklist">
            <div className={`push-check ${startingBalanceCheck.matches ? 'push-check-ok' : 'push-check-fail'}`}>
              <span className="push-check-icon">{startingBalanceCheck.matches ? '✓' : '✗'}</span>
              Starting balance matches YNAB cleared balance
            </div>
            <div className={`push-check ${allAccountedFor ? 'push-check-ok' : 'push-check-fail'}`}>
              <span className="push-check-icon">{allAccountedFor ? '✓' : '✗'}</span>
              All transactions accounted for
              {!allAccountedFor && (
                <span className="push-check-note">
                  {[
                    unmatchedOfx.length  > 0 && `${unmatchedOfx.length} file unmatched`,
                    pendingMatches.length > 0 && `${pendingMatches.length} pending approval`,
                    unmatchedYnab.length > 0 && `${unmatchedYnab.length} YNAB unmatched`,
                  ].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
            <div className={`push-check ${endingCheck.matches ? 'push-check-ok' : 'push-check-fail'}`}>
              <span className="push-check-icon">{endingCheck.matches ? '✓' : '✗'}</span>
              Projected balance matches statement ending balance
            </div>
          </div>
          {pushError && <div className="error-banner" style={{ marginBottom: '0.75rem' }}>{pushError}</div>}
          <button className="btn-primary" onClick={onPush} disabled={pushing || !canPush}>
            {pushing ? 'Pushing to YNAB…' : 'Push to YNAB'}
          </button>
          {canPush && (
            <p className="recon-action-note">
              {matches.length > 0 && (
                <>
                  Mark {matches.length} matched transaction{matches.length !== 1 ? 's' : ''} as cleared
                  {overrideCount > 0 && ` (${overrideCount} with updated amounts)`}.{' '}
                </>
              )}
              {stagedNew.length > 0 && (
                <>Create {stagedNew.length} new transaction{stagedNew.length !== 1 ? 's' : ''} in YNAB.{' '}</>
              )}
              {stagedDeletes.length > 0 && (
                <>Delete {stagedDeletes.length} transaction{stagedDeletes.length !== 1 ? 's' : ''} from YNAB.</>
              )}
            </p>
          )}
        </div>
      )}
      {alreadyCleared && (
        <div className="recon-action">
          <div className="step-success" style={{ marginBottom: '0.75rem' }}>
            {clearedIds.size} transaction{clearedIds.size !== 1 ? 's' : ''} marked as cleared in YNAB.
          </div>
          <button className="btn-secondary" onClick={onRefresh}>
            ↺ Reconcile Again
          </button>
          <p className="recon-action-note">
            Removes the current statement and re-fetches uncleared transactions from YNAB.
          </p>
        </div>
      )}

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {stageTarget !== null && (
        <StageAsNewModal
          ofx={stageTarget}
          onBudget={onBudget}
          categoryGroups={categoryGroups}
          categoriesLoading={categoriesLoading}
          onStage={(fields) => {
            onConfirmStage(stageTarget.fitid, fields);
            setStageTarget(null);
          }}
          onClose={() => setStageTarget(null)}
        />
      )}
      {amountOverrideTarget !== null && (
        <AmountOverrideModal
          ynab={amountOverrideTarget.ynab}
          currentAmount={amountOverrideTarget.currentAmount}
          onApply={(newAmt) => {
            onOpenAmountOverride(amountOverrideTarget.ynab.id, newAmt);
            setAmountOverrideTarget(null);
          }}
          onClose={() => setAmountOverrideTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
function Dashboard({ token, budgets, onReset }) {
  const [selectedBudget, setSelectedBudget]   = useState(
    budgets.length === 0 ? null
      : [...budgets].sort((a, b) => (b.last_modified_on > a.last_modified_on ? 1 : -1))[0]
  );
  const [accounts, setAccounts]               = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [accountDetails, setAccountDetails]   = useState(null);
  const [transactions, setTransactions]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError]           = useState('');
  const [fetched, setFetched]       = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'date', dir: 'desc' });

  // ── Reconciliation state ───────────────────────────────────────────────────
  const [showImportModal, setShowImportModal] = useState(false);
  const [ofxData, setOfxData]                 = useState(null);
  const [matches, setMatches]                 = useState([]);
  const [pendingMatches, setPendingMatches]   = useState([]);
  const [unmatchedOfx, setUnmatchedOfx]       = useState([]);
  const [unmatchedYnab, setUnmatchedYnab]     = useState([]);
  const [reconStartingCheck, setReconStartingCheck] = useState(null);

  // ── Zero-dollar OFX transactions (informational — not matched or required) ──
  const [zeroAmountOfx, setZeroAmountOfx] = useState([]);

  // ── Staged new transactions ────────────────────────────────────────────────
  const [stagedNew, setStagedNew]               = useState([]);
  const [stagedDeletes, setStagedDeletes]       = useState([]);
  const [amountOverrides, setAmountOverrides]   = useState({});
  const [categoryGroups, setCategoryGroups]     = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  // ── Rolled-forward YNAB transactions ──────────────────────────────────────
  const [rolledForward, setRolledForward] = useState([]);

  // ── Push state ─────────────────────────────────────────────────────────────
  const [pushing, setPushing]     = useState(false);
  const [pushError, setPushError] = useState('');
  const [clearedIds, setClearedIds] = useState(new Set());

  const reconActive = reconStartingCheck !== null;

  // ── Derived: dynamic ending balance check ─────────────────────────────────
  const endingCheck = reconActive && accountDetails && ofxData
    ? (() => {
        const alreadyCleared  = clearedIds.size > 0;
        const projected = alreadyCleared
          ? accountDetails.cleared_balance
          : accountDetails.cleared_balance
            + matches.reduce((s, m) => s + (amountOverrides[m.ynab.id] ?? m.ynab.amount), 0)
            + stagedNew.reduce((s, n) => s + n.ofx.amountMilliunits, 0);
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

  // ── Derived: unmatched balance totals ─────────────────────────────────────
  const unmatchedCredits = reconActive
    ? unmatchedOfx.filter(t => t.amountMilliunits > 0).reduce((s, t) => s + t.amountMilliunits, 0)
    : 0;
  const unmatchedDebits = reconActive
    ? unmatchedOfx.filter(t => t.amountMilliunits < 0).reduce((s, t) => s + t.amountMilliunits, 0)
    : 0;

  // ── Auto-load accounts whenever selected budget changes ───────────────────
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
      setCategoryGroups([]);
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
    setPendingMatches([]);
    setUnmatchedOfx([]);
    setUnmatchedYnab([]);
    setReconStartingCheck(null);
    setZeroAmountOfx([]);
    setStagedNew([]);
    setStagedDeletes([]);
    setAmountOverrides({});
    setRolledForward([]);
    setPushError('');
    setClearedIds(new Set());
  }

  // ── Load categories (lazy — on first "+ New" open) ─────────────────────────
  async function ensureCategoriesLoaded() {
    if (categoryGroups.length > 0 || categoriesLoading) return;
    setCategoriesLoading(true);
    try {
      const groups = await getCategories(token, selectedBudget.id);
      setCategoryGroups(groups);
    } catch {
      // non-fatal — category select will just be empty
    } finally {
      setCategoriesLoading(false);
    }
  }

  async function loadTransactions() {
    if (!selectedAccount) return;
    setLoading(true);
    setLoadingStatus('');
    setError('');
    setFetched(false);
    resetPhase2();
    try {
      const details = await getAccountDetails(token, selectedBudget.id, selectedAccount.id);
      setAccountDetails(details);

      // Walk backwards month by month to collect all uncleared transactions.
      // Stop when the oldest fetched month has transactions and they are all reconciled.
      // Continue when the oldest month has uncleared transactions OR has no transactions at all.
      // Hard limit: 12 months. Zero total transactions after that window is an error.
      const MAX_MONTHS_BACK = 12;
      let sinceDate = startOfMonth(new Date());
      let allTxns   = [];

      for (let i = 0; i <= MAX_MONTHS_BACK; i++) {
        const sinceDateStr = format(sinceDate, 'yyyy-MM-dd');
        const sinceMonth   = format(sinceDate, 'yyyy-MM');
        setLoadingStatus(format(sinceDate, 'MMM yyyy'));

        allTxns = await getTransactionsSince(token, selectedBudget.id, selectedAccount.id, sinceDateStr);

        const boundaryTxns = allTxns.filter(t => t.date.startsWith(sinceMonth));

        // All transactions in the oldest month are reconciled — no need to go further back
        if (boundaryTxns.length > 0 && boundaryTxns.every(t => t.cleared === 'reconciled')) break;

        // Hit the limit — stop regardless
        if (i === MAX_MONTHS_BACK) break;

        // Boundary month has uncleared transactions, or has no transactions at all — keep going back
        sinceDate = startOfMonth(subMonths(sinceDate, 1));
      }

      if (allTxns.length === 0) {
        throw new Error(
          `No transactions found for "${selectedAccount.name}" in the last ${MAX_MONTHS_BACK} months. ` +
          'Verify the correct account is selected.'
        );
      }

      // Empty uncleared list is a valid success state — everything is cleared or reconciled
      setTransactions(allTxns.filter(t => t.cleared === 'uncleared'));
      setFetched(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }

  // Auto-fetch when the selected account changes.
  useEffect(() => {
    if (selectedAccount) loadTransactions();
  }, [selectedAccount?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleBudgetChange(e) {
    const budget = budgets.find(b => b.id === e.target.value);
    setAccounts([]);
    setSelectedAccount(null);
    setAccountDetails(null);
    setTransactions([]);
    setFetched(false);
    resetPhase2();
    setSelectedBudget(budget);
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
    const zeroAmt = parsed.transactions.filter(t => t.amountMilliunits === 0);
    const nonZero = parsed.transactions.filter(t => t.amountMilliunits !== 0);
    setZeroAmountOfx(zeroAmt);
    const result      = matchTransactions(transactions, nonZero);
    setMatches(result.matched);
    setPendingMatches(result.pendingMatches);
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
    setStagedNew([]);
    setAmountOverrides({});
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
    // Remove any amount override for this YNAB transaction
    setAmountOverrides(prev => { const n = { ...prev }; delete n[match.ynab.id]; return n; });
  }

  // ── Staged delete handlers ────────────────────────────────────────────────
  function handleStageDelete(ynabId) {
    const txn = unmatchedYnab.find(t => t.id === ynabId);
    if (!txn) return;
    setStagedDeletes(prev => [...prev, txn]);
    setUnmatchedYnab(prev => prev.filter(t => t.id !== ynabId));
  }

  function handleUnstageDelete(ynabId) {
    const txn = stagedDeletes.find(t => t.id === ynabId);
    if (!txn) return;
    setStagedDeletes(prev => prev.filter(t => t.id !== ynabId));
    setUnmatchedYnab(prev => [...prev, txn].sort((a, b) => a.date < b.date ? -1 : 1));
  }

  // ── Pending match approval ────────────────────────────────────────────────
  function handleApprovePending(ofxFitid) {
    const pm = pendingMatches.find(p => p.ofx.fitid === ofxFitid);
    if (!pm) return;
    setPendingMatches(prev => prev.filter(p => p.ofx.fitid !== ofxFitid));
    setMatches(prev => [...prev, { ofx: pm.ofx, ynab: pm.ynab, payeeScore: null, daysDiff: pm.daysDiff, approved: true }]);
  }

  function handleRejectPending(ofxFitid) {
    const pm = pendingMatches.find(p => p.ofx.fitid === ofxFitid);
    if (!pm) return;
    setPendingMatches(prev => prev.filter(p => p.ofx.fitid !== ofxFitid));
    setUnmatchedOfx(prev => [...prev, pm.ofx].sort((a, b) => a.date < b.date ? -1 : 1));
    setUnmatchedYnab(prev => [...prev, pm.ynab].sort((a, b) => a.date < b.date ? -1 : 1));
  }

  // ── Stage-as-new handlers ─────────────────────────────────────────────────
  function handleOpenStageModal(ofxFitid, fields) {
    // Called when StageAsNewModal confirms — move OFX txn to stagedNew
    const ofxTxn = unmatchedOfx.find(t => t.fitid === ofxFitid);
    if (!ofxTxn) return;
    setStagedNew(prev => [...prev, { ofx: ofxTxn, payee: fields.payee, categoryId: fields.categoryId, memo: fields.memo }]);
    setUnmatchedOfx(prev => prev.filter(t => t.fitid !== ofxFitid));
  }

  function handleUnstage(ofxFitid) {
    const staged = stagedNew.find(s => s.ofx.fitid === ofxFitid);
    if (!staged) return;
    setStagedNew(prev => prev.filter(s => s.ofx.fitid !== ofxFitid));
    setUnmatchedOfx(prev => [...prev, staged.ofx].sort((a, b) => a.date < b.date ? -1 : 1));
  }

  // ── Roll-forward handlers ─────────────────────────────────────────────────
  function handleRollForward(ynabId) {
    const txn = unmatchedYnab.find(t => t.id === ynabId);
    if (!txn) return;
    setRolledForward(prev => [...prev, txn]);
    setUnmatchedYnab(prev => prev.filter(t => t.id !== ynabId));
  }

  function handleUndoRollForward(ynabId) {
    const txn = rolledForward.find(t => t.id === ynabId);
    if (!txn) return;
    setRolledForward(prev => prev.filter(t => t.id !== ynabId));
    setUnmatchedYnab(prev => [...prev, txn].sort((a, b) => a.date < b.date ? -1 : 1));
  }

  // ── Amount override handlers ──────────────────────────────────────────────
  function handleAmountOverride(ynabId, newAmount) {
    setAmountOverrides(prev => ({ ...prev, [ynabId]: newAmount }));
  }

  function handleClearAmountOverride(ynabId) {
    setAmountOverrides(prev => { const n = { ...prev }; delete n[ynabId]; return n; });
  }

  // ── Push to YNAB ──────────────────────────────────────────────────────────
  async function handlePushToYnab() {
    setPushing(true);
    setPushError('');
    try {
      if (matches.length > 0) {
        const txns = matches.map(m => ({
          id:      m.ynab.id,
          cleared: 'cleared',
          ...(amountOverrides[m.ynab.id] !== undefined ? { amount: amountOverrides[m.ynab.id] } : {}),
        }));
        await clearTransactions(token, selectedBudget.id, txns);
      }
      if (stagedNew.length > 0) {
        const newTxns = stagedNew.map(s => ({
          account_id:  selectedAccount.id,
          date:        s.ofx.date,
          amount:      s.ofx.amountMilliunits,
          payee_name:  s.payee,
          ...(s.categoryId ? { category_id: s.categoryId } : {}),
          ...(s.memo       ? { memo: s.memo }               : {}),
          cleared: 'cleared',
        }));
        await createTransactions(token, selectedBudget.id, newTxns);
      }
      if (stagedDeletes.length > 0) {
        for (const txn of stagedDeletes) {
          await deleteTransaction(token, selectedBudget.id, txn.id);
        }
      }
      const details = await getAccountDetails(token, selectedBudget.id, selectedAccount.id);
      setAccountDetails(details);
      const idSet = new Set(matches.map(m => m.ynab.id));
      const deletedIdSet = new Set(stagedDeletes.map(t => t.id));
      setTransactions(prev => prev.filter(t => !idSet.has(t.id) && !deletedIdSet.has(t.id)));
      setClearedIds(idSet);
      setAmountOverrides({});
    } catch (err) {
      setPushError(err.message);
    } finally {
      setPushing(false);
    }
  }

  function handleRefresh() {
    resetPhase2();
    loadTransactions();
  }

  // ── Derived display values ─────────────────────────────────────────────────
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

        {loading && loadingStatus && (
          <span className="loading-status">Checking {loadingStatus}…</span>
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
            <>
              <BalanceTile label="YNAB Cleared"   amount={accountDetails.cleared_balance} highlight />
              <BalanceTile label="YNAB Working"   amount={accountDetails.balance} />
              <div className="strip-divider" />
              <BalanceTile label="Stmt Beginning" amount={ofxData.startingBalanceMilliunits} dim />
              <BalanceTile label="Stmt Ending"    amount={ofxData.endingBalanceMilliunits}   dim />
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
              {stagedNew.length > 0 && (
                <div className="balance-tile count-tile">
                  <span className="btile-label">Staged New</span>
                  <span className="btile-count" style={{ color: 'var(--green)' }}>{stagedNew.length}</span>
                </div>
              )}
            </>
          ) : (
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
                <tr key={t.id}>
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
          <p>No uncleared transactions found for <strong>{selectedAccount?.name}</strong>.</p>
          <p className="dim">All transactions are cleared or reconciled.</p>
        </div>
      )}

      {/* ── Reconciliation Panel ───────────────────────────────────────── */}
      {reconActive && ofxData && endingCheck && (
        <ReconcilePanel
          matches={matches}
          pendingMatches={pendingMatches}
          unmatchedOfx={unmatchedOfx}
          unmatchedYnab={unmatchedYnab}
          ofxData={ofxData}
          startingBalanceCheck={reconStartingCheck}
          endingCheck={endingCheck}
          onBudget={selectedAccount?.on_budget ?? false}
          zeroAmountOfx={zeroAmountOfx}
          stagedNew={stagedNew}
          stagedDeletes={stagedDeletes}
          amountOverrides={amountOverrides}
          categoryGroups={categoryGroups}
          categoriesLoading={categoriesLoading}
          rolledForward={rolledForward}
          onRollForward={handleRollForward}
          onUndoRollForward={handleUndoRollForward}
          onManualMatch={handleManualMatch}
          onUnmatch={handleUnmatch}
          onApprovePending={handleApprovePending}
          onRejectPending={handleRejectPending}
          onStageDelete={handleStageDelete}
          onUnstageDelete={handleUnstageDelete}
          onPreStageModal={ensureCategoriesLoaded}
          onConfirmStage={handleOpenStageModal}
          onUnstage={handleUnstage}
          onOpenAmountOverride={handleAmountOverride}
          onClearAmountOverride={handleClearAmountOverride}
          onPush={handlePushToYnab}
          pushing={pushing}
          pushError={pushError}
          onRefresh={handleRefresh}
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
