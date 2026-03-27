import { useState, useCallback } from 'react';
import { getBudgets, getAccounts, getUnclearedTransactions, getAccountDetails, formatCurrency } from './ynab';
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

// ─── Main Dashboard ───────────────────────────────────────────────────────────
function Dashboard({ token, budgets, onReset }) {
  const [selectedBudget, setSelectedBudget] = useState(budgets[0] || null);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [accountDetails, setAccountDetails] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [sinceDate, setSinceDate] = useState(
    () => format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd')
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'date', dir: 'desc' });

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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  async function loadTransactions() {
    if (!selectedAccount) return;
    setLoading(true);
    setError('');
    setFetched(false);
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
  }

  function handleSort(key) {
    setSortConfig(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  }

  const sorted = [...transactions].sort((a, b) => {
    const { key, dir } = sortConfig;
    const av = a[key] ?? '';
    const bv = b[key] ?? '';
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });

  const totalUncleared = transactions.reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="screen dashboard">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="logo-mark-sm">Y</span>
          YNAB Reconciler
        </div>
        <button className="btn-ghost" onClick={onReset}>← Change Token</button>
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
          <button
            className="btn-primary"
            onClick={loadTransactions}
            disabled={loading}
          >
            {loading ? 'Fetching…' : 'Fetch Uncleared'}
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {accountDetails && (
        <div className="balance-strip">
          <BalanceTile label="Cleared Balance" amount={accountDetails.cleared_balance} highlight />
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

      {sorted.length > 0 && (
        <div className="table-wrap">
          <table className="txn-table">
            <thead>
              <tr>
                <SortTh label="Date" colKey="date" config={sortConfig} onSort={handleSort} />
                <SortTh label="Payee" colKey="payee_name" config={sortConfig} onSort={handleSort} />
                <th>Memo</th>
                <SortTh label="Amount" colKey="amount" config={sortConfig} onSort={handleSort} right />
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

      {fetched && transactions.length === 0 && (
        <div className="empty-state">
          <span className="check-icon">✓</span>
          <p>No uncleared transactions since <strong>{sinceDate}</strong>.</p>
          <p className="dim">All transactions in this window are cleared or reconciled.</p>
        </div>
      )}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState(null);
  const [budgets, setBudgets] = useState([]);

  function handleSave(t, b) {
    setToken(t);
    setBudgets(b);
  }

  if (!token) return <TokenScreen onSave={handleSave} />;
  return <Dashboard token={token} budgets={budgets} onReset={() => setToken(null)} />;
}
