import type {
  CreateManualTransactionRequest,
  LedgerResponse,
  LedgerTransaction,
  ReferenceDataResponse,
} from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createManualTransaction, replaceTransaction, reverseTransaction } from "../lib/api";

interface LedgerViewProps {
  month: string;
  ledger?: LedgerResponse;
  referenceData?: ReferenceDataResponse;
  loading: boolean;
  money: (paise: number) => string;
}

interface SplitDraft {
  id: string;
  categoryId: string;
  amount: string;
}

type TransactionKind = CreateManualTransactionRequest["kind"];

function currentLocalDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function defaultDateForMonth(month: string): string {
  const today = currentLocalDate();
  return today.startsWith(month) ? today : `${month}-01`;
}

function rupeesToPaise(value: string): number {
  return Math.round(Number(value) * 100);
}

function paiseToInput(value: number): string {
  return (value / 100).toFixed(2);
}

function newSplit(categoryId: string, amount = ""): SplitDraft {
  return { id: crypto.randomUUID(), categoryId, amount };
}

export function LedgerView({ month, ledger, referenceData, loading, money }: LedgerViewProps) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => defaultDateForMonth(month));
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [accountId, setAccountId] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [memo, setMemo] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<SplitDraft[]>([]);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("posted");

  const invalidateLedgerViews = async (...months: string[]) => {
    const affectedMonths = new Set([month, ...months]);
    await Promise.all([
      ...Array.from(affectedMonths).map((affectedMonth) =>
        queryClient.invalidateQueries({ queryKey: ["dashboard", affectedMonth] }),
      ),
      ...Array.from(affectedMonths).map((affectedMonth) =>
        queryClient.invalidateQueries({ queryKey: ["ledger", affectedMonth] }),
      ),
      ...Array.from(affectedMonths).map((affectedMonth) =>
        queryClient.invalidateQueries({ queryKey: ["expenses", "year", affectedMonth.slice(0, 4)] }),
      ),
      queryClient.invalidateQueries({ queryKey: ["liabilities"] }),
    ]);
  };

  const saveTransaction = useMutation({
    mutationFn: async (input: CreateManualTransactionRequest) =>
      correctingId ? replaceTransaction(correctingId, input) : createManualTransaction(input),
    onSuccess: async (transaction) => {
      resetForm();
      await invalidateLedgerViews(transaction.occurredOn.slice(0, 7));
    },
  });

  const reverseEntry = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      reverseTransaction(id, { reason, idempotencyKey: `web:${crypto.randomUUID()}` }),
    onSuccess: async (transaction) => {
      await invalidateLedgerViews(transaction.occurredOn.slice(0, 7));
    },
  });

  const accounts = referenceData?.accounts ?? [];
  const categories = referenceData?.categories ?? [];
  const assetAccounts = accounts.filter((account) => account.accountClass === "asset");
  const liabilityAccounts = accounts.filter((account) => account.accountClass === "liability");
  const paymentAccounts = accounts.filter(
    (account) => account.accountClass === "asset" || account.accountType === "credit_card",
  );
  const sourceAccounts =
    kind === "expense"
      ? paymentAccounts
      : kind === "income" || kind === "transfer" || kind === "debt_payment"
        ? assetAccounts
        : [];
  const destinationAccounts = kind === "transfer" ? assetAccounts : kind === "debt_payment" ? liabilityAccounts : [];
  const effectiveAccountId = sourceAccounts.some((account) => account.id === accountId)
    ? accountId
    : (sourceAccounts.find((account) => account.id === "account-primary-bank")?.id ?? sourceAccounts[0]?.id ?? "");
  const effectiveDestinationId = destinationAccounts.some((account) => account.id === destinationAccountId)
    ? destinationAccountId
    : (destinationAccounts.find((account) => account.id !== effectiveAccountId)?.id ?? "");
  const effectiveCategoryId = categoryId || categories[0]?.id || "";
  const splitTotalPaise = splits.reduce((sum, split) => {
    const value = rupeesToPaise(split.amount);
    return sum + (Number.isSafeInteger(value) && value > 0 ? value : 0);
  }, 0);

  const filteredTransactions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-IN");
    return (ledger?.transactions ?? []).filter((transaction) => {
      const searchable = [
        transaction.payee,
        transaction.memo ?? "",
        transaction.accountName,
        transaction.destinationAccountName ?? "",
        transaction.categoryName ?? "",
        ...transaction.splits.map((split) => split.categoryName),
      ]
        .join(" ")
        .toLocaleLowerCase("en-IN");
      return (
        (!needle || searchable.includes(needle)) &&
        (kindFilter === "all" || transaction.kind === kindFilter) &&
        (categoryFilter === "all" ||
          transaction.categoryId === categoryFilter ||
          transaction.splits.some((split) => split.categoryId === categoryFilter)) &&
        (accountFilter === "all" ||
          transaction.accountId === accountFilter ||
          transaction.destinationAccountId === accountFilter) &&
        (statusFilter === "all" || transaction.status === statusFilter)
      );
    });
  }, [accountFilter, categoryFilter, kindFilter, ledger?.transactions, search, statusFilter]);

  const filteredTotalPaise = filteredTransactions
    .filter((transaction) => transaction.status === "posted" && transaction.kind === "expense")
    .reduce((sum, transaction) => sum + transaction.amountPaise, 0);

  useEffect(() => {
    setDate(defaultDateForMonth(month));
    setPayee("");
    setAmount("");
    setKind("expense");
    setAccountId("");
    setDestinationAccountId("");
    setCategoryId("");
    setMemo("");
    setSplitMode(false);
    setSplits([]);
    setCorrectingId(null);
  }, [month]);

  function resetForm() {
    setDate(defaultDateForMonth(month));
    setPayee("");
    setAmount("");
    setKind("expense");
    setAccountId("");
    setDestinationAccountId("");
    setCategoryId("");
    setMemo("");
    setSplitMode(false);
    setSplits([]);
    setCorrectingId(null);
  }

  function fillFromTransaction(transaction: LedgerTransaction, correction: boolean) {
    setDate(transaction.occurredOn);
    setPayee(transaction.payee);
    setAmount(paiseToInput(transaction.amountPaise));
    setKind(transaction.kind);
    setAccountId(transaction.accountId);
    setDestinationAccountId(transaction.destinationAccountId ?? "");
    setCategoryId(transaction.categoryId ?? transaction.splits[0]?.categoryId ?? "");
    setMemo(transaction.memo ?? "");
    setSplitMode(transaction.splits.length > 1);
    setSplits(
      transaction.splits.length > 1
        ? transaction.splits.map((split) => newSplit(split.categoryId, paiseToInput(split.amountPaise)))
        : [],
    );
    setCorrectingId(correction ? transaction.id : null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startSplit() {
    setSplitMode(true);
    setSplits([newSplit(effectiveCategoryId), newSplit(categories[1]?.id ?? effectiveCategoryId)]);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountPaise = splitMode ? splitTotalPaise : rupeesToPaise(amount);
    const splitPayload = splitMode
      ? splits.map((split) => ({ categoryId: split.categoryId, amountPaise: rupeesToPaise(split.amount) }))
      : undefined;
    if (
      !Number.isSafeInteger(amountPaise) ||
      amountPaise <= 0 ||
      !effectiveAccountId ||
      ((kind === "transfer" || kind === "debt_payment") && !effectiveDestinationId)
    ) {
      return;
    }

    saveTransaction.mutate({
      occurredOn: date,
      payee,
      memo: memo || undefined,
      kind,
      amountPaise,
      accountId: effectiveAccountId,
      destinationAccountId: kind === "transfer" || kind === "debt_payment" ? effectiveDestinationId : undefined,
      categoryId: kind === "expense" && !splitMode ? effectiveCategoryId : undefined,
      splits: kind === "expense" && splitMode ? splitPayload : undefined,
      idempotencyKey: `web:${crypto.randomUUID()}`,
    });
  }

  function requestReversal(transaction: LedgerTransaction) {
    const reason = window.prompt(
      `Reverse ${transaction.payee} for ${money(transaction.amountPaise)}? Add a short audit reason:`,
      "Incorrect or duplicate transaction",
    );
    if (reason?.trim() && reason.trim().length >= 3) {
      reverseEntry.mutate({ id: transaction.id, reason: reason.trim() });
    }
  }

  return (
    <section className="ledger-layout">
      <article className="panel entry-panel">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">{correctingId ? "AUDITED CORRECTION" : "POST TO ENCRYPTED LEDGER"}</p>
            <h2>{correctingId ? "Correct transaction" : "Add transaction"}</h2>
          </div>
          <span className="live-pill">{splitMode ? `${money(splitTotalPaise)} SPLIT` : "BALANCED"}</span>
        </div>
        {correctingId && (
          <div className="correction-note">
            The original entry will be reversed. This form creates a linked replacement and preserves the audit trail.
          </div>
        )}
        <form className="entry-form" onSubmit={submit}>
          <label>
            <span>Type</span>
            <select
              value={kind}
              onChange={(event) => {
                const nextKind = event.target.value as TransactionKind;
                setKind(nextKind);
                if (nextKind !== "expense") {
                  setSplitMode(false);
                  setSplits([]);
                }
              }}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Own-account transfer</option>
              <option value="debt_payment">Debt principal payment</option>
            </select>
          </label>
          <label>
            <span>Date</span>
            <input required type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="span-two">
            <span>Payee or source</span>
            <input
              required
              maxLength={160}
              placeholder="Merchant, salary, bank, or person"
              value={payee}
              onChange={(event) => setPayee(event.target.value)}
            />
          </label>
          {!splitMode && (
            <label>
              <span>Amount in INR</span>
              <input
                required
                inputMode="decimal"
                min="0.01"
                placeholder="0.00"
                step="0.01"
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          )}
          <label className={splitMode ? "span-two" : ""}>
            <span>{kind === "income" ? "Receive into" : kind === "expense" ? "Paid with" : "From account"}</span>
            <select required value={effectiveAccountId} onChange={(event) => setAccountId(event.target.value)}>
              {sourceAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} {account.accountClass === "liability" ? "(credit)" : ""}
                </option>
              ))}
            </select>
          </label>
          {(kind === "transfer" || kind === "debt_payment") && (
            <label className="span-two">
              <span>{kind === "transfer" ? "Move into" : "Liability to reduce"}</span>
              <select
                required
                value={effectiveDestinationId}
                onChange={(event) => setDestinationAccountId(event.target.value)}
              >
                {destinationAccounts
                  .filter((account) => account.id !== effectiveAccountId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {kind === "expense" && !splitMode && (
            <>
              <label>
                <span>Category</span>
                <select required value={effectiveCategoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="split-toggle" onClick={startSplit} type="button">
                Split categories
              </button>
            </>
          )}
          {kind === "expense" && splitMode && (
            <div className="split-editor span-two">
              <div className="split-editor-head">
                <span>CATEGORY SPLITS</span>
                <button
                  onClick={() => setSplits((current) => [...current, newSplit(effectiveCategoryId)])}
                  type="button"
                >
                  + Add line
                </button>
              </div>
              {splits.map((split, index) => (
                <div className="split-row" key={split.id}>
                  <select
                    aria-label={`Split ${index + 1} category`}
                    value={split.categoryId}
                    onChange={(event) =>
                      setSplits((current) =>
                        current.map((item) =>
                          item.id === split.id ? { ...item, categoryId: event.target.value } : item,
                        ),
                      )
                    }
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Split ${index + 1} amount`}
                    inputMode="decimal"
                    min="0.01"
                    placeholder="0.00"
                    step="0.01"
                    type="number"
                    value={split.amount}
                    onChange={(event) =>
                      setSplits((current) =>
                        current.map((item) => (item.id === split.id ? { ...item, amount: event.target.value } : item)),
                      )
                    }
                  />
                  <button
                    aria-label={`Remove split ${index + 1}`}
                    disabled={splits.length <= 2}
                    onClick={() => setSplits((current) => current.filter((item) => item.id !== split.id))}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="split-cancel"
                onClick={() => {
                  setSplitMode(false);
                  setSplits([]);
                }}
                type="button"
              >
                Use one category
              </button>
            </div>
          )}
          <label className="span-two">
            <span>Note</span>
            <input
              maxLength={500}
              placeholder="Optional context"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
            />
          </label>
          {(saveTransaction.error || reverseEntry.error) && (
            <p className="form-error">{(saveTransaction.error ?? reverseEntry.error)?.message}</p>
          )}
          <div className="form-actions span-two">
            {correctingId && (
              <button className="cancel-button" onClick={resetForm} type="button">
                Cancel correction
              </button>
            )}
            <button className="post-button" disabled={saveTransaction.isPending || loading} type="submit">
              {saveTransaction.isPending
                ? "Posting..."
                : correctingId
                  ? "Reverse and post correction"
                  : "Post balanced transaction"}
            </button>
          </div>
        </form>
      </article>

      <article className="panel ledger-panel">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">UNIFIED LEDGER / {month}</p>
            <h2>{filteredTransactions.length} visible transactions</h2>
          </div>
          <span className="source-time">Expenses {money(filteredTotalPaise)}</span>
        </div>
        <div className="ledger-filters">
          <label className="search-filter">
            <span>Search</span>
            <input
              placeholder="Payee, note, category, account"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            <span>Type</span>
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
              <option value="all">All types</option>
              <option value="expense">Expenses</option>
              <option value="income">Income</option>
              <option value="transfer">Transfers</option>
              <option value="debt_payment">Debt payments</option>
            </select>
          </label>
          <label>
            <span>Category</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Account</span>
            <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value="all">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="posted">Posted</option>
              <option value="reversed">Reversed</option>
              <option value="all">All statuses</option>
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee</th>
                <th>Type / category</th>
                <th>Account flow</th>
                <th>Source</th>
                <th>Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((transaction) => (
                <tr className={transaction.status === "reversed" ? "reversed-row" : ""} key={transaction.id}>
                  <td>{transaction.occurredOn}</td>
                  <td>
                    <strong>{transaction.payee}</strong>
                    {transaction.memo && <small>{transaction.memo}</small>}
                  </td>
                  <td>
                    <span className={`kind-pill ${transaction.kind}`}>{transaction.kind.replaceAll("_", " ")}</span>
                    <small>
                      {transaction.splits.length > 1
                        ? `${transaction.splits.length}-way split`
                        : (transaction.categoryName ??
                          (transaction.kind === "income"
                            ? "Income"
                            : (transaction.destinationAccountName ?? "Transfer")))}
                    </small>
                  </td>
                  <td>
                    {transaction.accountName}
                    {transaction.destinationAccountName && <small>to {transaction.destinationAccountName}</small>}
                  </td>
                  <td>
                    <span className={`origin-pill ${transaction.origin}`}>
                      {transaction.origin.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className={transaction.kind}>
                    {transaction.kind === "income" ? "+" : transaction.kind === "transfer" ? "" : "-"}
                    {money(transaction.amountPaise)}
                  </td>
                  <td>
                    <div className="ledger-actions">
                      {transaction.status === "posted" && (
                        <>
                          <button onClick={() => fillFromTransaction(transaction, false)} type="button">
                            Duplicate
                          </button>
                          <button onClick={() => fillFromTransaction(transaction, true)} type="button">
                            Correct
                          </button>
                          <button
                            className="danger-action"
                            disabled={reverseEntry.isPending}
                            onClick={() => requestReversal(transaction)}
                            type="button"
                          >
                            Reverse
                          </button>
                        </>
                      )}
                      {transaction.status === "reversed" && <span className="reversed-label">REVERSED</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredTransactions.length === 0 && (
                <tr>
                  <td className="empty-ledger" colSpan={7}>
                    No transactions match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
