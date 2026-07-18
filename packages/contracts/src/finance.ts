import { z } from "zod";

export const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);
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
export type CreateManualTransactionRequest = z.infer<typeof createManualTransactionRequestSchema>;
