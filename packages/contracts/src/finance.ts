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
  kind: z.enum(["expense", "income"]),
  amountPaise: paiseSchema.positive(),
  accountName: z.string(),
  categoryName: z.string().nullable(),
  origin: z.string(),
});

export const ledgerResponseSchema = z.object({
  month: monthSchema,
  transactions: z.array(ledgerTransactionSchema),
});

export const referenceDataResponseSchema = z.object({
  accounts: z.array(z.object({ id: z.string(), name: z.string() })),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const expenseMonthSummarySchema = z.object({
  month: monthSchema,
  regularExpensePaise: paiseSchema.nonnegative(),
  regularBudgetPaise: paiseSchema.nonnegative(),
  budgetUsedPercentage: z.number().int().nonnegative(),
  transactionCount: z.number().int().nonnegative(),
});

export const expenseYearResponseSchema = z.object({
  year: yearSchema,
  months: z.array(expenseMonthSummarySchema).length(12),
});

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

export const createManualTransactionRequestSchema = z.object({
  occurredOn: localDateSchema,
  payee: z.string().trim().min(1).max(160),
  memo: z.string().trim().max(500).optional(),
  kind: z.enum(["expense", "income"]),
  amountPaise: paiseSchema.positive(),
  assetAccountId: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(8).max(200),
});

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type LedgerTransaction = z.infer<typeof ledgerTransactionSchema>;
export type LedgerResponse = z.infer<typeof ledgerResponseSchema>;
export type ReferenceDataResponse = z.infer<typeof referenceDataResponseSchema>;
export type ExpenseMonthSummary = z.infer<typeof expenseMonthSummarySchema>;
export type ExpenseYearResponse = z.infer<typeof expenseYearResponseSchema>;
export type Liability = z.infer<typeof liabilitySchema>;
export type LiabilitiesResponse = z.infer<typeof liabilitiesResponseSchema>;
export type PersonalBalance = z.infer<typeof personalBalanceSchema>;
export type CreateLiabilityRequest = z.infer<typeof createLiabilityRequestSchema>;
export type CreatePersonalBalanceRequest = z.infer<typeof createPersonalBalanceRequestSchema>;
export type UpdatePersonalBalanceRequest = z.infer<typeof updatePersonalBalanceRequestSchema>;
export type UpdateLiabilityRequest = z.infer<typeof updateLiabilityRequestSchema>;
export type CreateManualTransactionRequest = z.infer<typeof createManualTransactionRequestSchema>;
