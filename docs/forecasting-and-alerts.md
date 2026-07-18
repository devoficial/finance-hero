# Forecasting, planning, and alerts

## 1. Forecast philosophy

Forecasts support decisions; they are not promises. The initial engine is deterministic,
versioned, testable, and explainable. Every result records input cutoff, assumptions,
engine version, expected range, and reasons for material changes.

The primary horizon is 12 months. Historical charts can extend further as clean data grows.

## 2. Input hierarchy

From strongest to weakest:

1. reconciled account/debt statement values;
2. posted ledger transactions;
3. explicit scheduled transactions and user-entered plans;
4. active loan/EMI terms and project commitments;
5. detected recurring patterns confirmed by the user;
6. budget values;
7. trailing historical averages.

Lower-quality inputs never overwrite stronger facts. Stale inputs reduce confidence and
create a visible data-quality warning.

## 3. Cash-flow forecast

For each future day/month:

```text
opening cash
+ expected income
- expected regular expense
- scheduled EMI and debt costs
- planned project payment
- planned investment/savings transfer
+/- known transfers and one-off items
= projected closing cash
```

Expected values are accompanied by low/high ranges. Initial ranges derive from robust
historical variation by category, not random percentages. Users can override assumptions
for salary changes, one-off costs, bonuses, and project payments.

## 4. Month-end projection

For the active month, category projection uses:

- actual approved spend through today;
- remaining confirmed recurring items;
- weekday-adjusted trailing daily rate for discretionary categories;
- known due items and user overrides.

The UI separates `actual`, `scheduled`, and `estimated`. Pending import candidates can be
shown as a separate shadow amount but are not counted as approved actuals.

## 5. Debt snowball

Debt snowball orders eligible debts by current principal ascending while paying minimums
on all debts and directing available extra payment to the smallest. When a debt clears,
its released EMI rolls into the next debt.

The calculator supports:

- statement current principal;
- annual rate in basis points;
- EMI/minimum payment and due date;
- monthly extra payment;
- one-time prepayment;
- fees and rate changes;
- custom priority override and avalanche comparison.

Outputs include payoff month per debt, total interest, interest saved against minimum-only,
debt-free date, and monthly schedule. Statement balances are facts; schedule balances are
projections and recalculate after every reconciled payment.

## 6. Goal forecast

For each goal:

- current funded amount comes from valid actual allocations;
- required monthly contribution solves the gap over months to target;
- projected completion simulates active contributions and optional conservative return;
- status is `on_track`, `at_risk`, `off_track`, `funded`, or `paused`.

Investment return defaults to zero for required-contribution planning. A user may opt into
an assumed return scenario, which is clearly labeled and never treated as guaranteed.

## 7. Project final-cost forecast

Home-construction forecast considers:

- paid actuals;
- open contractual commitments;
- phase estimates less completed actuals;
- approved change orders;
- trailing burn rate only for phases without better estimates;
- explicit contingency.

The result shows estimate-at-completion, remaining cash need, expected payment timeline,
and data freshness. Until the stale migrated project is updated, confidence remains low.

## 8. Net-worth forecast

Net worth equals total assets minus total liabilities. Future points combine cash flow,
planned investment contributions, explicit valuation assumptions, and debt schedules.
Market growth defaults to zero in the conservative baseline. Scenario charts may show
user-selected growth separately.

## 9. Danger alert

The expense danger rule is evaluated after approval, correction, budget change, sync,
and app startup:

```text
if local_day < 20
and approved_regular_expense / regular_expense_budget >= 0.60
and this threshold has not been acknowledged for the current budget revision
then create DANGER_BUDGET_60 alert
```

`approved_regular_expense` excludes EMI, principal repayment, loan interest/fees if shown
in the debt-cost bucket, investments, savings transfers, own-account transfers,
construction/projects, and lending principal. The alert shows numerator, denominator,
included categories, projected month end, and recommended daily allowance.

Re-alerting occurs only when crossing a higher configured threshold or after a material
budget revision; it does not fire on every sync.

## 10. Month-start notification

At 09:00 IST on the first day, or next launch when missed, generate exactly one summary
for the prior month:

- income, regular expense, and budget variance;
- EMI/debt cost and principal reduction;
- savings and investment allocation;
- construction/project spend;
- net cash change and net-worth change;
- pending/unreviewed imports;
- comparison with previous month;
- current-month forecast and highest-risk categories.

The event is persisted before delivery. In-app delivery is guaranteed on next connection;
iPhone push timing is best effort because the Mac is not continuously running.

## 11. Other alert types

- upcoming EMI/card due date and insufficient projected cash;
- stale debt statement balance;
- credit-card utilization threshold;
- goal falling off track;
- construction commitment due/forecast overrun;
- receivable/payable overdue;
- imports waiting beyond a configured number of days;
- Gmail connection failure;
- backup overdue or verification failed;
- sync conflict or phone cache significantly behind.

Alerts have severity, facts, explanation, suggested action, deduplication key, and lifecycle
(`open`, `acknowledged`, `resolved`). Recommendations never execute financial actions.

## 12. Validation and backtesting

Each monthly close compares prior predictions with actuals and stores absolute/percentage
error by metric. Forecast releases are regression-tested against fixed historical fixtures.
If a new engine materially worsens median error, it cannot become default without review.

The app should not label a range `high confidence` until it has at least three clean periods
for recurring fixed items and six clean periods for variable category estimates.
