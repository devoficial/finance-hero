import type {
  CreateFinancialGoalRequest,
  CreateWealthAssetRequest,
  DashboardResponse,
  FinancialGoal,
  LiabilitiesResponse,
  UpdateFinancialGoalRequest,
  UpdateWealthAssetRequest,
  WealthAsset,
  WealthResponse,
} from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createFinancialGoal,
  createWealthAsset,
  updateFinancialGoal,
  updateGoalAllocations,
  updateWealthAsset,
} from "../lib/api";

interface GoalsViewProps {
  data?: WealthResponse;
  dashboard?: DashboardResponse;
  liabilities?: LiabilitiesResponse;
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
  targetMode: FinancialGoal["targetMode"];
  coverageMonths: string;
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
    restricted_wallet: "Food wallet",
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
    targetMode: goal.targetMode,
    coverageMonths: String(goal.coverageMonths ?? 3),
    targetDate: goal.targetDate ?? "",
    priority: String(goal.priority),
    status: goal.status,
    monthlyContribution: String(goal.monthlyContributionPaise / 100),
    notes: goal.notes ?? "",
  };
}

function percentage(value: number, total: number) {
  return total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
}

export function GoalsView({ data, dashboard, liabilities, loading, money }: GoalsViewProps) {
  const queryClient = useQueryClient();
  const editorRef = useRef<HTMLElement | null>(null);
  const [assetForm, setAssetForm] = useState<AssetForm | null>(null);
  const [goalForm, setGoalForm] = useState<GoalForm | null>(null);
  const [allocationGoal, setAllocationGoal] = useState<FinancialGoal | null>(null);
  const [allocationValues, setAllocationValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const editorOpen = assetForm !== null || goalForm !== null || allocationGoal !== null;

  useEffect(() => {
    if (!editorOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorOpen]);

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

  if (loading || !data || !dashboard || !liabilities) {
    return <section className="panel loading-panel">Valuing savings and calculating goal forecasts...</section>;
  }

  const unrestrictedAssets = data.assets.filter((asset) => !asset.restricted);
  const activeGoals = data.goals.filter((goal) => goal.status === "active");
  const emergencyMonthlyNeedPaise =
    data.goals.find((goal) => goal.targetMode === "emergency_cover")?.monthlyNeedPaise ?? 0;
  const emergencyGoal = data.goals.find((goal) => goal.targetMode === "emergency_cover");
  const emergencyAllocatedPaise = emergencyGoal?.allocatedPaise ?? 0;
  const starterFundTargetPaise = emergencyMonthlyNeedPaise;
  const starterFundGapPaise = Math.max(0, starterFundTargetPaise - emergencyAllocatedPaise);
  const fullEmergencyGapPaise = Math.max(0, (emergencyGoal?.targetPaise ?? 0) - emergencyAllocatedPaise);
  const currentPlanHeadroomPaise = Math.max(0, dashboard.availableAfterPlanPaise);
  const snowballTarget = liabilities.liabilities.find(
    (liability) => liability.status === "active" && liability.snowballRank === 1,
  );
  const starterAllocationPaise = Math.min(currentPlanHeadroomPaise, starterFundGapPaise);
  const snowballAllocationPaise = Math.min(
    Math.max(0, currentPlanHeadroomPaise - starterAllocationPaise),
    snowballTarget?.currentPrincipalPaise ?? 0,
  );
  const remainingHeadroomPaise = Math.max(
    0,
    currentPlanHeadroomPaise - starterAllocationPaise - snowballAllocationPaise,
  );
  const highestRateDebt = liabilities.liabilities
    .filter((liability) => liability.status === "active" && liability.annualRateBps != null)
    .toSorted((left, right) => (right.annualRateBps ?? 0) - (left.annualRateBps ?? 0))[0];
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
            targetMode: "fixed",
            coverageMonths: "3",
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
    const coverageMonths = Number(goalForm.coverageMonths);
    const targetPaise =
      goalForm.targetMode === "emergency_cover"
        ? Math.max(1, emergencyMonthlyNeedPaise * coverageMonths)
        : rupeesToPaise(goalForm.target, true);
    const monthlyContributionPaise = rupeesToPaise(goalForm.monthlyContribution);
    const priority = Number(goalForm.priority);
    if (
      !goalForm.name.trim() ||
      targetPaise == null ||
      (goalForm.targetMode === "emergency_cover" &&
        (!Number.isInteger(coverageMonths) || coverageMonths < 1 || coverageMonths > 24)) ||
      monthlyContributionPaise == null ||
      !Number.isInteger(priority) ||
      priority < 1 ||
      priority > 5
    ) {
      setFormError(
        "Enter a goal name, valid target or coverage months, monthly contribution, and priority from 1 to 5.",
      );
      return;
    }
    const input: CreateFinancialGoalRequest = {
      name: goalForm.name,
      targetPaise,
      targetMode: goalForm.targetMode,
      coverageMonths: goalForm.targetMode === "emergency_cover" ? coverageMonths : null,
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
          <p className="eyebrow">SAVINGS / INVESTMENTS / SPENDING WALLETS / GOALS</p>
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
          <small>Excludes food-only spending wallets</small>
        </article>
        <article className={data.netWorthPaise < 0 ? "negative" : "positive"}>
          <span>Tracked net worth</span>
          <strong>{money(data.netWorthPaise)}</strong>
          <small>Assets + receivables - obligations</small>
        </article>
      </section>

      <section className="goal-command-grid" aria-label="Financial goal strategy">
        <article className="panel goal-priority-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">RECOMMENDED ORDER / SAFETY BEFORE GROWTH</p>
              <h2>Your next three financial moves</h2>
            </div>
            <span className="goal-plan-pill">SNOWBALL PLAN</span>
          </div>
          <div className="goal-priority-steps">
            <div className={starterFundGapPaise === 0 ? "complete" : "current"}>
              <span>01</span>
              <div>
                <b>Finish one month of safety</b>
                <small>
                  {starterFundGapPaise > 0
                    ? `${money(starterFundGapPaise)} more to cover one month of EMIs and expenses.`
                    : "One full month of EMIs and expenses is protected."}
                </small>
              </div>
              <strong>{percentage(emergencyAllocatedPaise, starterFundTargetPaise)}%</strong>
            </div>
            <div className={starterFundGapPaise === 0 ? "current" : ""}>
              <span>02</span>
              <div>
                <b>Attack the snowball account</b>
                <small>
                  {snowballTarget
                    ? `${snowballTarget.name} · ${money(snowballTarget.currentPrincipalPaise)} outstanding.`
                    : "No active snowball account remains."}
                </small>
              </div>
              <strong>{snowballTarget ? `#${snowballTarget.snowballRank}` : "DONE"}</strong>
            </div>
            <div>
              <span>03</span>
              <div>
                <b>Build three months, then invest</b>
                <small>
                  Close the {money(fullEmergencyGapPaise)} emergency gap before adding aggressive investment goals.
                </small>
              </div>
              <strong>{emergencyGoal?.progressPercentage ?? 0}%</strong>
            </div>
          </div>
        </article>

        <article className="panel goal-action-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">CURRENT MONTH / DEPLOYABLE HEADROOM</p>
              <h2>{money(currentPlanHeadroomPaise)}</h2>
            </div>
            <span className={dashboard.dangerAlert ? "goal-risk-pill danger" : "goal-risk-pill"}>LIVE PLAN</span>
          </div>
          <p className="goal-action-intro">
            A practical sequence based on current plan headroom. Confirm the cash is genuinely free before moving it.
          </p>
          <div className="goal-action-stack">
            <div>
              <span>Starter emergency gap</span>
              <strong>{money(starterAllocationPaise)}</strong>
            </div>
            <div>
              <span>{snowballTarget ? `Extra to ${snowballTarget.name}` : "Snowball allocation"}</span>
              <strong>{money(snowballAllocationPaise)}</strong>
            </div>
            <div>
              <span>Still unassigned</span>
              <strong>{money(remainingHeadroomPaise)}</strong>
            </div>
          </div>
          <div className="goal-debt-warning">
            <span>DEBT DRAG</span>
            <b>
              {highestRateDebt
                ? `${highestRateDebt.name} costs ${((highestRateDebt.annualRateBps ?? 0) / 100).toFixed(2)}%`
                : "No rated active debt"}
            </b>
            <small>High-interest repayment is a guaranteed return; keep it ahead of new risk investments.</small>
          </div>
        </article>
      </section>

      {(assetForm || goalForm || allocationGoal) && (
        <section className="panel wealth-editor" ref={editorRef}>
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
                  <option value="restricted_wallet">Food wallet</option>
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
                <span>Exclude from financial-goal allocation</span>
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
                <span>Target calculation</span>
                <select
                  value={goalForm.targetMode}
                  onChange={(event) =>
                    setGoalForm({
                      ...goalForm,
                      targetMode: event.target.value as FinancialGoal["targetMode"],
                    })
                  }
                >
                  <option value="fixed">Fixed amount</option>
                  <option value="emergency_cover">EMIs + expense budget</option>
                </select>
              </label>
              {goalForm.targetMode === "fixed" ? (
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
              ) : (
                <label>
                  <span>Months of cover</span>
                  <input
                    max="24"
                    min="1"
                    required
                    step="1"
                    type="number"
                    value={goalForm.coverageMonths}
                    onChange={(event) => setGoalForm({ ...goalForm, coverageMonths: event.target.value })}
                  />
                  <small>
                    Live target: {money(Number(goalForm.coverageMonths || 0) * emergencyMonthlyNeedPaise)}
                    {" = "}
                    {goalForm.coverageMonths || 0} months × {money(emergencyMonthlyNeedPaise)}
                  </small>
                </label>
              )}
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
                <span>Food wallet</span>
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
              <h2>Savings, investments and wallets</h2>
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
                  <span>
                    {asset.restricted
                      ? "Food spending only · excluded from goals"
                      : `${money(asset.allocatedPaise)} allocated`}
                  </span>
                  <small>
                    {asset.assetType === "restricted_wallet"
                      ? "Use for orders and groceries"
                      : asset.monthlyContributionPaise > 0
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
              {goal.targetMode === "emergency_cover" && goal.monthlyNeedPaise != null && (
                <p>
                  Live target: {goal.coverageMonths} months × {money(goal.monthlyNeedPaise)} (EMIs + expense budget)
                </p>
              )}
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
