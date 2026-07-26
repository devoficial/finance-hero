import { z } from "zod";

export const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);
export const yearSchema = z.string().regex(/^\d{4}$/);
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const paiseSchema = z.number().int().safe();

export const dashboardResponseSchema = z.object({
  month: monthSchema,
  plannedIncomePaise: paiseSchema,
  actualIncomePaise: paiseSchema,
  regularExpensePaise: paiseSchema,
  totalExpensePaise: paiseSchema,
  cashOutflowPaise: paiseSchema,
  debtPaymentPaise: paiseSchema,
  assetBuildingPaise: paiseSchema,
  regularBudgetPaise: paiseSchema,
  totalEmiPaise: paiseSchema,
  debtPrincipalPaise: paiseSchema,
  availableAfterPlanPaise: paiseSchema,
  budgetUsedPercentage: z.number().int().nonnegative(),
  dangerAlert: z.boolean(),
  transactionCount: z.number().int().nonnegative(),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      amountPaise: paiseSchema.nonnegative(),
    }),
  ),
  expenseCategories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      amountPaise: paiseSchema.nonnegative(),
    }),
  ),
  snowballTarget: z
    .object({
      name: z.string(),
      principalPaise: paiseSchema.nonnegative(),
      emiPaise: paiseSchema.nonnegative(),
      annualRateBps: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
});

export const ledgerTransactionSchema = z.object({
  id: z.string(),
  occurredOn: localDateSchema,
  payee: z.string(),
  memo: z.string().nullable(),
  kind: z.enum(["expense", "income", "transfer", "debt_payment"]),
  status: z.enum(["posted", "reversed"]),
  amountPaise: paiseSchema.positive(),
  accountId: z.string(),
  accountName: z.string(),
  destinationAccountId: z.string().nullable(),
  destinationAccountName: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  splits: z.array(
    z.object({
      categoryId: z.string(),
      categoryName: z.string(),
      amountPaise: paiseSchema.positive(),
    }),
  ),
  origin: z.string(),
  correctedFromId: z.string().nullable(),
  canReverse: z.boolean(),
});

export const ledgerResponseSchema = z.object({
  month: monthSchema,
  transactions: z.array(ledgerTransactionSchema),
});

export const referenceDataResponseSchema = z.object({
  accounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      accountClass: z.enum(["asset", "liability"]),
      accountType: z.string(),
    }),
  ),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const importArtifactSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
  status: z.enum(["parsed", "needs_parser", "failed"]),
  parserMessage: z.string().nullable(),
  rowCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  approvedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export const importCandidateSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  filename: z.string(),
  sourceRow: z.number().int().positive(),
  version: z.number().int().positive(),
  occurredOn: localDateSchema.nullable(),
  payee: z.string(),
  amountPaise: paiseSchema.positive(),
  direction: z.enum(["debit", "credit"]),
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  confidence: z.number().int().min(0).max(100),
  warnings: z.array(z.string()),
  source: z.record(z.string(), z.string()),
  transactionId: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export const importQueueResponseSchema = z.object({
  pendingCount: z.number().int().nonnegative(),
  approvedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  artifacts: z.array(importArtifactSchema),
  candidates: z.array(importCandidateSchema),
});

export const statementUploadResponseSchema = z.object({
  duplicate: z.boolean(),
  artifact: importArtifactSchema,
});

export const statementParseRequestSchema = z.object({
  password: z.string().max(256).optional(),
});

export const updateImportCandidateRequestSchema = z
  .object({
    occurredOn: localDateSchema.nullable().optional(),
    payee: z.string().trim().min(1).max(160).optional(),
    amountPaise: paiseSchema.positive().optional(),
    direction: z.enum(["debit", "credit"]).optional(),
    accountId: z.string().min(1).nullable().optional(),
    categoryId: z.string().min(1).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one candidate field is required." });

export const importCandidateActionRequestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

export const rejectImportCandidatesRequestSchema = importCandidateActionRequestSchema.extend({
  reason: z.string().trim().min(3).max(500),
});

export const financialAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  accountClass: z.enum(["asset", "liability"]),
  accountType: z.string(),
  institution: z.string().nullable(),
  isActive: z.boolean(),
  balancePaise: paiseSchema,
  transactionCount: z.number().int().nonnegative(),
  managedBy: z.enum(["ledger", "wealth", "liability"]),
  restricted: z.boolean(),
});

