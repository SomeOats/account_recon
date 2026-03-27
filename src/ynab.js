const BASE_URL = 'https://api.ynab.com/v1';

async function apiFetch(token, path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.detail || `YNAB API error: ${res.status}`);
  }
  return res.json();
}

export function milliunitsToAmount(milliunits) {
  return milliunits / 1000;
}

export function formatCurrency(milliunits) {
  const amount = milliunitsToAmount(milliunits);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export async function getBudgets(token) {
  const data = await apiFetch(token, '/budgets');
  return data.data.budgets;
}

export async function getAccounts(token, budgetId) {
  const data = await apiFetch(token, `/budgets/${budgetId}/accounts`);
  return data.data.accounts.filter((a) => !a.deleted && !a.closed);
}

export async function getUnclearedTransactions(token, budgetId, accountId, fromDate, toDate) {
  const params = fromDate ? `?since_date=${fromDate}` : '';
  const data = await apiFetch(token, `/budgets/${budgetId}/transactions${params}`);
  return data.data.transactions.filter(
    (t) =>
      t.account_id === accountId &&
      t.cleared === 'uncleared' &&
      !t.deleted &&
      (!toDate || t.date <= toDate)
  );
}

export async function getAccountDetails(token, budgetId, accountId) {
  const data = await apiFetch(token, `/budgets/${budgetId}/accounts/${accountId}`);
  return data.data.account;
}

// Returns category groups, each with a `categories` array.
// Filters out deleted and hidden groups/categories.
export async function getCategories(token, budgetId) {
  const data = await apiFetch(token, `/budgets/${budgetId}/categories`);
  return data.data.category_groups
    .filter(g => !g.deleted && !g.hidden)
    .map(g => ({
      id:   g.id,
      name: g.name,
      categories: g.categories.filter(c => !c.deleted && !c.hidden).map(c => ({
        id:   c.id,
        name: c.name,
      })),
    }))
    .filter(g => g.categories.length > 0);
}

// Batch-update transactions via the YNAB bulk PATCH endpoint.
// transactions: [{ id, cleared, amount? }]  — pass amount to update it in the same call.
export async function clearTransactions(token, budgetId, transactions) {
  const res = await fetch(`${BASE_URL}/budgets/${budgetId}/transactions`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transactions }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.detail || `YNAB API error: ${res.status}`);
  }
  return res.json();
}

// Create new transactions in YNAB.
// transactions: [{ account_id, date, amount, payee_name, category_id?, memo?, cleared }]
export async function createTransactions(token, budgetId, transactions) {
  const res = await fetch(`${BASE_URL}/budgets/${budgetId}/transactions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transactions }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.detail || `YNAB API error: ${res.status}`);
  }
  return res.json();
}
