# ADR 0004: Deterministic forecasting baseline

- Status: Accepted
- Date: 2026-07-18

## Context

The product needs twelve-month predictions, debt snowball planning, goal projections, and alerts.
Initial history is partly aggregated and construction data is stale, so opaque models would imply
more confidence than the source data supports.

## Decision

Start with a deterministic, versioned forecast engine using reconciled balances, posted activity,
confirmed schedules, explicit plans, budgets, and robust trailing variation. Store assumptions and
explanations with every result. Treat optional machine-learning suggestions as a later supplement,
never a replacement for the baseline.

## Consequences

- Results are testable, explainable, and usable fully offline without paid APIs.
- Forecast confidence can reflect source freshness and history quality.
- Complex behavioral patterns may be modeled less precisely at first.
- Monthly backtesting can establish evidence before adding more sophisticated methods.

## Rejected alternatives

- Cloud AI forecasting: violates local-first goals and is not justified by current data quality.
- Single-point projections without assumptions/ranges: creates misleading certainty.