export const financialAccountsResponseSchema = z.object({
  accounts: z.array(financialAccountSchema),
  totalAssetBalancePaise: paiseSchema,
  totalLiabilityBalancePaise: paiseSchema.nonnegative(),
});

export const createFinancialAccountRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  accountType: z.enum(["bank", "cash", "savings", "investment", "wallet", "other"]),
  institution: z.string().trim().max(160).nullable().optional(),
  openingBalancePaise: paiseSchema.nonnegative(),
  restricted: z.boolean().default(false),
});

export const updateFinancialAccountRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    institution: z.string().trim().max(160).nullable().optional(),
    isActive: z.boolean().optional(),
    balancePaise: paiseSchema.nonnegative().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one account field is required." });

export const expenseMonthSummarySchema = z.object({
  month: monthSchema,
  regularExpensePaise: paiseSchema.nonnegative(),
  totalExpensePaise: paiseSchema.nonnegative(),
  cashOutflowPaise: paiseSchema.nonnegative(),
  debtPaymentPaise: paiseSchema.nonnegative(),
  assetBuildingPaise: paiseSchema.nonnegative(),
  regularBudgetPaise: paiseSchema.nonnegative(),
  budgetUsedPercentage: z.number().int().nonnegative(),
  transactionCount: z.number().int().nonnegative(),
});

export const expenseYearResponseSchema = z.object({
  year: yearSchema,
  months: z.array(expenseMonthSummarySchema).length(12),
});

export const budgetLineSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  broadBucket: z.string(),
  budgetEligible: z.boolean(),
  alertEligible: z.boolean(),
  plannedPaise: paiseSchema.nonnegative(),
  spentPaise: paiseSchema,
  remainingPaise: paiseSchema,
  comment: z.string(),
  updatedAt: z.string().datetime().nullable(),
});

export const monthlyCashAdjustmentSchema = z.object({
  id: z.string(),
  occurredOn: localDateSchema,
  label: z.string(),
  amountPaise: paiseSchema,
});

export const monthlyCashBridgeSchema = z.object({
  carryoverPaise: paiseSchema,
  adjustments: z.array(monthlyCashAdjustmentSchema),
  adjustmentTotalPaise: paiseSchema,
  fundsAvailablePaise: paiseSchema,
  cashOutflowPaise: paiseSchema,
  closingBalancePaise: paiseSchema,
});

export const budgetMonthResponseSchema = z.object({
  month: monthSchema,
  state: z.enum(["open", "closed"]),
  plannedIncomePaise: paiseSchema.nonnegative(),
  regularBudgetPaise: paiseSchema.nonnegative(),
  unallocatedIncomePaise: paiseSchema,
  updatedAt: z.string().datetime().nullable(),
  cashBridge: monthlyCashBridgeSchema,
  lines: z.array(budgetLineSchema),
});

export const updateBudgetMonthRequestSchema = z
  .object({
    plannedIncomePaise: paiseSchema.nonnegative().optional(),
    cashAdjustments: z
      .array(
        z.object({
          id: z.string().min(1).optional(),
          occurredOn: localDateSchema,
          label: z.string().trim().min(1).max(120),
          amountPaise: paiseSchema.refine((value) => value !== 0, { message: "Cash adjustment cannot be zero." }),
        }),
      )
      .max(100)
      .optional(),
    lines: z
      .array(
        z
          .object({
            categoryId: z.string().min(1),
            plannedPaise: paiseSchema.nonnegative().optional(),
            actualPaise: paiseSchema.nonnegative().optional(),
            comment: z.string().trim().max(500).optional(),
          })
          .refine(
            (value) =>
              value.plannedPaise !== undefined || value.actualPaise !== undefined || value.comment !== undefined,
            { message: "At least one expense sheet row field is required." },
          ),
      )
      .min(1)
      .optional(),
  })
  .refine(
    (value) =>
      value.plannedIncomePaise !== undefined || value.cashAdjustments !== undefined || value.lines !== undefined,
    {
      message: "At least one budget field is required.",
    },
  );

