# ADR 0002: Balanced unified ledger

- Status: Accepted
- Date: 2026-07-18

## Context

The workbook separates liabilities, monthly expense summaries, and construction. The application
must add transaction-level detail while preventing credit-card payments, transfers, investments,
loan principal, and goal allocations from inflating expenses or income.

## Decision

Represent each approved financial event as one journal transaction with signed postings whose sum
is zero paise. Tracker screens and charts are derived views over the same ledger. Posted entries are
corrected through linked reversal and replacement, not in-place mutation.

## Consequences

- Transfers and liability payments are modeled correctly without ad hoc exclusions.
- Every tracker can reconcile to one financial truth and preserve source evidence.
- UI and import adapters must construct balanced postings, which is more rigorous than a flat list.
- Historical category-only data must be labeled aggregate and later replaced carefully by detail.

## Rejected alternatives

- Independent tracker tables: creates drift and duplicate totals.
- Flat transaction with one category/account: cannot correctly represent splits and transfers.
- Editable posted rows: weakens auditability and reconciliation.
