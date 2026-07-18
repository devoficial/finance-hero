import type { LedgerResponse, ReferenceDataResponse } from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { createManualTransaction } from "../lib/api";

interface LedgerViewProps {
  month: string;
  ledger?: LedgerResponse;
  referenceData?: ReferenceDataResponse;
  loading: boolean;
  money: (paise: number) => string;
}

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

export function LedgerView({ month, ledger, referenceData, loading, money }: LedgerViewProps) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => defaultDateForMonth(month));
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [memo, setMemo] = useState("");

  const createTransaction = useMutation({
    mutationFn: createManualTransaction,
    onSuccess: async () => {
      setPayee("");
      setAmount("");
      setMemo("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", month] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", month] }),
        queryClient.invalidateQueries({ queryKey: ["expenses", "year", month.slice(0, 4)] }),
      ]);
    },
  });

  const accounts = referenceData?.accounts ?? [];
  const categories = referenceData?.categories ?? [];
  const effectiveAccountId = accountId || accounts[0]?.id || "";
  const effectiveCategoryId = categoryId || categories[0]?.id || "";

  useEffect(() => {
    setDate(defaultDateForMonth(month));
  }, [month]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountPaise = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || !effectiveAccountId) {
      return;
    }

    createTransaction.mutate({
      occurredOn: date,
      payee,
      memo: memo || undefined,
      kind,
      amountPaise,
      assetAccountId: effectiveAccountId,
      categoryId: kind === "expense" ? effectiveCategoryId : undefined,
      idempotencyKey: `web:${crypto.randomUUID()}`,
    });
  }

  return (
    <section className="ledger-layout">
      <article className="panel entry-panel">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">POST TO ENCRYPTED LEDGER</p>
            <h2>Add transaction</h2>
          </div>
          <span className="live-pill">BALANCED</span>
        </div>
        <form className="entry-form" onSubmit={submit}>
          <label>
            <span>Type</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as "expense" | "income")}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
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
              placeholder="Merchant, salary, or person"
              value={payee}
              onChange={(event) => setPayee(event.target.value)}
            />
          </label>
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
          <label>
            <span>Account</span>
            <select required value={effectiveAccountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          {kind === "expense" && (
            <label className="span-two">
              <span>Category</span>
              <select required value={effectiveCategoryId} onChange={(event) => setCategoryId(event.target.value)}>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
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
          {createTransaction.error && <p className="form-error">{createTransaction.error.message}</p>}
          <button className="post-button span-two" disabled={createTransaction.isPending || loading} type="submit">
            {createTransaction.isPending ? "Posting..." : "Post balanced transaction"}
          </button>
        </form>
      </article>

      <article className="panel ledger-panel">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">UNIFIED LEDGER / {month}</p>
            <h2>{ledger?.transactions.length ?? 0} transactions</h2>
          </div>
          <span className="source-time">Database live</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee</th>
                <th>Category</th>
                <th>Account</th>
                <th>Source</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {ledger?.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{transaction.occurredOn}</td>
                  <td>
                    <strong>{transaction.payee}</strong>
                    {transaction.memo && <small>{transaction.memo}</small>}
                  </td>
                  <td>{transaction.categoryName ?? "Income"}</td>
                  <td>{transaction.accountName}</td>
                  <td>
                    <span className={`origin-pill ${transaction.origin}`}>
                      {transaction.origin.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className={transaction.kind}>
                    {transaction.kind === "income" ? "+" : "-"}
                    {money(transaction.amountPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
