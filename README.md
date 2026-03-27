# YNAB Reconciler

A local React app for reconciling YNAB accounts against bank statements.

## Setup

### Prerequisites
- Node.js 18+
- A YNAB Personal Access Token

### Generate a YNAB API Token
1. Log in to YNAB at https://app.ynab.com
2. Go to **Account Settings → Developer Settings**
3. Click **New Token**, give it a name, confirm your password
4. Copy the token — you only see it once

### Install & Run
```bash
npm install
npm run dev
```
Open your browser to http://localhost:5173

---

## Usage

1. **Connect** — Paste your token and click "Connect to YNAB". Never written to disk.
2. **Load Accounts** — Select your budget and click "Load Accounts".
3. **Select Account** — Pick the account you're reconciling (e.g. "TD Bank Checking").
4. **Set Date Range** — Defaults to the first of last month. Adjust to your statement period.
5. **Fetch Uncleared** — Pulls all `uncleared` transactions for that account/period.

### Balance Tiles
| Tile | What it means |
|------|---------------|
| Cleared Balance | All cleared + reconciled txns in YNAB. Should match your statement opening balance. |
| Uncleared Balance | Dollar total of uncleared transactions (all time, not date-filtered). |
| Working Balance | Cleared + Uncleared combined. |
| Uncleared Txns | Count of uncleared transactions in the fetched date window. |
| Uncleared Sum | Net value of the uncleared transactions shown in the table. |

---

## Roadmap (Phase 2)
- OFX/QFX file upload and parsing
- Fuzzy payee matching against YNAB transactions
- Side-by-side comparison view
- Highlight mismatches (amount off, date drift, missing entries)
- One-click mark-as-cleared via YNAB API

---

## Notes
- Token lives in React state only — clears on tab close/refresh.
- `reconciled` transactions are excluded (already locked in YNAB).
- YNAB stores amounts as milliunits (1000 = $1.00), converted for display.
