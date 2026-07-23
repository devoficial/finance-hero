import { type DebtPlanInput, simulateDebtPlan } from "@finance-hero/domain";

export interface TwelveMonthForecastInput {
  startMonth: string;
  months?: number;
  plannedIncomePaise: number;
  regularExpensePaise: number;
  currentAssetPaise: number;
  receivablePaise: number;
  personalPayablePaise: number;
  debts: DebtPlanInput[];
  extraDebtPaymentPaise: number;
  annualIncomeGrowthPercentage: number;
  annualExpenseInflationPercentage: number;
}

export interface ForecastMonth {
  month: string;
  incomePaise: number;
  regularExpensePaise: number;
  debtPaymentPaise: number;
  interestPaise: number;
  cashSurplusPaise: number;
  projectedAssetPaise: number;
  remainingDebtPaise: number;
  projectedNetWorthPaise: number;
}

export interface TwelveMonthForecast {
  months: ForecastMonth[];
  projectedAssetPaise: number;
  remainingDebtPaise: number;
  projectedNetWorthPaise: number;
  cumulativeSurplusPaise: number;
  cumulativeInterestPaise: number;
}

function monthlyRate(annualPercentage: number): number {
  return (1 + Math.max(-99, annualPercentage) / 100) ** (1 / 12) - 1;
}

export function buildTwelveMonthForecast(input: TwelveMonthForecastInput): TwelveMonthForecast {
  const months = input.months ?? 12;
  const debtPlan = simulateDebtPlan(
    input.debts,
    "snowball",
    Math.max(0, input.extraDebtPaymentPaise),
    input.startMonth,
  );
  const incomeGrowth = monthlyRate(input.annualIncomeGrowthPercentage);
  const expenseInflation = monthlyRate(input.annualExpenseInflationPercentage);
  let projectedAssetPaise = input.currentAssetPaise;
  let remainingDebtPaise = input.debts.reduce((sum, debt) => sum + debt.principalPaise, 0);
  let cumulativeSurplusPaise = 0;
  let cumulativeInterestPaise = 0;
  const forecastMonths: ForecastMonth[] = [];

  for (let index = 0; index < months; index += 1) {
    const debtMonth = debtPlan.months[index];
    const incomePaise = Math.round(input.plannedIncomePaise * (1 + incomeGrowth) ** index);
    const regularExpensePaise = Math.round(input.regularExpensePaise * (1 + expenseInflation) ** index);
    const debtPaymentPaise = debtMonth?.paymentPaise ?? 0;
    const interestPaise = debtMonth?.interestPaise ?? 0;
    const cashSurplusPaise = incomePaise - regularExpensePaise - debtPaymentPaise;
    projectedAssetPaise = Math.max(0, projectedAssetPaise + cashSurplusPaise);
    cumulativeSurplusPaise += cashSurplusPaise;
    cumulativeInterestPaise += interestPaise;
    remainingDebtPaise = debtMonth?.remainingPrincipalPaise ?? remainingDebtPaise;
    forecastMonths.push({
      month: debtMonth?.month ?? monthAfter(input.startMonth, index + 1),
      incomePaise,
      regularExpensePaise,
      debtPaymentPaise,
      interestPaise,
      cashSurplusPaise,
      projectedAssetPaise,
      remainingDebtPaise,
      projectedNetWorthPaise:
        projectedAssetPaise + input.receivablePaise - input.personalPayablePaise - remainingDebtPaise,
    });
  }

  const finalMonth = forecastMonths.at(-1);
  return {
    months: forecastMonths,
    projectedAssetPaise: finalMonth?.projectedAssetPaise ?? input.currentAssetPaise,
    remainingDebtPaise: finalMonth?.remainingDebtPaise ?? remainingDebtPaise,
    projectedNetWorthPaise:
      finalMonth?.projectedNetWorthPaise ??
      input.currentAssetPaise +
        input.receivablePaise -
        input.personalPayablePaise -
        input.debts.reduce((sum, debt) => sum + debt.principalPaise, 0),
    cumulativeSurplusPaise,
    cumulativeInterestPaise,
  };
}

function monthAfter(startMonth: string, offset: number): string {
  const date = new Date(`${startMonth}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
