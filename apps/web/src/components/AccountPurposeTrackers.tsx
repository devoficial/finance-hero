import type { FinancialAccount, ProjectSummaryResponse, WealthResponse } from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { createManualTransaction, createProjectExpense, updateGoalAllocations } from "../lib/api";

interface AccountPurposeTrackersProps {
  accounts: FinancialAccount[];
  wealth?: WealthResponse;
  project?: ProjectSummaryResponse;
  money: (paise: number) => string;
  onOpenGoals: () => void;
  onOpenProjects: () => void;
}

type TrackerAction = "icici-fund" | "jupiter-fund" | "jupiter-spend" | null;

function localDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

function rupeesToPaise(value: string): number | null {
  const paise = Math.round(Number(value) * 100);
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

export function AccountPurposeTrackers({
  accounts,
  wealth,
  project,
  money,
  onOpenGoals,
  onOpenProjects,
}: AccountPurposeTrackersProps) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<TrackerAction>(null);
  const [date, setDate] = useState(localDate);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [goalId, setGoalId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const icici = accounts.find((account) => account.id === "account-icici-expense-reserve");
  const jupiter = accounts.find((account) => account.id === "account-savings");
  const primary = accounts.find((account) => account.id === "account-primary-bank");
  const iciciAsset = wealth?.assets.find((asset) => asset.accountId === icici?.id);
  const activeGoals = wealth?.goals.filter((goal) => goal.status === "active") ?? [];
  const effectiveGoalId = activeGoals.some((goal) => goal.id === goalId)
    ? goalId
    : (activeGoals.find((goal) => goal.targetMode === "emergency_cover")?.id ?? activeGoals[0]?.id ?? "");
  const iciciAllocated = activeGoals.reduce(
    (sum, goal) =>
      sum + (goal.allocations.find((allocation) => allocation.assetId === iciciAsset?.id)?.amountPaise ?? 0),
    0,
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["wealth"] }),
      queryClient.invalidateQueries({ queryKey: ["projects", "home-construction"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["expenses"] }),
      queryClient.invalidateQueries({ queryKey: ["budget"] }),
    ]);
  };

  const trackerMutation = useMutation({
    mutationFn: async () => {
      const amountPaise = rupeesToPaise(amount);
      if (!amountPaise || !primary || !icici || !jupiter) {
        throw new Error("Enter a positive amount and keep the linked accounts active.");
      }
      if (action === "jupiter-spend") {
        if (!description.trim()) throw new Error("Describe the construction payment.");
        return createProjectExpense({
          occurredOn: date,
          description: description.trim(),
          amountPaise,
          accountId: jupiter.id,
          idempotencyKey: `account-tracker-project:${crypto.randomUUID()}`,
        });
      }

      const destination = action === "icici-fund" ? icici : jupiter;
      const transfer = await createManualTransaction({
        occurredOn: date,
        payee: action === "icici-fund" ? "Fund ICICI expense reserve" : "Fund Jupiter construction account",
        memo: "Owned-account transfer from purpose tracker",
        kind: "transfer",
        amountPaise,
        accountId: primary.id,
        destinationAccountId: destination.id,
        idempotencyKey: `account-tracker-transfer:${crypto.randomUUID()}`,
      });

      if (action === "icici-fund" && effectiveGoalId && iciciAsset) {
        const goal = activeGoals.find((item) => item.id === effectiveGoalId);
        if (goal) {
          const current = goal.allocations.find((allocation) => allocation.assetId === iciciAsset.id)?.amountPaise ?? 0;
          const next = Math.min(goal.targetPaise, current + amountPaise);
          await updateGoalAllocations(goal.id, {
            allocations: [
              ...goal.allocations
                .filter((allocation) => allocation.assetId !== iciciAsset.id)
                .map((allocation) => ({ assetId: allocation.assetId, amountPaise: allocation.amountPaise })),
              { assetId: iciciAsset.id, amountPaise: next },
            ],
          });
        }
      }
      return transfer;
    },
    onSuccess: async () => {
      setAction(null);
      setAmount("");
      setDescription("");
      setError(null);
      await refresh();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : "The tracker entry could not be saved.");
    },
  });

  function begin(nextAction: Exclude<TrackerAction, null>) {
    setAction(nextAction);
    setDate(localDate());
    setAmount(nextAction === "icici-fund" ? "20000" : "");
    setDescription("");
    setError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    trackerMutation.mutate();
  }

  if (!icici || !jupiter) return null;

  return (
    <section className="purpose-trackers" aria-label="Purpose account trackers">
      <article className="purpose-tracker icici">
        <div className="purpose-tracker-heading">
          <div>
            <span>ICICI / SAFETY RESERVE</span>
            <h3>Savings and emergency fund</h3>
          </div>
          <strong>{money(icici.balancePaise)}</strong>
        </div>
        <div className="purpose-tracker-facts">
          <p>
            <span>Monthly reserve plan</span>
            <b>{money(2000000)}</b>
          </p>
          <p>
            <span>Allocated to goals</span>
            <b>{money(iciciAllocated)}</b>
          </p>
          <p>
            <span>Unallocated reserve</span>
            <b>{money(Math.max(0, icici.balancePaise - iciciAllocated))}</b>
          </p>
        </div>
        <div className="purpose-tracker-actions">
          <button className="add-button" onClick={() => begin("icici-fund")} type="button">
            + Add reserve
          </button>
          <button className="table-action" onClick={onOpenGoals} type="button">
            Open goals
          </button>
        </div>
      </article>

      <article className="purpose-tracker jupiter">
        <div className="purpose-tracker-heading">
          <div>
            <span>JUPITER / HOME BUILD</span>
            <h3>Construction fund</h3>
          </div>
          <strong>{money(jupiter.balancePaise)}</strong>
        </div>
        <div className="purpose-tracker-facts">
          <p>
            <span>Project spent</span>
            <b>{money(project?.actualExpensePaise ?? 0)}</b>
          </p>
          <p>
            <span>Vendor commitments</span>
            <b>{money(project?.pendingCommitmentPaise ?? 0)}</b>
          </p>
          <p>
            <span>Available in Jupiter</span>
            <b>{money(project?.fundBalancePaise ?? jupiter.balancePaise)}</b>
          </p>
        </div>
        <div className="purpose-tracker-actions">
          <button className="add-button" onClick={() => begin("jupiter-fund")} type="button">
            + Add funds
          </button>
          <button className="table-action" onClick={() => begin("jupiter-spend")} type="button">
            Record spend
          </button>
          <button className="table-action" onClick={onOpenProjects} type="button">
            Open project
          </button>
        </div>
      </article>

      {action && (
        <div className="modal-backdrop" role="presentation">
          <section aria-modal="true" className="wealth-modal purpose-tracker-modal" role="dialog">
            <div className="modal-title">
              <div>
                <p className="eyebrow">PURPOSE TRACKER</p>
                <h2>
                  {action === "icici-fund"
                    ? "Fund ICICI reserve"
                    : action === "jupiter-fund"
                      ? "Fund Jupiter"
                      : "Record construction spend"}
                </h2>
              </div>
            </div>
            <form onSubmit={submit}>
              <label>
                Date
                <input onChange={(event) => setDate(event.target.value)} required type="date" value={date} />
              </label>
              {action === "jupiter-spend" && (
                <label>
                  Description
                  <input
                    maxLength={240}
                    onChange={(event) => setDescription(event.target.value)}
                    required
                    value={description}
                  />
                </label>
              )}
              <label>
                Amount (INR)
                <input
                  min="0.01"
                  onChange={(event) => setAmount(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={amount}
                />
              </label>
              {action === "icici-fund" && activeGoals.length > 0 && (
                <label>
                  Allocate to goal
                  <select onChange={(event) => setGoalId(event.target.value)} value={effectiveGoalId}>
                    {activeGoals.map((goal) => (
                      <option key={goal.id} value={goal.id}>
                        {goal.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="purpose-tracker-note">
                {action === "jupiter-spend"
                  ? "This becomes a Home Construction project expense and reduces Jupiter."
                  : "This is an internal transfer from the Primary salary account, not an expense."}
              </p>
              {error && <p className="form-error">{error}</p>}
              <div className="modal-actions">
                <button onClick={() => setAction(null)} type="button">
                  Cancel
                </button>
                <button className="add-button" disabled={trackerMutation.isPending} type="submit">
                  {trackerMutation.isPending ? "Saving..." : "Save entry"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
