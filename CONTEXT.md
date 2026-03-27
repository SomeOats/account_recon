# YNAB Reconciler — Project Context

## What this is
A local React/Vite app for reconciling YNAB accounts against bank statements.
Calls the YNAB REST API directly from the browser using a personal access token.

## Current state (Phase 1 complete)
- Token entry screen with API validation
- Budget + account selection
- Fetches uncleared transactions for a date range
- Shows cleared balance, uncleared balance, working balance

## Phase 2 goals
- OFX/QFX file upload and parsing (manually downloaded from TD Bank / Capital One)
- Side-by-side comparison: statement transactions vs YNAB uncleared transactions
- Fuzzy payee matching (bank names are mangled vs YNAB payee names)
- Highlight mismatches: wrong amount, date drift (±3 days acceptable), missing entries
- One-click mark-as-cleared via YNAB API PATCH /transactions/{id}

## Key technical notes
- YNAB amounts are in milliunits (1000 = $1.00), see ynab.js
- Cleared status values: "uncleared", "cleared", "reconciled"
- OFX/QFX is XML-like but with a legacy SGML header — needs a parser