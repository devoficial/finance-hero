export type DebtPlanStrategy = "snowball" | "avalanche";

export interface DebtPlanInput {
  id: string;
  name: string;
  principalPaise: number;
  emiPaise: number;
  annualRateBps: number | null;
}

export interface DebtPlanMonth {
  month: string;
  remainingPrincipalPaise: number;
  interestPaise: number;
  paymentPaise: number;
}

export interface DebtPlanResult {
  strategy: DebtPlanStrategy;
  extraPaymentPaise: number;
  monthlyBudgetPaise: number;
  debtFree: boolean;
  payoffMonths: number | null;
  debtFreeMonth: string | null;
  totalInterestPaise: number;
  totalPaymentPaise: number;
  payoffOrder: Array<{ id: string; name: string; month: string }>;
  months: DebtPlanMonth[];
}

interface WorkingDebt extends DebtPlanInput {
  balancePaise: number;
}

function monthAfter(startMonth: string, offset: number): string {
  const date = new Date(`${startMonth}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function priority(left: WorkingDebt, right: WorkingDebt, strategy: DebtPlanStrategy): number {
  if (strategy === "snowball") {
    return left.balancePaise - right.balancePaise || (right.annualRateBps ?? 0) - (left.annualRateBps ?? 0);
  }
  return (right.annualRateBps ?? 0) - (left.annualRateBps ?? 0) || left.balancePaise - right.balancePaise;
}

export function simulateDebtPlan(
  debts: DebtPlanInput[],
  strategy: DebtPlanStrategy,
  extraPaymentPaise: number,
  startMonth: string,
  maximumMonths = 600,
): DebtPlanResult {
  if (!/^\d{4}-\d{2}$/.test(startMonth)) {
    throw new Error("Debt plan start month must use YYYY-MM.");
  }
  if (!Number.isSafeInteger(extraPaymentPaise) || extraPaymentPaise < 0) {
    throw new Error("Extra debt payment must be a non-negative paise integer.");
  }

  const working = debts
    .filter((debt) => debt.principalPaise > 0)
    .map<WorkingDebt>((debt) => ({
      ...debt,
      balancePaise: debt.principalPaise,
    }));
  const monthlyBudgetPaise = working.reduce((sum, debt) => sum + Math.max(0, debt.emiPaise), 0) + extraPaymentPaise;
  const months: DebtPlanMonth[] = [];
  const payoffOrder: DebtPlanResult["payoffOrder"] = [];
  let totalInterestPaise = 0;
  let totalPaymentPaise = 0;

  for (let offset = 1; offset <= maximumMonths && working.some((debt) => debt.balancePaise > 0); offset += 1) {
    const month = monthAfter(startMonth, offset);
    let monthInterestPaise = 0;
    let monthPaymentPaise = 0;

    for (const debt of working.filter((item) => item.balancePaise > 0)) {
      const interestPaise = Math.max(0, Math.round((debt.balancePaise * (debt.annualRateBps ?? 0)) / 120_000));
      debt.balancePaise += interestPaise;
      monthInterestPaise += interestPaise;
    }

    for (const debt of working.filter((item) => item.balancePaise > 0)) {
      const paymentPaise = Math.min(debt.balancePaise, Math.max(0, debt.emiPaise));
      debt.balancePaise -= paymentPaise;
      monthPaymentPaise += paymentPaise;
    }

    let rolloverPaise = Math.max(0, monthlyBudgetPaise - monthPaymentPaise);
    while (rolloverPaise > 0) {
      const target = working
        .filter((debt) => debt.balancePaise > 0)
        .toSorted((left, right) => priority(left, right, strategy))[0];
      if (!target) {
        break;
      }
      const paymentPaise = Math.min(target.balancePaise, rolloverPaise);
      target.balancePaise -= paymentPaise;
      rolloverPaise -= paymentPaise;
      monthPaymentPaise += paymentPaise;
    }

    for (const debt of working) {
      if (debt.balancePaise === 0 && !payoffOrder.some((payoff) => payoff.id === debt.id)) {
        payoffOrder.push({ id: debt.id, name: debt.name, month });
      }
    }

    totalInterestPaise += monthInterestPaise;
    totalPaymentPaise += monthPaymentPaise;
    months.push({
      month,
      remainingPrincipalPaise: working.reduce((sum, debt) => sum + debt.balancePaise, 0),
      interestPaise: monthInterestPaise,
      paymentPaise: monthPaymentPaise,
    });

    if (monthPaymentPaise === 0 && monthInterestPaise === 0) {
      break;
    }
  }

  const debtFree = working.every((debt) => debt.balancePaise === 0);
  return {
    strategy,
    extraPaymentPaise,
    monthlyBudgetPaise,
    debtFree,
    payoffMonths: debtFree ? months.length : null,
    debtFreeMonth: debtFree ? (months.at(-1)?.month ?? startMonth) : null,
    totalInterestPaise,
    totalPaymentPaise,
    payoffOrder,
    months,
  };
}
