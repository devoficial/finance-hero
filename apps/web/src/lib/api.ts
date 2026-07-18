import {
  type CreateManualTransactionRequest,
  type DashboardResponse,
  dashboardResponseSchema,
  type ExpenseYearResponse,
  expenseYearResponseSchema,
  type HealthResponse,
  healthResponseSchema,
  type LedgerResponse,
  type LedgerTransaction,
  type LiabilitiesResponse,
  type Liability,
  ledgerResponseSchema,
  ledgerTransactionSchema,
  liabilitiesResponseSchema,
  liabilitySchema,
  type ReferenceDataResponse,
  referenceDataResponseSchema,
  type UpdateLiabilityRequest,
} from "@finance-hero/contracts";

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal });

  if (!response.ok) {
    throw new Error(`Local API returned ${response.status}`);
  }

  return response.json();
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return healthResponseSchema.parse(await getJson("/api/v1/health", signal));
}

export async function getDashboard(month: string, signal?: AbortSignal): Promise<DashboardResponse> {
  return dashboardResponseSchema.parse(await getJson(`/api/v1/dashboard?month=${encodeURIComponent(month)}`, signal));
}

export async function getLedger(month: string, signal?: AbortSignal): Promise<LedgerResponse> {
  return ledgerResponseSchema.parse(await getJson(`/api/v1/ledger?month=${encodeURIComponent(month)}`, signal));
}

export async function getExpenseYear(year: string, signal?: AbortSignal): Promise<ExpenseYearResponse> {
  return expenseYearResponseSchema.parse(
    await getJson(`/api/v1/expenses/year?year=${encodeURIComponent(year)}`, signal),
  );
}

export async function getLiabilities(signal?: AbortSignal): Promise<LiabilitiesResponse> {
  return liabilitiesResponseSchema.parse(await getJson("/api/v1/liabilities", signal));
}

export async function updateLiability(id: string, input: UpdateLiabilityRequest): Promise<Liability> {
  const response = await fetch(`/api/v1/liabilities/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return liabilitySchema.parse(await response.json());
}

export async function getReferenceData(signal?: AbortSignal): Promise<ReferenceDataResponse> {
  return referenceDataResponseSchema.parse(await getJson("/api/v1/reference-data", signal));
}

export async function createManualTransaction(input: CreateManualTransactionRequest): Promise<LedgerTransaction> {
  const response = await fetch("/api/v1/transactions/manual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }

  return ledgerTransactionSchema.parse(await response.json());
}
