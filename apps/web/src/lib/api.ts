import {
  type AssistantChatRequest,
  type AssistantChatResponse,
  type AssistantConversation,
  type AssistantStatusResponse,
  assistantChatResponseSchema,
  assistantConversationSchema,
  assistantStatusResponseSchema,
  type BudgetMonthResponse,
  budgetMonthResponseSchema,
  type CreateFinancialAccountRequest,
  type CreateFinancialGoalRequest,
  type CreateLiabilityRequest,
  type CreatePersonalBalanceRequest,
  type CreateProjectCommitmentRequest,
  type CreateProjectExpenseRequest,
  type CreateWealthAssetRequest,
  type DashboardResponse,
  dashboardResponseSchema,
  type ExpenseYearResponse,
  expenseYearResponseSchema,
  type FinancialAccount,
  type FinancialAccountsResponse,
  type FinancialGoal,
  financialAccountSchema,
  financialAccountsResponseSchema,
  financialGoalSchema,
  type HealthResponse,
  healthResponseSchema,
  type ImportArtifact,
  type ImportCandidate,
  type ImportCandidateActionRequest,
  type ImportQueueResponse,
  importArtifactSchema,
  importCandidateSchema,
  importQueueResponseSchema,
  type LiabilitiesResponse,
  type Liability,
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
  type RejectImportCandidatesRequest,
  type ResolveImportDuplicateRequest,
  referenceDataResponseSchema,
  type StatementParseRequest,
  type StatementUploadResponse,
  statementUploadResponseSchema,
  type UpdateBudgetMonthRequest,
  type UpdateFinancialAccountRequest,
  type UpdateFinancialGoalRequest,
  type UpdateGoalAllocationsRequest,
  type UpdateImportCandidateRequest,
  type UpdateLiabilityRequest,
  type UpdatePersonalBalanceRequest,
  type UpdateProjectCommitmentRequest,
  type UpdateProjectExpenseRequest,
  type UpdateStatementReconciliationRequest,
  type UpdateWealthAssetRequest,
  type WealthAsset,
  type WealthResponse,
  wealthAssetSchema,
  wealthResponseSchema,
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

export async function getAssistantStatus(signal?: AbortSignal): Promise<AssistantStatusResponse> {
  return assistantStatusResponseSchema.parse(await getJson("/api/v1/assistant/status", signal));
}

export async function getAssistantConversation(id: string, signal?: AbortSignal): Promise<AssistantConversation> {
  return assistantConversationSchema.parse(
    await getJson(`/api/v1/assistant/conversations/${encodeURIComponent(id)}`, signal),
  );
}

export async function askAssistant(input: AssistantChatRequest): Promise<AssistantChatResponse> {
  const response = await fetch("/api/v1/assistant/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local assistant returned ${response.status}`);
  }
  return assistantChatResponseSchema.parse(await response.json());
}

export async function getDashboard(month: string, signal?: AbortSignal): Promise<DashboardResponse> {
  return dashboardResponseSchema.parse(await getJson(`/api/v1/dashboard?month=${encodeURIComponent(month)}`, signal));
}

export async function getExpenseYear(year: string, signal?: AbortSignal): Promise<ExpenseYearResponse> {
  return expenseYearResponseSchema.parse(
    await getJson(`/api/v1/expenses/year?year=${encodeURIComponent(year)}`, signal),
  );
}

export async function getLiabilities(signal?: AbortSignal): Promise<LiabilitiesResponse> {
  return liabilitiesResponseSchema.parse(await getJson("/api/v1/liabilities", signal));
}

export async function getAccounts(signal?: AbortSignal): Promise<FinancialAccountsResponse> {
  return financialAccountsResponseSchema.parse(await getJson("/api/v1/accounts", signal));
}

export async function createFinancialAccount(input: CreateFinancialAccountRequest): Promise<FinancialAccount> {
  const response = await fetch("/api/v1/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return financialAccountSchema.parse(await response.json());
}

export async function updateFinancialAccount(
  id: string,
  input: UpdateFinancialAccountRequest,
): Promise<FinancialAccount> {
  const response = await fetch(`/api/v1/accounts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return financialAccountSchema.parse(await response.json());
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

export async function getImports(signal?: AbortSignal): Promise<ImportQueueResponse> {
  return importQueueResponseSchema.parse(await getJson("/api/v1/imports", signal));
}

export async function uploadStatement(file: File, accountId?: string): Promise<StatementUploadResponse> {
  const query = new URLSearchParams({ filename: file.name });
  if (accountId) {
    query.set("accountId", accountId);
  }
  const response = await fetch(`/api/v1/statement-uploads?${query}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: file,
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return statementUploadResponseSchema.parse(await response.json());
}

export async function parseStatementArtifact(id: string, input: StatementParseRequest = {}) {
  const response = await fetch(`/api/v1/imports/${encodeURIComponent(id)}/parse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return importArtifactSchema.parse(await response.json());
}

export async function updateStatementReconciliation(
  id: string,
  input: UpdateStatementReconciliationRequest,
): Promise<ImportArtifact> {
  const response = await fetch(`/api/v1/imports/${encodeURIComponent(id)}/reconciliation`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return importArtifactSchema.parse(await response.json());
}

export async function reconcileStatement(id: string): Promise<ImportArtifact> {
  const response = await fetch(`/api/v1/imports/${encodeURIComponent(id)}/reconcile`, { method: "POST" });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return importArtifactSchema.parse(await response.json());
}

export async function updateImportCandidate(id: string, input: UpdateImportCandidateRequest): Promise<ImportCandidate> {
  const response = await fetch(`/api/v1/candidates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return importCandidateSchema.parse(await response.json());
}

export async function approveImportCandidates(input: ImportCandidateActionRequest): Promise<ImportQueueResponse> {
  const response = await fetch("/api/v1/candidate-actions/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return importQueueResponseSchema.parse(await response.json());
}

export async function rejectImportCandidates(input: RejectImportCandidatesRequest): Promise<ImportQueueResponse> {
  const response = await fetch("/api/v1/candidate-actions/reject", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return importQueueResponseSchema.parse(await response.json());
}

export async function resetImportCandidatesToPending(
  input: ImportCandidateActionRequest,
): Promise<ImportQueueResponse> {
  const response = await fetch("/api/v1/candidate-actions/reset-pending", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return importQueueResponseSchema.parse(await response.json());
}

export async function resolveImportDuplicate(
  id: string,
  input: ResolveImportDuplicateRequest,
): Promise<ImportQueueResponse> {
  const response = await fetch(`/api/v1/candidates/${encodeURIComponent(id)}/duplicate-resolution`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return importQueueResponseSchema.parse(await response.json());
}

export async function getBudget(month: string, signal?: AbortSignal): Promise<BudgetMonthResponse> {
  return budgetMonthResponseSchema.parse(await getJson(`/api/v1/budgets/${encodeURIComponent(month)}`, signal));
}

export async function updateBudget(month: string, input: UpdateBudgetMonthRequest): Promise<BudgetMonthResponse> {
  const response = await fetch(`/api/v1/budgets/${encodeURIComponent(month)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return budgetMonthResponseSchema.parse(await response.json());
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

export async function getWealth(signal?: AbortSignal): Promise<WealthResponse> {
  return wealthResponseSchema.parse(await getJson("/api/v1/wealth", signal));
}

export async function createWealthAsset(input: CreateWealthAssetRequest): Promise<WealthAsset> {
  const response = await fetch("/api/v1/wealth/assets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return wealthAssetSchema.parse(await response.json());
}

export async function updateWealthAsset(id: string, input: UpdateWealthAssetRequest): Promise<WealthAsset> {
  const response = await fetch(`/api/v1/wealth/assets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return wealthAssetSchema.parse(await response.json());
}

export async function createFinancialGoal(input: CreateFinancialGoalRequest): Promise<FinancialGoal> {
  const response = await fetch("/api/v1/wealth/goals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return financialGoalSchema.parse(await response.json());
}

export async function updateFinancialGoal(id: string, input: UpdateFinancialGoalRequest): Promise<FinancialGoal> {
  const response = await fetch(`/api/v1/wealth/goals/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return financialGoalSchema.parse(await response.json());
}

export async function updateGoalAllocations(id: string, input: UpdateGoalAllocationsRequest): Promise<FinancialGoal> {
  const response = await fetch(`/api/v1/wealth/goals/${encodeURIComponent(id)}/allocations`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Local API returned ${response.status}`);
  }
  return financialGoalSchema.parse(await response.json());
}
