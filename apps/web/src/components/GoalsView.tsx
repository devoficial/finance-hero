import type {
  CreateFinancialGoalRequest,
  CreateWealthAssetRequest,
  FinancialGoal,
  UpdateFinancialGoalRequest,
  UpdateWealthAssetRequest,
  WealthAsset,
  WealthResponse,
} from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import {
  createFinancialGoal,
  createWealthAsset,
  updateFinancialGoal,
  updateGoalAllocations,
  updateWealthAsset,
} from "../lib/api";

interface GoalsViewProps {
  data?: WealthResponse;
  loading: boolean;
  money: (paise: number) => string;
}

interface AssetForm {
  id: string | null;
  name: string;
  assetType: WealthAsset["assetType"];
  institution: string;
  currentValue: string;
  monthlyContribution: string;
  restricted: boolean;
  asOfDate: string;
}

interface GoalForm {
  id: string | null;
  name: string;
  target: string;
  targetDate: string;
  priority: string;
  status: FinancialGoal["status"];
  monthlyContribution: string;
  notes: string;
}

function rupeesToPaise(value: string, positive = false): number | null {
  const paise = Math.round(Number(value) * 100);
  return Number.isSafeInteger(paise) && (positive ? paise > 0 : paise >= 0) ? paise : null;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

function assetTypeName(type: WealthAsset["assetType"]) {
  const labels: Record<WealthAsset["assetType"], string> = {
    savings: "Savings",
    investment: "Investment",
    emergency_fund: "Emergency fund",
    restricted_wallet: "Restricted wallet",
  };
  return labels[type];
}

function dateLabel(value: string | null) {
  if (!value) {
    return "No date set";
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function assetFormFrom(asset: WealthAsset): AssetForm {
  return {
    id: asset.id,
    name: asset.name,
    assetType: asset.assetType,
    institution: asset.institution ?? "",
    currentValue: String(asset.currentValuePaise / 100),
    monthlyContribution: String(asset.monthlyContributionPaise / 100),
    restricted: asset.restricted,
    asOfDate: asset.asOfDate,
  };
}

function goalFormFrom(goal: FinancialGoal): GoalForm {
  return {
    id: goal.id,
    name: goal.name,
    target: String(goal.targetPaise / 100),
    targetDate: goal.targetDate ?? "",
    priority: String(goal.priority),
    status: goal.status,
    monthlyContribution: String(goal.monthlyContributionPaise / 100),
    notes: goal.notes ?? "",
  };
}

export function GoalsView({ data, loading, money }: GoalsViewProps) {
  const queryClient = useQueryClient();
  const [assetForm, setAssetForm] = useState<AssetForm | null>(null);
  const [goalForm, setGoalForm] = useState<GoalForm | null>(null);
  const [allocationGoal, setAllocationGoal] = useState<FinancialGoal | null>(null);
  const [allocationValues, setAllocationValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const refreshWealth = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["wealth"] }),
      queryClient.invalidateQueries({ queryKey: ["reference-data"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };

  const assetMutation = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: CreateWealthAssetRequest }) =>
      id ? updateWealthAsset(id, input as UpdateWealthAssetRequest) : createWealthAsset(input),
    onSuccess: async () => {
      setAssetForm(null);
      setFormError(null);
      await refreshWealth();
    },
  });
  const goalMutation = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: CreateFinancialGoalRequest }) =>
      id ? updateFinancialGoal(id, input as UpdateFinancialGoalRequest) : createFinancialGoal(input),
    onSuccess: async () => {
      setGoalForm(null);
      setFormError(null);
      await refreshWealth();
    },
  });
  const allocationMutation = useMutation({
    mutationFn: ({ id, allocations }: { id: string; allocations: Array<{ assetId: string; amountPaise: number }> }) =>
      updateGoalAllocations(id, { allocations }),
    onSuccess: async () => {
      setAllocationGoal(null);
      setAllocationValues({});
      setFormError(null);
      await refreshWealth();
    },
  });

  const assetMix = useMemo(() => {
    if (!data || data.totalAssetPaise <= 0) {
      return { savingsAngle: 0, investmentAngle: 0 };
    }
    return {
      savingsAngle: (data.savingsPaise / data.totalAssetPaise) * 360,
      investmentAngle: (data.investmentPaise / data.totalAssetPaise) * 360,
    };
  }, [data]);

  if (loading || !data) {
    return <section className="panel loading-panel">Valuing savings and calculating goal forecasts...</section>;
  }

  const unrestrictedAssets = data.assets.filter((asset) => !asset.restricted);
  const activeGoals = data.goals.filter((goal) => goal.status === "active");
  const fundedPercentage =
    data.goals.reduce((sum, goal) => sum + goal.targetPaise, 0) > 0
      ? Math.round(
          (data.goals.reduce((sum, goal) => sum + goal.allocatedPaise, 0) /
            data.goals.reduce((sum, goal) => sum + goal.targetPaise, 0)) *
            100,
        )
      : 0;
  const mixStyle = {
    background: `conic-gradient(var(--green-bright) 0 ${assetMix.savingsAngle}deg, #2f6f8f ${assetMix.savingsAngle}deg ${assetMix.savingsAngle + assetMix.investmentAngle}deg, var(--yellow) ${assetMix.savingsAngle + assetMix.investmentAngle}deg 360deg)`,
  };

  function startAsset(asset?: WealthAsset) {
    setGoalForm(null);
    setAllocationGoal(null);
    setFormError(null);
    setAssetForm(
      asset
        ? assetFormFrom(asset)
        : {
            id: null,
            name: "",
            assetType: "savings",
            institution: "",
            currentValue: "",
            monthlyContribution: "0",
            restricted: false,
            asOfDate: today(),
          },
    );
  }

  function submitAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assetForm) {
      return;
    }
    const currentValuePaise = rupeesToPaise(assetForm.currentValue);
    const monthlyContributionPaise = rupeesToPaise(assetForm.monthlyContribution);
    if (!assetForm.name.trim() || currentValuePaise == null || monthlyContributionPaise == null) {
      setFormError("Enter a name and valid non-negative INR values.");
      return;
    }
    const input: CreateWealthAssetRequest = {
      name: assetForm.name,
      assetType: assetForm.assetType,
      institution: assetForm.id ? assetForm.institution || null : assetForm.institution || undefined,
      currentValuePaise,
      monthlyContributionPaise,
      restricted: assetForm.assetType === "restricted_wallet" ? true : assetForm.restricted,
      asOfDate: assetForm.asOfDate,
    };
    setFormError(null);
    assetMutation.mutate({ id: assetForm.id, input });
  }

  function startGoal(goal?: FinancialGoal) {
    setAssetForm(null);
    setAllocationGoal(null);
    setFormError(null);
    setGoalForm(
      goal
        ? goalFormFrom(goal)
        : {
            id: null,
            name: "",
            target: "",
            targetDate: "",
            priority: "3",
            status: "active",
            monthlyContribution: "0",
            notes: "",
          },
    );
  }

  function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!goalForm) {
      return;
    }
    const targetPaise = rupeesToPaise(goalForm.target, true);
    const monthlyContributionPaise = rupeesToPaise(goalForm.monthlyContribution);
    const priority = Number(goalForm.priority);
    if (
      !goalForm.name.trim() ||
      targetPaise == null ||
      monthlyContributionPaise == null ||
      !Number.isInteger(priority) ||
      priority < 1 ||
      priority > 5
    ) {
      setFormError("Enter a goal name, positive target, monthly contribution, and priority from 1 to 5.");
      return;
    }
    const input: CreateFinancialGoalRequest = {
      name: goalForm.name,
      targetPaise,
      targetDate: goalForm.targetDate || null,
      priority,
      status: goalForm.status,
      monthlyContributionPaise,
      notes: goalForm.id ? goalForm.notes || null : goalForm.notes || undefined,
    };
    setFormError(null);
    goalMutation.mutate({ id: goalForm.id, input });
  }

  function startAllocating(goal: FinancialGoal) {
    setAssetForm(null);
    setGoalForm(null);
    setFormError(null);
    setAllocationGoal(goal);
    setAllocationValues(
      Object.fromEntries(
        unrestrictedAssets.map((asset) => [
          asset.id,
          String((goal.allocations.find((allocation) => allocation.assetId === asset.id)?.amountPaise ?? 0) / 100),
        ]),
      ),
    );
  }

  function submitAllocations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allocationGoal) {
      return;
    }
    const allocations = unrestrictedAssets.map((asset) => ({
      assetId: asset.id,
      amountPaise: rupeesToPaise(allocationValues[asset.id] ?? ""),
    }));
    if (allocations.some((allocation) => allocation.amountPaise == null)) {
      setFormError("Enter valid non-negative allocation amounts.");
      return;
    }
    setFormError(null);
    allocationMutation.mutate({
      id: allocationGoal.id,
      allocations: allocations.map((allocation) => ({
        assetId: allocation.assetId,
        amountPaise: allocation.amountPaise ?? 0,
      })),
    });
  }

  return (
    <div className="wealth-workspace">
      <section className="wealth-hero">
        <div>
          <p className="eyebrow">SAVINGS / INVESTMENTS / GOAL CAPITAL</p>
          <h2>Build assets with a job to do.</h2>
          <p>
            Valuations are editable snapshots. Ledger transfers after the valuation date update the position
            automatically, while goal allocations only earmark money and never duplicate it.
          </p>
        </div>
        <div className="wealth-hero-actions">
          <button onClick={() => startAsset()} type="button">
            + Add asset
          </button>
          <button onClick={() => startGoal()} type="button">
            + Add goal
          </button>
        </div>
      </section>

      <section className="wealth-kpis" aria-label="Wealth summary">
        <article>
          <span>Total tracked assets</span>
          <strong>{money(data.totalAssetPaise)}</strong>
          <small>{data.assets.length} valued positions</small>
        </article>
        <article>
          <span>Allocated to goals</span>
          <strong>{money(data.allocatedPaise)}</strong>
          <small>{fundedPercentage}% of combined targets funded</small>
        </article>
        <article>
          <span>Available to allocate</span>
          <strong>{money(data.allocatablePaise)}</strong>
          <small>Excludes restricted wallets</small>
        </article>
        <article className={data.netWorthPaise < 0 ? "negative" : "positive"}>
          <span>Tracked net worth</span>
          <strong>{money(data.netWorthPaise)}</strong>
          <small>Assets + receivables - obligations</small>
        </article>
      </section>

      {(assetForm || goalForm || allocationGoal) && (
        <section className="panel wealth-editor">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">ENCRYPTED LOCAL UPDATE</p>
              <h2>
                {assetForm
                  ? `${assetForm.id ? "Edit" : "Add"} asset position`
                  : goalForm
                    ? `${goalForm.id ? "Edit" : "Add"} financial goal`
                    : `Allocate savings to ${allocationGoal?.name}`}
              </h2>
            </div>
            <button
              className="editor-close-button"
              onClick={() => {
                setAssetForm(null);
                setGoalForm(null);
                setAllocationGoal(null);
                setFormError(null);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>

          {assetForm && (
            <form className="wealth-form" onSubmit={submitAsset}>
              <label>
                <span>Asset name</span>
                <input
                  maxLength={160}
                  required
                  value={assetForm.name}
                  onChange={(event) => setAssetForm({ ...assetForm, name: event.target.value })}
                />
              </label>
              <label>
                <span>Type</span>
                <select
                  value={assetForm.assetType}
                  onChange={(event) => {
                    const assetType = event.target.value as WealthAsset["assetType"];
                    setAssetForm({
                      ...assetForm,
                      assetType,
                      restricted: assetType === "restricted_wallet" || assetForm.restricted,
                    });
                  }}
                >
                  <option value="savings">Savings</option>
                  <option value="investment">Investment</option>
                  <option value="emergency_fund">Emergency fund</option>
                  <option value="restricted_wallet">Restricted wallet</option>
                </select>
              </label>
              <label>
                <span>Institution</span>
                <input
                  maxLength={160}
                  placeholder="Optional"
                  value={assetForm.institution}
                  onChange={(event) => setAssetForm({ ...assetForm, institution: event.target.value })}
                />
              </label>
              <label>
                <span>Current value (INR)</span>
                <input
                  min="0"
                  required
                  step="0.01"
                  type="number"
                  value={assetForm.currentValue}
                  onChange={(event) => setAssetForm({ ...assetForm, currentValue: event.target.value })}
                />
              </label>
              <label>
                <span>Monthly contribution (INR)</span>
                <input
                  min="0"
                  required
                  step="0.01"
                  type="number"
                  value={assetForm.monthlyContribution}
                  onChange={(event) => setAssetForm({ ...assetForm, monthlyContribution: event.target.value })}
                />
              </label>
              <label>
                <span>Valuation date</span>
                <input
                  required
                  type="date"
                  value={assetForm.asOfDate}
                  onChange={(event) => setAssetForm({ ...assetForm, asOfDate: event.target.value })}
                />
              </label>
              <label className="wealth-check">
                <input
                  checked={assetForm.assetType === "restricted_wallet" || assetForm.restricted}
                  disabled={assetForm.assetType === "restricted_wallet"}
                  type="checkbox"
                  onChange={(event) => setAssetForm({ ...assetForm, restricted: event.target.checked })}
                />
                <span>Restrict from financial-goal allocation</span>
              </label>
              <button className="wealth-save" disabled={assetMutation.isPending} type="submit">
                {assetMutation.isPending ? "Saving..." : "Save asset"}
              </button>
            </form>
          )}

          {goalForm && (
            <form className="wealth-form goal-form" onSubmit={submitGoal}>
              <label>
                <span>Goal name</span>
                <input
                  maxLength={160}
                  required
                  value={goalForm.name}
                  onChange={(event) => setGoalForm({ ...goalForm, name: event.target.value })}
                />
              </label>
              <label>
                <span>Target amount (INR)</span>
                <input
                  min="0.01"
                  required
                  step="0.01"
                  type="number"
                  value={goalForm.target}
                  onChange={(event) => setGoalForm({ ...goalForm, target: event.target.value })}
                />
              </label>
              <label>
                <span>Target date</span>
                <input
                  type="date"
                  value={goalForm.targetDate}
                  onChange={(event) => setGoalForm({ ...goalForm, targetDate: event.target.value })}
                />
              </label>
              <label>
                <span>Monthly contribution (INR)</span>
                <input
                  min="0"
                  required
                  step="0.01"
                  type="number"
                  value={goalForm.monthlyContribution}
                  onChange={(event) => setGoalForm({ ...goalForm, monthlyContribution: event.target.value })}
                />
              </label>
              <label>
                <span>Priority</span>
                <select
                  value={goalForm.priority}
                  onChange={(event) => setGoalForm({ ...goalForm, priority: event.target.value })}
                >
                  <option value="1">1 - Essential</option>
                  <option value="2">2 - High</option>
                  <option value="3">3 - Planned</option>
                  <option value="4">4 - Flexible</option>
                  <option value="5">5 - Later</option>
                </select>
              </label>
              <label>
                <span>Status</span>
                <select
                  value={goalForm.status}
                  onChange={(event) =>
                    setGoalForm({ ...goalForm, status: event.target.value as FinancialGoal["status"] })
                  }
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="achieved">Achieved</option>
                </select>
              </label>
              <label className="wealth-notes">
                <span>Notes</span>
                <input
                  maxLength={500}
                  placeholder="Optional context or assumptions"
                  value={goalForm.notes}
                  onChange={(event) => setGoalForm({ ...goalForm, notes: event.target.value })}
                />
              </label>
              <button className="wealth-save" disabled={goalMutation.isPending} type="submit">
                {goalMutation.isPending ? "Saving..." : "Save goal"}
              </button>
            </form>
          )}

          {allocationGoal && (
            <form className="allocation-form" onSubmit={submitAllocations}>
              <div className="allocation-form-context">
                <span>Goal target</span>
                <strong>{money(allocationGoal.targetPaise)}</strong>
                <small>Allocations earmark existing balances; they do not move or spend money.</small>
              </div>
              <div className="allocation-fields">
                {unrestrictedAssets.map((asset) => {
                  const currentGoalAmount =
                    allocationGoal.allocations.find((allocation) => allocation.assetId === asset.id)?.amountPaise ?? 0;
                  const availableForGoal = asset.availablePaise + currentGoalAmount;
                  return (
                    <label key={asset.id}>
                      <span>
                        <b>{asset.name}</b>
                        <small>{money(availableForGoal)} available for this goal</small>
                      </span>
                      <input
                        aria-label={`${asset.name} allocation in INR`}
                        max={availableForGoal / 100}
                        min="0"
                        step="0.01"
                        type="number"
                        value={allocationValues[asset.id] ?? ""}
                        onChange={(event) =>
                          setAllocationValues((current) => ({ ...current, [asset.id]: event.target.value }))
                        }
                      />
                    </label>
                  );
                })}
              </div>
              <button className="wealth-save" disabled={allocationMutation.isPending} type="submit">
                {allocationMutation.isPending ? "Allocating..." : "Save allocations"}
              </button>
            </form>
          )}
          {(formError || assetMutation.error || goalMutation.error || allocationMutation.error) && (
            <p className="form-error wealth-error">
              {formError ??
                assetMutation.error?.message ??
                goalMutation.error?.message ??
                allocationMutation.error?.message}
            </p>
          )}
        </section>
      )}

      <section className="wealth-main-grid">
        <article className="panel wealth-mix-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">CURRENT ASSET MIX</p>
              <h2>{money(data.totalAssetPaise)}</h2>
            </div>
            <span className="live-pill">INR ONLY</span>
          </div>
          <div className="wealth-mix">
            <div className="wealth-donut" style={mixStyle}>
              <span>
                <strong>{data.assets.length}</strong>
                positions
              </span>
            </div>
            <div className="wealth-mix-legend">
              <div>
                <i className="savings" />
                <span>Savings</span>
                <strong>{money(data.savingsPaise)}</strong>
              </div>
              <div>
                <i className="investments" />
                <span>Investments</span>
                <strong>{money(data.investmentPaise)}</strong>
              </div>
              <div>
                <i className="restricted" />
                <span>Restricted wallet</span>
                <strong>{money(data.restrictedWalletPaise)}</strong>
              </div>
            </div>
          </div>
          <div className="wealth-debt-contrast">
            <span>Asset-to-obligation coverage</span>
            <strong>{data.debtPaise > 0 ? Math.round((data.totalAssetPaise / data.debtPaise) * 100) : 100}%</strong>
            <small>{money(data.debtPaise)} total tracked obligations</small>
          </div>
        </article>

        <article className="panel wealth-assets-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">VALUATION REGISTER</p>
              <h2>Savings and investments</h2>
            </div>
            <button className="wealth-text-action" onClick={() => startAsset()} type="button">
              Add asset
            </button>
          </div>
          <div className="wealth-asset-list">
            {data.assets.map((asset) => (
              <div className={asset.restricted ? "restricted" : ""} key={asset.id}>
                <span className="asset-kind">{assetTypeName(asset.assetType)}</span>
                <div>
                  <strong>{asset.name}</strong>
                  <small>
                    {asset.institution || "Manual valuation"} · as of {dateLabel(asset.asOfDate)}
                  </small>
                </div>
                <b>{money(asset.currentValuePaise)}</b>
                <div className="asset-allocation">
                  <span>{asset.restricted ? "Not allocatable" : `${money(asset.allocatedPaise)} allocated`}</span>
                  <small>
                    {asset.monthlyContributionPaise > 0
                      ? `${money(asset.monthlyContributionPaise)} / month`
                      : "No monthly plan"}
                  </small>
                </div>
                <button onClick={() => startAsset(asset)} type="button">
                  Edit
                </button>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel goals-register">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">FINANCIAL GOALS / EXPLAINABLE FORECASTS</p>
            <h2>Targets and completion outlook</h2>
          </div>
          <div className="goals-heading">
            <span>{activeGoals.length} ACTIVE</span>
            <button onClick={() => startGoal()} type="button">
              + Add goal
            </button>
          </div>
        </div>
        <div className="goal-card-grid">
          {data.goals.map((goal) => (
            <article className={`${goal.status} ${goal.onTrack === false ? "off-track" : ""}`} key={goal.id}>
              <header>
                <span>PRIORITY {goal.priority}</span>
                <b>{goal.status}</b>
              </header>
              <h3>{goal.name}</h3>
              <div className="goal-amounts">
                <strong>{money(goal.allocatedPaise)}</strong>
                <span>of {money(goal.targetPaise)}</span>
              </div>
              <div className="goal-progress">
                <i style={{ width: `${goal.progressPercentage}%` }} />
              </div>
              <div className="goal-facts">
                <span>
                  <small>Funded</small>
                  <b>{goal.progressPercentage}%</b>
                </span>
                <span>
                  <small>Monthly plan</small>
                  <b>{money(goal.monthlyContributionPaise)}</b>
                </span>
                <span>
                  <small>Forecast</small>
                  <b>{goal.forecastDate ? dateLabel(goal.forecastDate) : "Contribution needed"}</b>
                </span>
              </div>
              {goal.targetDate && (
                <p className={goal.onTrack === false ? "late" : ""}>
                  Target {dateLabel(goal.targetDate)} ·{" "}
                  {goal.onTrack == null ? "add contribution for forecast" : goal.onTrack ? "on track" : "behind plan"}
                </p>
              )}
              {goal.allocations.length > 0 && (
                <div className="goal-allocation-tags">
                  {goal.allocations.map((allocation) => (
                    <span key={allocation.assetId}>
                      {allocation.assetName}: {money(allocation.amountPaise)}
                    </span>
                  ))}
                </div>
              )}
              <footer>
                <button onClick={() => startAllocating(goal)} type="button">
                  Allocate savings
                </button>
                <button onClick={() => startGoal(goal)} type="button">
                  Edit goal
                </button>
              </footer>
            </article>
          ))}
          {data.goals.length === 0 && (
            <div className="goals-empty">
              <strong>No financial goals yet.</strong>
              <span>Add a target to calculate the required monthly contribution and completion date.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
