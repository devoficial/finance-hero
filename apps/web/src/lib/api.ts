import {
  type CreateLiabilityRequest,
  type CreateManualTransactionRequest,
  type CreatePersonalBalanceRequest,
  type CreateProjectCommitmentRequest,
  type CreateProjectExpenseRequest,
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
  type PersonalBalance,
  type ProjectCommitment,
  type ProjectExpense,
  type ProjectSummaryResponse,
  personalBalanceSchema,
  projectCommitmentSchema,
  projectExpenseSchema,
  projectSummaryResponseSchema,
  type ReferenceDataResponse,
  type ReverseTransactionRequest,
  referenceDataResponseSchema,
  type UpdateLiabilityRequest,
  type UpdatePersonalBalanceRequest,
  type UpdateProjectCommitmentRequest,
  type UpdateProjectExpenseRequest,
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

export async function createLiability(input: CreateLiabilityRequest): Promise<Liability> {
  const response = await fetch("/api/v1/liabilities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return liabilitySchema.parse(await response.json());
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

export async function undoLiabilityClear(id: string): Promise<Liability> {
  const response = await fetch(`/api/v1/liabilities/${encodeURIComponent(id)}/undo-clear`, { method: "POST" });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return liabilitySchema.parse(await response.json());
}

export async function createPersonalBalance(input: CreatePersonalBalanceRequest): Promise<PersonalBalance> {
  const response = await fetch("/api/v1/personal-balances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return personalBalanceSchema.parse(await response.json());
}

export async function updatePersonalBalance(id: string, input: UpdatePersonalBalanceRequest): Promise<PersonalBalance> {
  const response = await fetch(`/api/v1/personal-balances/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return personalBalanceSchema.parse(await response.json());
}

export async function getReferenceData(signal?: AbortSignal): Promise<ReferenceDataResponse> {
  return referenceDataResponseSchema.parse(await getJson("/api/v1/reference-data", signal));
}

export async function getHomeConstruction(signal?: AbortSignal): Promise<ProjectSummaryResponse> {
  return projectSummaryResponseSchema.parse(await getJson("/api/v1/projects/home-construction", signal));
}

export async function createProjectExpense(input: CreateProjectExpenseRequest): Promise<ProjectExpense> {
  const response = await fetch("/api/v1/projects/home-construction/expenses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return projectExpenseSchema.parse(await response.json());
}

export async function updateProjectExpense(id: string, input: UpdateProjectExpenseRequest): Promise<ProjectExpense> {
  const response = await fetch(`/api/v1/projects/home-construction/expenses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return projectExpenseSchema.parse(await response.json());
}

export async function createProjectCommitment(input: CreateProjectCommitmentRequest): Promise<ProjectCommitment> {
  const response = await fetch("/api/v1/projects/home-construction/commitments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return projectCommitmentSchema.parse(await response.json());
}

export async function updateProjectCommitment(
  id: string,
  input: UpdateProjectCommitmentRequest,
): Promise<ProjectCommitment> {
  const response = await fetch(`/api/v1/projects/home-construction/commitments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return projectCommitmentSchema.parse(await response.json());
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

export async function reverseTransaction(id: string, input: ReverseTransactionRequest): Promise<LedgerTransaction> {
  const response = await fetch(`/api/v1/transactions/${encodeURIComponent(id)}/reverse`, {
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

export async function replaceTransaction(
  id: string,
  input: CreateManualTransactionRequest,
): Promise<LedgerTransaction> {
  const response = await fetch(`/api/v1/transactions/${encodeURIComponent(id)}/replace`, {
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