export const liabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  productType: z.string(),
  originalAmountPaise: paiseSchema.nonnegative(),
  currentPrincipalPaise: paiseSchema.nonnegative(),
  paidPaise: paiseSchema.nonnegative(),
  emiPaise: paiseSchema.nonnegative(),
  annualRateBps: z.number().int().nonnegative().nullable(),
  status: z.enum(["active", "cleared"]),
  snowballRank: z.number().int().positive().nullable(),
  canUndoClear: z.boolean(),
});

export const personalBalanceSchema = z.object({
  id: z.string(),
  name: z.string(),
  direction: z.enum(["payable", "receivable"]),
  amountPaise: paiseSchema.nonnegative(),
  status: z.enum(["open", "settled"]),
  note: z.string().nullable(),
});

export const liabilitiesResponseSchema = z.object({
  totalOriginalPaise: paiseSchema.nonnegative(),
  totalPrincipalPaise: paiseSchema.nonnegative(),
  totalEmiPaise: paiseSchema.nonnegative(),
  activeCount: z.number().int().nonnegative(),
  clearedCount: z.number().int().nonnegative(),
  otherLiabilityPaise: paiseSchema.nonnegative(),
  receivablePaise: paiseSchema.nonnegative(),
  netObligationPaise: paiseSchema,
  liabilities: z.array(liabilitySchema),
  otherLiabilities: z.array(personalBalanceSchema),
  receivables: z.array(personalBalanceSchema),
});

export const projectExpenseSchema = z.object({
  id: z.string(),
  occurredOn: localDateSchema,
  description: z.string(),
  amountPaise: paiseSchema.positive(),
  runningBalancePaise: paiseSchema.nullable(),
  includedInActual: z.boolean(),
  reviewStatus: z.enum(["confirmed", "needs_review"]),
  linkedTransactionId: z.string().nullable(),
  source: z.enum(["imported", "manual"]),
});

export const projectCommitmentSchema = z.object({
  id: z.string(),
  vendorName: z.string(),
  estimatedPaise: paiseSchema.nonnegative(),
  pendingPaise: paiseSchema.nonnegative(),
  status: z.enum(["open", "settled", "unknown"]),
});

export const projectSummaryResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["active", "completed", "on_hold"]),
  freshness: z.enum(["current", "needs_update"]),
  sourceExpensePaise: paiseSchema.nonnegative(),
  actualExpensePaise: paiseSchema.nonnegative(),
  excludedPaise: paiseSchema.nonnegative(),
  commitmentEstimatePaise: paiseSchema.nonnegative(),
  pendingCommitmentPaise: paiseSchema.nonnegative(),
  forecastPaise: paiseSchema.nonnegative(),
  latestExpenseOn: localDateSchema.nullable(),
  needsReviewCount: z.number().int().nonnegative(),
  monthlySpend: z.array(
    z.object({
      month: monthSchema,
      amountPaise: paiseSchema.nonnegative(),
    }),
  ),
  expenses: z.array(projectExpenseSchema),
  commitments: z.array(projectCommitmentSchema),
});

export const createProjectExpenseRequestSchema = z.object({
  occurredOn: localDateSchema,
  description: z.string().trim().min(1).max(240),
  amountPaise: paiseSchema.positive(),
  accountId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(200),
});

