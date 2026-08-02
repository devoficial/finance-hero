import type {
  DashboardResponse,
  FinancialAccountsResponse,
  LiabilitiesResponse,
  WealthResponse,
} from "@finance-hero/contracts";
import { describe, expect, it } from "vitest";
import { createFinancialReportDocument } from "./financial-report";

const dashboard: DashboardResponse = {
  month: "2026-08",
  plannedIncomePaise: 30_089_300,
  actualIncomePaise: 30_089_300,
  regularExpensePaise: 3_561_100,
  totalExpensePaise: 3_561_100,
  cashOutflowPaise: 7_570_860,
  debtPaymentPaise: 1_435_700,
  assetBuildingPaise: 2_574_060,
  regularBudgetPaise: 6_068_000,
  totalEmiPaise: 14_357_000,
  debtPrincipalPaise: 87_159_590,
  availableAfterPlanPaise: 9_664_300,
  cashBalancePaise: 73_339_200,
  cashBalanceSource: "bank_statement",
  cashBalanceAsOf: "2026-08-02",
  budgetUsedPercentage: 59,
  dangerAlert: false,
  transactionCount: 42,
  categories: [],
  expenseCategories: [],
  snowballTarget: null,
};

const accounts: FinancialAccountsResponse = {
  totalAssetBalancePaise: 97_964_800,
  totalLiabilityBalancePaise: 87_159_590,
  accounts: [
    {
      id: "axis",
      name: "Primary salary account",
      accountClass: "asset",
      accountType: "bank",
      institution: "Axis Bank",
      isActive: true,
      balancePaise: 73_339_200,
      transactionCount: 42,
      managedBy: "ledger",
      restricted: false,
    },
  ],
};

const liabilities: LiabilitiesResponse = {
  totalOriginalPaise: 100_000_000,
  totalPrincipalPaise: 87_159_590,
  totalEmiPaise: 14_357_000,
  activeCount: 1,
  clearedCount: 0,
  otherLiabilityPaise: 200_000,
  receivablePaise: 87_000,
  netObligationPaise: 87_272_590,
  liabilities: [
    {
      id: "home-loan",
      name: "Home loan",
      productType: "home_loan",
      originalAmountPaise: 100_000_000,
      currentPrincipalPaise: 87_159_590,
      paidPaise: 12_840_410,
      emiPaise: 14_357_000,
      annualRateBps: 875,
      status: "active",
      snowballRank: 1,
      canUndoClear: false,
    },
  ],
  otherLiabilities: [
    {
      id: "payable",
      name: "Personal payable",
      direction: "payable",
      amountPaise: 200_000,
      status: "open",
      note: null,
    },
  ],
  receivables: [
    {
      id: "receivable",
      name: "Personal receivable",
      direction: "receivable",
      amountPaise: 87_000,
      status: "open",
      note: "Expected this month",
    },
  ],
};

const wealth: WealthResponse = {
  totalAssetPaise: 24_625_600,
  savingsPaise: 20_000_000,
  investmentPaise: 3_779_400,
  restrictedWalletPaise: 846_200,
  allocatablePaise: 23_779_400,
  availableCashPaise: 20_000_000,
  allocatedPaise: 2_000_000,
  debtPaise: 87_159_590,
  receivablePaise: 87_000,
  netWorthPaise: -62_446_990,
  monthlyContributionPaise: 2_000_000,
  assets: [
    {
      id: "icici-reserve",
      accountId: "icici",
      name: "ICICI emergency reserve",
      assetType: "emergency_fund",
      institution: "ICICI Bank",
      currentValuePaise: 20_000_000,
      monthlyContributionPaise: 2_000_000,
      allocatedPaise: 2_000_000,
      availablePaise: 18_000_000,
      availableCashPaise: 18_000_000,
      allocationPolicy: "emergency_only",
      liquidity: "liquid",
      eligibleGoalTypes: ["emergency_fund"],
      restricted: false,
      asOfDate: "2026-08-02",
    },
  ],
  goals: [
    {
      id: "emergency-fund",
      name: "Emergency fund",
      goalType: "emergency_fund",
      targetPaise: 20_425_000,
      targetMode: "emergency_cover",
      coverageMonths: 1,
      monthlyNeedPaise: 20_425_000,
      targetDate: "2027-07-01",
      priority: 1,
      status: "active",
      monthlyContributionPaise: 2_000_000,
      notes: null,
      allocatedPaise: 2_000_000,
      remainingPaise: 18_425_000,
      progressPercentage: 10,
      forecastDate: "2027-05-01",
      onTrack: true,
      allocations: [{ assetId: "icici-reserve", assetName: "ICICI emergency reserve", amountPaise: 2_000_000 }],
    },
  ],
};

describe("financial summary PDF", () => {
  it("builds a readable multi-section PDF from local finance data", async () => {
    const doc = await createFinancialReportDocument({
      generatedOn: new Date("2026-08-02T10:30:00+05:30"),
      dashboard,
      accounts,
      liabilities,
      wealth,
    });

    const bytes = new Uint8Array(doc.output("arraybuffer"));

    expect(new TextDecoder().decode(bytes.slice(0, 8))).toContain("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(5_000);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
