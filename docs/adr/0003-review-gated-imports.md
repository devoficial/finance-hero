# ADR 0003: Human approval before import posting

- Status: Accepted
- Date: 2026-07-18

## Context

Gmail, SMS, OCR, and institution statements can disagree on date, merchant, account, direction,
and duplicates. Incorrect silent automation in personal finance is costly to discover and repair.

## Decision

All automated sources produce versioned candidates in a review queue. The user can edit, select,
merge, split, approve, or reject. Approval creates the canonical balanced transaction and retains
all evidence in one atomic operation. No automation bypasses approval in the initial release.

## Consequences

- Automation remains transparent and recoverable.
- Cross-source duplicates can become one transaction with multiple evidence links.
- Imports require a well-designed high-volume review experience.
- Classification feedback improves suggestions without surrendering control.

## Rejected alternatives

- Confidence-based auto-posting: deferred until extensive clean evidence and separate consent exist.
- Source-specific ledgers: hides duplicate activity and fragments reconciliation.