export const updateProjectExpenseRequestSchema = z
  .object({
    description: z.string().trim().min(1).max(240).optional(),
    includedInActual: z.boolean().optional(),
    reviewStatus: z.enum(["confirmed", "needs_review"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one project expense field is required." });

export const createProjectCommitmentRequestSchema = z.object({
  vendorName: z.string().trim().min(1).max(160),
  estimatedPaise: paiseSchema.nonnegative(),
  pendingPaise: paiseSchema.nonnegative(),
  status: z.enum(["open", "settled", "unknown"]),
});

export const updateProjectCommitmentRequestSchema = z
  .object({
    vendorName: z.string().trim().min(1).max(160).optional(),
    estimatedPaise: paiseSchema.nonnegative().optional(),
    pendingPaise: paiseSchema.nonnegative().optional(),
    status: z.enum(["open", "settled", "unknown"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one commitment field is required." });

export const wealthAssetTypeSchema = z.enum(["savings", "investment", "emergency_fund", "restricted_wallet"]);

export const wealthAssetSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  assetType: wealthAssetTypeSchema,
  institution: z.string().nullable(),
  currentValuePaise: paiseSchema.nonnegative(),
  monthlyContributionPaise: paiseSchema.nonnegative(),
  allocatedPaise: paiseSchema.nonnegative(),
  availablePaise: paiseSchema.nonnegative(),
  restricted: z.boolean(),
  asOfDate: localDateSchema,
});

export const financialGoalSchema = z.object({
  id: z.string(),
  name: z.string(),
  targetPaise: paiseSchema.positive(),
  targetMode: z.enum(["fixed", "emergency_cover"]),
  coverageMonths: z.number().int().min(1).max(24).nullable(),
  monthlyNeedPaise: paiseSchema.nonnegative().nullable(),
  targetDate: localDateSchema.nullable(),
  priority: z.number().int().min(1).max(5),
  status: z.enum(["active", "achieved", "paused"]),
  monthlyContributionPaise: paiseSchema.nonnegative(),
  notes: z.string().nullable(),
  allocatedPaise: paiseSchema.nonnegative(),
  remainingPaise: paiseSchema.nonnegative(),
  progressPercentage: z.number().int().min(0).max(100),
  forecastDate: localDateSchema.nullable(),
  onTrack: z.boolean().nullable(),
  allocations: z.array(
    z.object({
      assetId: z.string(),
      assetName: z.string(),
      amountPaise: paiseSchema.nonnegative(),
    }),
  ),
});

export const wealthResponseSchema = z.object({
  totalAssetPaise: paiseSchema.nonnegative(),
  savingsPaise: paiseSchema.nonnegative(),
  investmentPaise: paiseSchema.nonnegative(),
  restrictedWalletPaise: paiseSchema.nonnegative(),
  allocatablePaise: paiseSchema.nonnegative(),
  allocatedPaise: paiseSchema.nonnegative(),
  debtPaise: paiseSchema.nonnegative(),
  receivablePaise: paiseSchema.nonnegative(),
  netWorthPaise: paiseSchema,
  monthlyContributionPaise: paiseSchema.nonnegative(),
  assets: z.array(wealthAssetSchema),
  goals: z.array(financialGoalSchema),
});

const wealthAssetFieldsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  assetType: wealthAssetTypeSchema,
  institution: z.string().trim().max(160).nullable().optional(),
  currentValuePaise: paiseSchema.nonnegative(),
  monthlyContributionPaise: paiseSchema.nonnegative(),
  restricted: z.boolean(),
  asOfDate: localDateSchema,
});

export const createWealthAssetRequestSchema = wealthAssetFieldsSchema.superRefine((value, context) => {
  if (value.assetType === "restricted_wallet" && !value.restricted) {
    context.addIssue({ code: "custom", message: "Restricted wallets must remain restricted." });
  }
});
export const updateWealthAssetRequestSchema = wealthAssetFieldsSchema
  .partial()
  .superRefine((value, context) => {
    if (value.assetType === "restricted_wallet" && !value.restricted) {
      context.addIssue({ code: "custom", message: "Restricted wallets must remain restricted." });
    }
  })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one asset field is required." });

export const createFinancialGoalRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  targetPaise: paiseSchema.positive(),
  targetMode: z.enum(["fixed", "emergency_cover"]).default("fixed"),
  coverageMonths: z.number().int().min(1).max(24).nullable().optional(),
  targetDate: localDateSchema.nullable().optional(),
  priority: z.number().int().min(1).max(5),
  status: z.enum(["active", "achieved", "paused"]).default("active"),
  monthlyContributionPaise: paiseSchema.nonnegative(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const updateFinancialGoalRequestSchema = createFinancialGoalRequestSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one goal field is required." });

export const updateGoalAllocationsRequestSchema = z.object({
  allocations: z.array(
    z.object({
      assetId: z.string().min(1),
      amountPaise: paiseSchema.nonnegative(),
    }),
  ),
});

export const createPersonalBalanceRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  direction: z.enum(["payable", "receivable"]),
  amountPaise: paiseSchema.nonnegative(),
  note: z.string().trim().max(500).optional(),
});

export const createLiabilityRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  productType: z.string().trim().min(1).max(80),
  originalAmountPaise: paiseSchema.nonnegative(),
  currentPrincipalPaise: paiseSchema.nonnegative(),
  emiPaise: paiseSchema.nonnegative(),
  annualRateBps: z.number().int().nonnegative().nullable(),
  status: z.enum(["active", "cleared"]),
});

export const updatePersonalBalanceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    amountPaise: paiseSchema.nonnegative().optional(),
    status: z.enum(["open", "settled"]).optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one personal balance field is required." });

export const updateLiabilityRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    productType: z.string().trim().min(1).max(80).optional(),
    originalAmountPaise: paiseSchema.nonnegative().optional(),
    currentPrincipalPaise: paiseSchema.nonnegative().optional(),
    emiPaise: paiseSchema.nonnegative().optional(),
    annualRateBps: z.number().int().nonnegative().nullable().optional(),
    status: z.enum(["active", "cleared"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one liability field is required." });

export const transactionSplitInputSchema = z.object({
  categoryId: z.string().min(1),
  amountPaise: paiseSchema.positive(),
});

export const createManualTransactionRequestSchema = z
  .object({
    occurredOn: localDateSchema,
    payee: z.string().trim().min(1).max(160),
    memo: z.string().trim().max(500).optional(),
    kind: z.enum(["expense", "income", "transfer", "debt_payment"]),
    amountPaise: paiseSchema.positive(),
    accountId: z.string().min(1),
    destinationAccountId: z.string().min(1).optional(),
    categoryId: z.string().min(1).optional(),
    splits: z.array(transactionSplitInputSchema).min(2).max(20).optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .superRefine((value, context) => {
    if (value.kind === "expense" && !value.categoryId && !value.splits) {
      context.addIssue({ code: "custom", message: "Expense transactions require a category or split lines." });
    }
    if (value.splits) {
      if (value.kind !== "expense") {
        context.addIssue({ code: "custom", message: "Only expenses can be split across categories." });
      }
      const splitTotal = value.splits.reduce((sum, split) => sum + split.amountPaise, 0);
      if (splitTotal !== value.amountPaise) {
        context.addIssue({ code: "custom", message: "Split lines must equal the transaction amount." });
      }
    }
    if (value.kind === "transfer" || value.kind === "debt_payment") {
      if (!value.destinationAccountId) {
        context.addIssue({ code: "custom", message: "This transaction requires a destination account." });
      } else if (value.destinationAccountId === value.accountId) {
        context.addIssue({ code: "custom", message: "Source and destination accounts must be different." });
      }
    }
  });

export const replaceTransactionRequestSchema = createManualTransactionRequestSchema;

export const reverseTransactionRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(200),
});

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type LedgerTransaction = z.infer<typeof ledgerTransactionSchema>;
export type LedgerResponse = z.infer<typeof ledgerResponseSchema>;
export type ReferenceDataResponse = z.infer<typeof referenceDataResponseSchema>;
export type ImportArtifact = z.infer<typeof importArtifactSchema>;
export type ImportCandidate = z.infer<typeof importCandidateSchema>;
export type ImportQueueResponse = z.infer<typeof importQueueResponseSchema>;
export type StatementUploadResponse = z.infer<typeof statementUploadResponseSchema>;
export type StatementParseRequest = z.infer<typeof statementParseRequestSchema>;
export type UpdateImportCandidateRequest = z.infer<typeof updateImportCandidateRequestSchema>;
export type ImportCandidateActionRequest = z.infer<typeof importCandidateActionRequestSchema>;
export type RejectImportCandidatesRequest = z.infer<typeof rejectImportCandidatesRequestSchema>;
export type FinancialAccount = z.infer<typeof financialAccountSchema>;
export type FinancialAccountsResponse = z.infer<typeof financialAccountsResponseSchema>;
export type CreateFinancialAccountRequest = z.infer<typeof createFinancialAccountRequestSchema>;
export type UpdateFinancialAccountRequest = z.infer<typeof updateFinancialAccountRequestSchema>;
export type ExpenseMonthSummary = z.infer<typeof expenseMonthSummarySchema>;
export type ExpenseYearResponse = z.infer<typeof expenseYearResponseSchema>;
export type BudgetLine = z.infer<typeof budgetLineSchema>;
export type MonthlyCashAdjustment = z.infer<typeof monthlyCashAdjustmentSchema>;
export type MonthlyCashBridge = z.infer<typeof monthlyCashBridgeSchema>;
export type BudgetMonthResponse = z.infer<typeof budgetMonthResponseSchema>;
export type UpdateBudgetMonthRequest = z.infer<typeof updateBudgetMonthRequestSchema>;
export type Liability = z.infer<typeof liabilitySchema>;
export type LiabilitiesResponse = z.infer<typeof liabilitiesResponseSchema>;
export type PersonalBalance = z.infer<typeof personalBalanceSchema>;
export type CreateLiabilityRequest = z.infer<typeof createLiabilityRequestSchema>;
export type CreatePersonalBalanceRequest = z.infer<typeof createPersonalBalanceRequestSchema>;
export type UpdatePersonalBalanceRequest = z.infer<typeof updatePersonalBalanceRequestSchema>;
export type UpdateLiabilityRequest = z.infer<typeof updateLiabilityRequestSchema>;
export type CreateManualTransactionRequest = z.infer<typeof createManualTransactionRequestSchema>;
export type ReplaceTransactionRequest = z.infer<typeof replaceTransactionRequestSchema>;
export type ReverseTransactionRequest = z.infer<typeof reverseTransactionRequestSchema>;
export type ProjectExpense = z.infer<typeof projectExpenseSchema>;
export type ProjectCommitment = z.infer<typeof projectCommitmentSchema>;
export type ProjectSummaryResponse = z.infer<typeof projectSummaryResponseSchema>;
export type CreateProjectExpenseRequest = z.infer<typeof createProjectExpenseRequestSchema>;
export type UpdateProjectExpenseRequest = z.infer<typeof updateProjectExpenseRequestSchema>;
export type CreateProjectCommitmentRequest = z.infer<typeof createProjectCommitmentRequestSchema>;
export type UpdateProjectCommitmentRequest = z.infer<typeof updateProjectCommitmentRequestSchema>;
export type WealthAsset = z.infer<typeof wealthAssetSchema>;
export type FinancialGoal = z.infer<typeof financialGoalSchema>;
export type WealthResponse = z.infer<typeof wealthResponseSchema>;
export type CreateWealthAssetRequest = z.infer<typeof createWealthAssetRequestSchema>;
export type UpdateWealthAssetRequest = z.infer<typeof updateWealthAssetRequestSchema>;
export type CreateFinancialGoalRequest = z.infer<typeof createFinancialGoalRequestSchema>;
export type UpdateFinancialGoalRequest = z.infer<typeof updateFinancialGoalRequestSchema>;
export type UpdateGoalAllocationsRequest = z.infer<typeof updateGoalAllocationsRequestSchema>;
