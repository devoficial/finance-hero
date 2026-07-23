# Product requirements

## 1. Product statement

Finance Hero replaces a multi-sheet personal finance workbook with one private,
auditable system. It should reduce manual entry without taking control away from
the user, preserve the spreadsheet's useful mental models, and make cash-flow,
debt, savings, and project decisions easier to understand.

## 2. User and environment

- One owner and one Google account.
- Primary computer: a Mac that is not kept running continuously.
- Mobile client: an installed PWA on iPhone.
- Permanent storage and backups: Mac only.
- Currency: INR only; Indian digit grouping is used in the UI.
- Time zone: `Asia/Kolkata`; financial dates use local calendar dates.

## 3. Core product principles

1. **One financial truth.** Every approved activity is represented once in the
   unified ledger; tracker screens are projections over that ledger.
2. **Review before record.** Automation creates candidates, never final entries.
3. **Evidence first.** Imported entries retain source, source date, original text,
   parser version, and matching history.
4. **Editable but auditable.** Users can correct anything; material changes append
   audit events instead of silently destroying history.
5. **Explainable advice.** Forecasts expose assumptions and calculations.
6. **Local by default.** No financial data is sent to an application cloud.

## 4. Functional scope

### 4.1 Home dashboard

The default authenticated screen shows:

- cash and restricted-wallet balances;
- month-to-date income, regular expenses, budget used, and projected month end;
- total debt, total EMI, next due items, and snowball target;
- savings and investments, goal progress, and emergency-fund coverage;
- home-construction committed, paid, pending, and projected final cost;
- pending import candidates and data-quality warnings;
- alerts, upcoming obligations, and a manual privacy toggle;
- twelve-month cash-flow and net-worth trends.

### 4.2 Unified ledger

- Transaction-level tracking with split transactions and attachments.
- Manual add, edit, duplicate, reverse, split, merge, and soft-delete actions.
- Search and filters for date, account, category, merchant, source, project, person,
  amount, review status, and reconciliation status.
- Transfers, credit-card payments, savings allocations, investments, loans, and
  reimbursements must not be double-counted as expenses.
- Bulk recategorization creates a reusable merchant/category rule when requested.

### 4.3 Daily expenses

- Year selector defaults to 2026 and shows all months with data.
- Previous years stay collapsed until selected.
- Each month card shows totals, budget status, trend, and one broad-bucket donut:
  regular expenses, EMI/debt costs, construction/projects, savings/investments,
  and lending/other.
- Selecting a month opens category totals and the detailed ledger table.
- Monthly category budgets reset. Unused regular budget can be allocated to a goal.
- Project budgets roll forward until a project is closed.

### 4.4 Liabilities and EMI

- Bank/NBFC loans, credit cards, and personal borrowing.
- Original amount, current principal, rate, EMI, due date, lender, tenure, schedule,
  prepayments, attachments, and current statement date.
- Statement principal is authoritative; calculated amortization is labeled projected.
- Default payoff method is debt snowball; simulations support additional monthly
  payment, lump sum, payment order, and rate changes.
- Credit-card purchases are expenses on purchase date; bill payments are transfers.

### 4.5 Savings, investments, and goals

- Savings accounts and food-only wallets such as the Rs 8,800 Pluxee balance. Pluxee purchases reduce
  the wallet and count under the selected food or grocery expense category, but the balance cannot fund goals.
- Emergency-fund goals can use a live coverage formula: coverage months x (active EMIs + regular expense budget).
- Investments: mutual funds/SIPs, stocks, ETFs, FD, RD, EPF, PPF, NPS, insurance,
  gold, property, crypto, and custom assets.
- Manual valuations are mandatory; automatic valuation connectors are optional and
  must never prevent offline use.
- Goals have target amount/date, priority, actual allocation, monthly requirement,
  projected completion date, and on-track status.
- Goal allocations reference existing asset balances; they do not create money.

### 4.6 People ledger

- Track `I Owe` and `Owes Me`, with partial settlements and linked ledger entries.
- Generate reminder text for WhatsApp or SMS, but never send automatically.
- A settlement changes the receivable/payable balance without creating income or expense.

### 4.7 Projects and home construction

- Reusable projects engine with Home Construction as the first project.
- Vendors, phases, estimates, commitments, paid/pending amounts, milestones,
  attachments, comments, and final-cost forecast.
- The initial construction migration is imported as-is and marked `Needs Update`.

### 4.8 Import and synchronization

- Manual Sync discovers candidates from Gmail, forwarded iPhone messages, uploaded
  statements, and manual drafts.
- Gmail scans the latest 12 months initially, then every two days at 08:00 IST when
  the Mac is running, with catch-up on next launch.
- Support PDF, password-protected PDF, scanned PDF, CSV, XLS, and XLSX statements.
- Review queue supports individual selection, multi-select, select all, edit,
  approve, reject, merge duplicates, and split.
- Candidates from multiple sources that represent one transaction are merged while
  preserving all source references.

### 4.9 Notifications

- Trigger a danger alert when approved regular expenses reach at least 60% of the
  monthly regular budget before day 20.
- Exclude EMI, investment, transfers, construction, and loan repayments from that threshold.
- On the first day of a month at 09:00 IST, summarize the prior month and current
  outlook. If the Mac was off, create the notification on next launch.
- Exact-time iPhone delivery is best effort in a fully local deployment.

## 5. Forecasting scope

The initial release provides deterministic twelve-month projections for:

- account cash flow and end-of-month balance;
- income and recurring expenses;
- category budget run rate;
- loan payoff and interest under snowball scenarios;
- savings-goal completion;
- project final cost based on estimate, commitments, and observed burn;
- net worth.

Every prediction must display its assumptions, last calculated time, and confidence
classification. Machine-learning forecasting is deferred until sufficient clean
history exists and cannot replace the deterministic baseline.

## 6. Accounting rules

| Event | Ledger treatment |
| --- | --- |
| Salary received | Increase bank asset; recognize income |
| Credit-card purchase | Recognize expense; increase card liability |
| Credit-card bill paid | Decrease bank asset and card liability; no expense |
| Transfer between own accounts | Asset-to-asset transfer; no income or expense |
| Investment contribution | Bank asset to investment asset; allocation, not expense |
| Loan disbursement | Increase bank asset and loan liability |
| Loan payment | Split between principal reduction, interest expense, and fees |
| Money lent | Bank asset to receivable asset; no expense |
| Money borrowed from person | Increase cash/bank and payable liability |
| Pluxee benefit | Increase restricted-wallet asset and benefit income |
| Goal allocation | Earmark an existing asset balance; no ledger transaction |

## 7. Explicit non-goals for the initial release

- Multi-user household collaboration.
- Multi-currency accounting or tax filing.
- Bank account aggregation through paid providers.
- Automatic money movement or bill payment.
- Automatic sending of personal reminders.
- Guaranteed notifications while the Mac is off.
- Public internet exposure of the local API.
- Fully automatic import without review.

## 8. Release acceptance criteria

- A clean migration reconciles opening debt balances, historical category totals,
  and construction records against the workbook within documented tolerances.
- Debit, credit, transfer, card payment, loan payment, investment, lending, and
  split-transaction fixtures all satisfy balanced-ledger tests.
- A candidate imported from both Gmail and SMS results in one approved transaction
  with two retained source references.
- The iPhone can add a transaction offline and synchronize it once without duplication.
- Budget alerts and month-close summaries follow the stated inclusion rules.
- Backup restore produces the same ledger balances, attachments index, and audit chain.
- The PWA remains usable on current Safari/iOS and desktop Chromium at phone and Mac sizes.
