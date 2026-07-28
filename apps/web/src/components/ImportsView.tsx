import type {
  ImportArtifact,
  ImportCandidate,
  ImportQueueResponse,
  ReferenceDataResponse,
  UpdateImportCandidateRequest,
} from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  approveImportCandidates,
  parseStatementArtifact,
  reconcileStatement,
  rejectImportCandidates,
  resetImportCandidatesToPending,
  resolveImportDuplicate,
  updateImportCandidate,
  updateStatementReconciliation,
  uploadStatement,
} from "../lib/api";

interface ImportsViewProps {
  data?: ImportQueueResponse;
  loading: boolean;
  money: (paise: number) => string;
  referenceData?: ReferenceDataResponse;
}

function rupeesToPaise(value: string): number | null {
  const amount = Number(value.replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}

function signedRupeesToPaise(value: string): number | null {
  const amount = Number(value.replace(/,/g, ""));
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

const reconciliationCopy: Record<ImportArtifact["reconciliation"]["status"], { label: string; explanation: string }> = {
  account_required: {
    label: "Choose account",
    explanation: "Assign the account represented by this statement.",
  },
  metadata_required: {
    label: "Balance details needed",
    explanation: "Enter the statement period, opening balance, and closing balance.",
  },
  review_pending: {
    label: "Review transactions",
    explanation: "Approve or reject every detected row before final reconciliation.",
  },
  extraction_mismatch: {
    label: "Statement rows do not add up",
    explanation: "The extracted debits and credits do not reproduce the statement closing balance.",
  },
  ledger_mismatch: {
    label: "Approved records differ",
    explanation: "Rejected, reassigned, or missing rows prevent the approved records from matching the statement.",
  },
  ready: {
    label: "Ready to reconcile",
    explanation: "The statement movement and approved records both match the closing balance.",
  },
  reconciled: {
    label: "Reconciled",
    explanation: "This closing balance is now the trusted account balance for the statement date.",
  },
};

export function ImportsView({ data, loading, money, referenceData }: ImportsViewProps) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadAccountId, setUploadAccountId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"pending" | "credits" | "approved" | "rejected" | "all">("pending");
  const [editing, setEditing] = useState<ImportCandidate | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editPayee, setEditPayee] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDirection, setEditDirection] = useState<"debit" | "credit">("debit");
  const [editAccountId, setEditAccountId] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editSplits, setEditSplits] = useState<Array<{ id: string; categoryId: string; amount: string }>>([]);
  const [rememberMerchantRule, setRememberMerchantRule] = useState(false);
  const [rejectRequest, setRejectRequest] = useState<{ ids: string[]; label: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("Not a valid transaction");
  const [resetRequest, setResetRequest] = useState<ImportCandidate | null>(null);
  const [reconciling, setReconciling] = useState<ImportArtifact | null>(null);
  const [reconcileAccountId, setReconcileAccountId] = useState("");
  const [reconcilePeriodStart, setReconcilePeriodStart] = useState("");
  const [reconcilePeriodEnd, setReconcilePeriodEnd] = useState("");
  const [reconcileOpening, setReconcileOpening] = useState("");
  const [reconcileClosing, setReconcileClosing] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const accounts = referenceData?.accounts ?? [];
  const categories = referenceData?.categories ?? [];
  const primarySalaryAccount = accounts.find(
    (account) => account.accountClass === "asset" && account.name.toLowerCase() === "primary salary account",
  );
  const reconciliationAccount = accounts.find((account) => account.id === reconcileAccountId);

  useEffect(() => {
    if (!editing && !rejectRequest && !resetRequest && !reconciling) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setEditing(null);
      setRejectRequest(null);
      setResetRequest(null);
      setReconciling(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [editing, rejectRequest, resetRequest, reconciling]);

  useEffect(() => {
    if (!uploadAccountId && primarySalaryAccount) {
      setUploadAccountId(primarySalaryAccount.id);
    }
  }, [primarySalaryAccount, uploadAccountId]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["imports"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["expenses"] }),
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
    ]);
  };
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a statement file first.");
      return uploadStatement(file, uploadAccountId || undefined);
    },
    onSuccess: async (result) => {
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setActionError(result.duplicate ? "This exact statement was already imported. No rows were duplicated." : null);
      await refresh();
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : "Statement upload failed."),
  });
  const parseMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password?: string }) => parseStatementArtifact(id, { password }),
    onSuccess: async () => {
      setActionError(null);
      await refresh();
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : "Statement extraction failed."),
  });
  const assignmentMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateImportCandidateRequest }) =>
      updateImportCandidate(id, input),
    onMutate: () => setActionError(null),
    onSuccess: refresh,
    onError: (error) => setActionError(error instanceof Error ? error.message : "Assignment update failed."),
  });
  const editMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateImportCandidateRequest }) =>
      updateImportCandidate(id, input),
    onSuccess: async () => {
      setEditing(null);
      setActionError(null);
      await refresh();
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : "Candidate update failed."),
  });
  const approveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (primarySalaryAccount) {
        const selectedIds = new Set(ids);
        const unassigned = (data?.candidates ?? []).filter(
          (candidate) => selectedIds.has(candidate.id) && candidate.accountId == null,
        );
        await Promise.all(
          unassigned.map((candidate) =>
            updateImportCandidate(candidate.id, {
              accountId: primarySalaryAccount.id,
            }),
          ),
        );
      }
      return approveImportCandidates({ ids });
    },
    onSuccess: async () => {
      setSelected(new Set());
      setActionError(null);
      await refresh();
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : "Approval failed."),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason: string }) => rejectImportCandidates({ ids, reason }),
    onSuccess: async () => {
      setSelected(new Set());
      setRejectRequest(null);
      setActionError(null);
      await refresh();
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : "Rejection failed."),
  });
  const resetMutation = useMutation({
    mutationFn: (id: string) => resetImportCandidatesToPending({ ids: [id] }),
    onSuccess: async () => {
      setResetRequest(null);
      setActionError(null);
      await refresh();
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : "Candidate reset failed."),
  });
  const duplicateMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "keep_distinct" | "merge" }) =>
      resolveImportDuplicate(id, { action }),
    onSuccess: async () => {
      setActionError(null);
      await refresh();
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : "Duplicate resolution failed."),
  });
  const reconciliationDetailsMutation = useMutation({
    mutationFn: ({
      id,
      accountId,
      periodStart,
      periodEnd,
      openingBalancePaise,
      closingBalancePaise,
    }: {
      id: string;
      accountId: string;
      periodStart: string;
      periodEnd: string;
      openingBalancePaise: number;
      closingBalancePaise: number;
    }) =>
      updateStatementReconciliation(id, {
        accountId,
        periodStart,
        periodEnd,
        openingBalancePaise,
        closingBalancePaise,
      }),
    onSuccess: async (artifact) => {
      setReconciling(artifact);
      setActionError(null);
      await refresh();
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : "Balance details could not be saved."),
  });
  const reconcileMutation = useMutation({
    mutationFn: (id: string) => reconcileStatement(id),
    onSuccess: async (artifact) => {
      setReconciling(artifact);
      setActionError(null);
      await refresh();
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : "Statement reconciliation failed."),
  });

  const candidates = useMemo(
    () =>
      (data?.candidates ?? []).filter(
        (candidate) =>
          filter === "all" || (filter === "credits" ? candidate.direction === "credit" : candidate.status === filter),
      ),
    [data, filter],
  );
  const pendingVisible = candidates.filter((candidate) => candidate.status === "pending");
  const candidateAccountId = (candidate: ImportCandidate) => candidate.accountId ?? primarySalaryAccount?.id ?? null;
  const candidateIsReady = (candidate: ImportCandidate) =>
    candidate.status === "pending" &&
    candidate.occurredOn != null &&
    candidateAccountId(candidate) != null &&
    (candidate.direction === "credit" || candidate.categoryId != null || candidate.splits.length >= 2) &&
    candidate.duplicateResolution !== "suspected";
  const readyPendingVisible = pendingVisible.filter(candidateIsReady);
  const allReadySelected =
    readyPendingVisible.length > 0 && readyPendingVisible.every((candidate) => selected.has(candidate.id));
  const assignmentIsPending = (id: string) => assignmentMutation.isPending && assignmentMutation.variables?.id === id;

  function changeFilter(nextFilter: "pending" | "credits" | "approved" | "rejected" | "all") {
    setFilter(nextFilter);
    setSelected(new Set());
  }

  function beginEdit(candidate: ImportCandidate) {
    setEditing(candidate);
    setEditDate(candidate.occurredOn ?? "");
    setEditPayee(candidate.payee);
    setEditAmount(String(candidate.amountPaise / 100));
    setEditDirection(candidate.direction);
    setEditAccountId(candidateAccountId(candidate) ?? "");
    setEditCategoryId(candidate.categoryId ?? "");
    setEditSplits(
      candidate.splits.map((split) => ({
        id: crypto.randomUUID(),
        categoryId: split.categoryId,
        amount: String(split.amountPaise / 100),
      })),
    );
    setRememberMerchantRule(false);
    setActionError(null);
  }

  function saveEdit() {
    if (!editing) return;
    const amountPaise = rupeesToPaise(editAmount);
    if (!editDate || !editPayee.trim() || !amountPaise || !editAccountId) {
      setActionError("Date, payee, positive amount, and account are required.");
      return;
    }
    const splits = editSplits.map((split) => ({
      categoryId: split.categoryId,
      amountPaise: rupeesToPaise(split.amount) ?? 0,
    }));
    if (editDirection === "debit" && !editCategoryId && splits.length === 0) {
      setActionError("Debit transactions require an expense category.");
      return;
    }
    if (
      splits.length > 0 &&
      (splits.length < 2 ||
        splits.some((split) => !split.categoryId || split.amountPaise <= 0) ||
        splits.reduce((sum, split) => sum + split.amountPaise, 0) !== amountPaise)
    ) {
      setActionError("Use at least two complete split lines whose amounts equal the transaction total.");
      return;
    }
    editMutation.mutate({
      id: editing.id,
      input: {
        occurredOn: editDate,
        payee: editPayee,
        amountPaise,
        direction: editDirection,
        accountId: editAccountId,
        categoryId: editDirection === "debit" && splits.length === 0 ? editCategoryId : null,
        splits: editDirection === "debit" && splits.length > 0 ? splits : null,
        rememberMerchantRule,
      },
    });
  }

  function toggleCandidate(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function beginReject(ids: string[], label: string) {
    setRejectReason("Not a valid transaction");
    setRejectRequest({ ids, label });
    setActionError(null);
  }

  function rejectCandidate(candidate: ImportCandidate) {
    beginReject([candidate.id], candidate.payee);
  }

  function submitReject() {
    if (!rejectRequest) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) {
      setActionError("Enter a rejection reason.");
      return;
    }
    rejectMutation.mutate({ ids: rejectRequest.ids, reason });
  }

  function retryExtraction(id: string, parserMessage: string | null) {
    const requiresPassword = parserMessage?.toLowerCase().includes("password") ?? false;
    if (!requiresPassword) {
      parseMutation.mutate({ id });
      return;
    }
    const password = window.prompt("Enter this PDF's password. It is used once in memory and is never saved.");
    if (password != null) {
      parseMutation.mutate({ id, password });
    }
  }

  function beginReconciliation(artifact: ImportArtifact) {
    setReconciling(artifact);
    setReconcileAccountId(artifact.accountId ?? primarySalaryAccount?.id ?? "");
    setReconcilePeriodStart(artifact.reconciliation.periodStart ?? "");
    setReconcilePeriodEnd(artifact.reconciliation.periodEnd ?? "");
    setReconcileOpening(
      artifact.reconciliation.openingBalancePaise == null
        ? ""
        : String(artifact.reconciliation.openingBalancePaise / 100),
    );
    setReconcileClosing(
      artifact.reconciliation.closingBalancePaise == null
        ? ""
        : String(artifact.reconciliation.closingBalancePaise / 100),
    );
    setActionError(null);
  }

  function saveReconciliationDetails() {
    if (!reconciling) return;
    const openingBalancePaise = signedRupeesToPaise(reconcileOpening);
    const closingBalancePaise = signedRupeesToPaise(reconcileClosing);
    if (
      !reconcileAccountId ||
      !reconcilePeriodStart ||
      !reconcilePeriodEnd ||
      openingBalancePaise == null ||
      closingBalancePaise == null
    ) {
      setActionError("Account, statement dates, opening balance, and closing balance are required.");
      return;
    }
    reconciliationDetailsMutation.mutate({
      id: reconciling.id,
      accountId: reconcileAccountId,
      periodStart: reconcilePeriodStart,
      periodEnd: reconcilePeriodEnd,
      openingBalancePaise,
      closingBalancePaise,
    });
  }

  if (loading && !data) {
    return <section className="panel loading-panel">Loading the local review queue...</section>;
  }

  return (
    <div className="imports-view">
      <section className="imports-hero">
        <div>
          <p className="eyebrow">STATEMENT INBOX / APPROVAL GATE / FINANCIAL RECORDS</p>
          <h2>Nothing posts without your approval.</h2>
          <p>
            Upload bank or card statements, review every detected row, correct the account or category, then approve
            selected transactions into your balanced financial records.
          </p>
        </div>
        <div className="import-safety">
          <span>LOCAL-ONLY EVIDENCE</span>
          <strong>Files stay on this Mac</strong>
          <small>CSV, TSV, PDF, XLS and XLSX extract locally. Scanned PDFs use Apple Vision OCR on this Mac.</small>
        </div>
      </section>

      <section className="import-kpis">
        <article>
          <span>Pending review</span>
          <strong>{data?.pendingCount ?? 0}</strong>
          <small>Not recorded yet</small>
        </article>
        <article>
          <span>Approved</span>
          <strong>{data?.approvedCount ?? 0}</strong>
          <small>Posted with audit trail</small>
        </article>
        <article>
          <span>Rejected</span>
          <strong>{data?.rejectedCount ?? 0}</strong>
          <small>Retained as evidence</small>
        </article>
        <article>
          <span>Source files</span>
          <strong>{data?.artifacts.length ?? 0}</strong>
          <small>Content-hash deduplicated</small>
        </article>
      </section>

      <section className="panel import-upload-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ADD SOURCE</p>
            <h2>Upload a statement</h2>
          </div>
          <span className="status-chip">MAX 10 MB</span>
        </div>
        <form
          className="import-upload-form"
          onSubmit={(event) => {
            event.preventDefault();
            setActionError(null);
            uploadMutation.mutate();
          }}
        >
          <label className="statement-drop">
            <input
              accept=".csv,.tsv,.pdf,.xls,.xlsx"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              ref={fileInput}
              type="file"
            />
            <span>{file ? file.name : "Choose CSV, TSV, PDF, XLS or XLSX"}</span>
            <small>
              {file ? `${Math.ceil(file.size / 1024)} KB selected` : "The original file is preserved unchanged"}
            </small>
          </label>
          <label>
            Statement account
            <select onChange={(event) => setUploadAccountId(event.target.value)} value={uploadAccountId}>
              <option value="">Choose during review</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <button className="add-button" disabled={uploadMutation.isPending || !file} type="submit">
            {uploadMutation.isPending ? "Securing file..." : "Upload and detect"}
          </button>
        </form>
        {actionError && <p className="form-error import-message">{actionError}</p>}
      </section>

      <section className="panel import-sources-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SOURCE REGISTER</p>
            <h2>Recent statements</h2>
          </div>
        </div>
        <div className="import-artifact-list">
          {(data?.artifacts ?? []).length === 0 ? (
            <p className="empty-state">No statement files have been uploaded yet.</p>
          ) : (
            data?.artifacts.map((artifact) => (
              <article key={artifact.id}>
                <div>
                  <strong>{artifact.filename}</strong>
                  <small>
                    {new Date(artifact.createdAt).toLocaleString("en-IN")} · {Math.ceil(artifact.sizeBytes / 1024)} KB ·{" "}
                    {artifact.accountName ?? "Account not assigned"}
                  </small>
                </div>
                <span className={`artifact-status ${artifact.status}`}>{artifact.status.replace("_", " ")}</span>
                <div className="artifact-counts">
                  <b>{artifact.pendingCount} pending</b>
                  <span>{artifact.approvedCount} posted</span>
                </div>
                <div className="artifact-parser">
                  <div className="artifact-parser-copy">
                    <small>{artifact.parserMessage}</small>
                    <span className={`reconciliation-status ${artifact.reconciliation.status}`}>
                      {reconciliationCopy[artifact.reconciliation.status].label}
                    </span>
                  </div>
                  {(artifact.status === "failed" || artifact.status === "needs_parser") && (
                    <button
                      className="artifact-parse-button"
                      disabled={parseMutation.isPending}
                      onClick={() => retryExtraction(artifact.id, artifact.parserMessage)}
                      type="button"
                    >
                      {parseMutation.isPending
                        ? "Extracting..."
                        : artifact.parserMessage?.toLowerCase().includes("password")
                          ? "Unlock PDF"
                          : "Retry extraction"}
                    </button>
                  )}
                  {artifact.status === "parsed" && (
                    <button
                      className="artifact-reconcile-button"
                      onClick={() => beginReconciliation(artifact)}
                      type="button"
                    >
                      {artifact.reconciliation.status === "reconciled" ? "View balance" : "Review balance"}
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="panel import-review-panel">
        <div className="section-heading import-review-heading">
          <div>
            <p className="eyebrow">HUMAN REVIEW REQUIRED</p>
            <h2>Transaction candidates</h2>
          </div>
          <div className="import-filter">
            <button
              className={filter === "pending" ? "active" : ""}
              onClick={() => changeFilter("pending")}
              type="button"
            >
              Pending <span>{data?.pendingCount ?? 0}</span>
            </button>
            <button
              className={filter === "credits" ? "active" : ""}
              onClick={() => changeFilter("credits")}
              type="button"
            >
              Credits{" "}
              <span>{data?.candidates.filter((candidate) => candidate.direction === "credit").length ?? 0}</span>
            </button>
            <button
              className={filter === "approved" ? "active" : ""}
              onClick={() => changeFilter("approved")}
              type="button"
            >
              Approved <span>{data?.approvedCount ?? 0}</span>
            </button>
            <button
              className={filter === "rejected" ? "active" : ""}
              onClick={() => changeFilter("rejected")}
              type="button"
            >
              Rejected <span>{data?.rejectedCount ?? 0}</span>
            </button>
            <button className={filter === "all" ? "active" : ""} onClick={() => changeFilter("all")} type="button">
              All <span>{(data?.pendingCount ?? 0) + (data?.approvedCount ?? 0) + (data?.rejectedCount ?? 0)}</span>
            </button>
          </div>
        </div>

        {(filter === "pending" || filter === "credits" || filter === "all") && (
          <div className="import-bulk-bar">
            <label>
              <input
                checked={allReadySelected}
                onChange={() =>
                  setSelected(
                    allReadySelected ? new Set() : new Set(readyPendingVisible.map((candidate) => candidate.id)),
                  )
                }
                type="checkbox"
              />
              Select all ready
            </label>
            <span>{selected.size} selected</span>
            <button
              disabled={selected.size === 0 || approveMutation.isPending}
              onClick={() => approveMutation.mutate([...selected])}
              type="button"
            >
              Approve selected
            </button>
            <button
              className="danger-outline"
              disabled={selected.size === 0 || rejectMutation.isPending}
              onClick={() => beginReject([...selected], `${selected.size} selected transactions`)}
              type="button"
            >
              Reject
            </button>
          </div>
        )}
        {actionError && <p className="form-error import-review-error">{actionError}</p>}

        <div className="import-table-wrap">
          <table className="import-table">
            <colgroup>
              <col className="candidate-select-column" />
              <col className="candidate-source-column" />
              <col className="candidate-description-column" />
              <col className="candidate-amount-column" />
              <col className="candidate-assignment-column" />
              <col className="candidate-signal-column" />
              <col className="candidate-actions-column" />
            </colgroup>
            <thead>
              <tr>
                <th aria-label="Select" />
                <th>Date / source</th>
                <th>Detected transaction</th>
                <th>Amount</th>
                <th>Account / category</th>
                <th>Review signal</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 ? (
                <tr>
                  <td className="empty-state" colSpan={7}>
                    {filter === "pending"
                      ? "No transactions are waiting for approval."
                      : filter === "credits"
                        ? "No credit transactions were detected."
                        : filter === "approved"
                          ? "No transactions have been approved yet."
                          : filter === "rejected"
                            ? "No transactions have been rejected."
                            : "No candidates available."}
                  </td>
                </tr>
              ) : (
                candidates.map((candidate) => (
                  <tr
                    className={candidate.status !== "pending" ? `candidate-${candidate.status}` : ""}
                    key={candidate.id}
                  >
                    <td className="candidate-select-cell">
                      <input
                        aria-label={`Select ${candidate.payee}`}
                        checked={selected.has(candidate.id)}
                        disabled={!candidateIsReady(candidate)}
                        onChange={() => toggleCandidate(candidate.id)}
                        type="checkbox"
                      />
                    </td>
                    <td className="candidate-source">
                      <strong>{candidate.occurredOn ? formatDate(candidate.occurredOn) : "Date required"}</strong>
                      <small>
                        {candidate.filename} · row {candidate.sourceRow}
                      </small>
                    </td>
                    <td className="candidate-description">
                      <strong>{candidate.payee}</strong>
                      <small className={candidate.direction === "debit" ? "debit-label" : "credit-label"}>
                        {candidate.direction}
                      </small>
                    </td>
                    <td className={`candidate-amount ${candidate.direction === "debit" ? "negative" : "positive"}`}>
                      <strong>
                        {candidate.direction === "debit" ? "-" : "+"}
                        {money(candidate.amountPaise)}
                      </strong>
                    </td>
                    <td className="candidate-assignment">
                      {candidate.status === "pending" ? (
                        <>
                          <label>
                            <span>Account</span>
                            <select
                              aria-label={`Account for ${candidate.payee}`}
                              defaultValue={candidateAccountId(candidate) ?? ""}
                              disabled={assignmentIsPending(candidate.id)}
                              key={`account-${candidate.id}-${candidate.version}`}
                              onChange={(event) =>
                                assignmentMutation.mutate({
                                  id: candidate.id,
                                  input: { accountId: event.target.value || null },
                                })
                              }
                            >
                              <option value="">Choose account</option>
                              <optgroup label="Bank accounts and wallets">
                                {accounts
                                  .filter((account) => account.accountClass === "asset")
                                  .map((account) => (
                                    <option key={account.id} value={account.id}>
                                      {account.name}
                                    </option>
                                  ))}
                              </optgroup>
                              {candidate.direction === "debit" && (
                                <optgroup label="Credit cards and liabilities">
                                  {accounts
                                    .filter((account) => account.accountClass === "liability")
                                    .map((account) => (
                                      <option key={account.id} value={account.id}>
                                        {account.name}
                                      </option>
                                    ))}
                                </optgroup>
                              )}
                            </select>
                          </label>
                          {candidate.direction === "debit" ? (
                            <label>
                              <span>Expense category</span>
                              <select
                                aria-label={`Expense category for ${candidate.payee}`}
                                defaultValue={candidate.categoryId ?? ""}
                                disabled={assignmentIsPending(candidate.id)}
                                key={`category-${candidate.id}-${candidate.version}`}
                                onChange={(event) =>
                                  assignmentMutation.mutate({
                                    id: candidate.id,
                                    input: { categoryId: event.target.value || null, splits: null },
                                  })
                                }
                              >
                                <option value="">Choose category</option>
                                {categories.map((category) => (
                                  <option key={category.id} value={category.id}>
                                    {category.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <small>Credit / income</small>
                          )}
                          <small>
                            {assignmentIsPending(candidate.id)
                              ? "Saving selection..."
                              : candidate.duplicateResolution === "suspected"
                                ? "Resolve duplicate before approval"
                                : candidateIsReady(candidate)
                                  ? "Ready to approve"
                                  : "Choose required fields"}
                          </small>
                          {candidate.splits.length > 0 && (
                            <small>
                              Split:{" "}
                              {candidate.splits
                                .map((split) => `${split.categoryName ?? "Category"} ${money(split.amountPaise)}`)
                                .join(" + ")}
                            </small>
                          )}
                        </>
                      ) : (
                        <>
                          <strong>{candidate.accountName ?? "Account not assigned"}</strong>
                          <small>
                            {candidate.direction === "debit" ? (candidate.categoryName ?? "Uncategorised") : "Income"}
                          </small>
                        </>
                      )}
                    </td>
                    <td className="candidate-signal">
                      <span
                        className={`confidence ${candidate.confidence >= 75 ? "high" : "review"}`}
                        title={`${candidate.confidence}% confidence`}
                      >
                        {candidate.confidence}%
                      </span>
                      <small>{candidate.warnings[0] ?? candidate.status}</small>
                      {candidate.duplicateResolution === "suspected" && (
                        <small className="duplicate-warning">
                          Exact match in {candidate.duplicateFilename ?? "another source"}:{" "}
                          {candidate.duplicatePayee ?? "same transaction"}
                        </small>
                      )}
                    </td>
                    <td className="candidate-actions">
                      {candidate.status === "pending" ? (
                        <div className="candidate-action-group">
                          <button
                            className="candidate-approve"
                            disabled={!candidateIsReady(candidate) || approveMutation.isPending}
                            onClick={() => approveMutation.mutate([candidate.id])}
                            title={
                              candidateIsReady(candidate)
                                ? "Approve and add this transaction to your records"
                                : "Choose the required account and expense category first"
                            }
                            type="button"
                          >
                            {approveMutation.isPending && approveMutation.variables?.includes(candidate.id)
                              ? "Approving..."
                              : "Approve"}
                          </button>
                          <button
                            className="candidate-edit"
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                            onClick={() => beginEdit(candidate)}
                            type="button"
                          >
                            Edit details
                          </button>
                          {candidate.duplicateResolution === "suspected" && (
                            <>
                              <button
                                className="candidate-merge"
                                disabled={duplicateMutation.isPending}
                                onClick={() => duplicateMutation.mutate({ id: candidate.id, action: "merge" })}
                                type="button"
                              >
                                Merge duplicate
                              </button>
                              <button
                                className="candidate-distinct"
                                disabled={duplicateMutation.isPending}
                                onClick={() => duplicateMutation.mutate({ id: candidate.id, action: "keep_distinct" })}
                                type="button"
                              >
                                Keep separate
                              </button>
                            </>
                          )}
                          <button
                            className="candidate-reject"
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                            onClick={() => rejectCandidate(candidate)}
                            type="button"
                          >
                            {rejectMutation.isPending && rejectMutation.variables?.ids.includes(candidate.id)
                              ? "Rejecting..."
                              : "Reject"}
                          </button>
                        </div>
                      ) : (
                        <div className="candidate-action-group">
                          <span className={`candidate-status ${candidate.status}`}>{candidate.status}</span>
                          <button
                            className="candidate-reset"
                            disabled={resetMutation.isPending}
                            onClick={() => {
                              setActionError(null);
                              setResetRequest(candidate);
                            }}
                            type="button"
                          >
                            {resetMutation.isPending && resetMutation.variables === candidate.id
                              ? "Restoring..."
                              : "Move to pending"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {reconciling &&
        createPortal(
          <div className="modal-backdrop" role="presentation">
            <section
              aria-labelledby="statement-reconciliation-title"
              aria-modal="true"
              className="wealth-modal reconciliation-modal"
              role="dialog"
            >
              <div className="modal-title">
                <div>
                  <p className="eyebrow">STATEMENT BALANCE CONTROL</p>
                  <h2 id="statement-reconciliation-title">Prove the closing balance</h2>
                  <small>{reconciling.filename}</small>
                </div>
                <button onClick={() => setReconciling(null)} type="button">
                  Close
                </button>
              </div>

              <div className={`reconciliation-banner ${reconciling.reconciliation.status}`}>
                <span>{reconciliationCopy[reconciling.reconciliation.status].label}</span>
                <strong>{reconciliationCopy[reconciling.reconciliation.status].explanation}</strong>
              </div>

              <div className="reconciliation-fields">
                <label className="wide">
                  Statement account
                  <select
                    disabled={reconciling.reconciliation.status === "reconciled"}
                    onChange={(event) => setReconcileAccountId(event.target.value)}
                    value={reconcileAccountId}
                  >
                    <option value="">Choose account</option>
                    <optgroup label="Bank accounts and wallets">
                      {accounts
                        .filter((account) => account.accountClass === "asset")
                        .map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                    </optgroup>
                    <optgroup label="Credit cards and loans">
                      {accounts
                        .filter((account) => account.accountClass === "liability")
                        .map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </label>
                <label>
                  Period starts
                  <input
                    disabled={reconciling.reconciliation.status === "reconciled"}
                    onChange={(event) => setReconcilePeriodStart(event.target.value)}
                    type="date"
                    value={reconcilePeriodStart}
                  />
                </label>
                <label>
                  Period ends
                  <input
                    disabled={reconciling.reconciliation.status === "reconciled"}
                    onChange={(event) => setReconcilePeriodEnd(event.target.value)}
                    type="date"
                    value={reconcilePeriodEnd}
                  />
                </label>
                <label>
                  Opening balance (INR)
                  <input
                    disabled={reconciling.reconciliation.status === "reconciled"}
                    inputMode="decimal"
                    onChange={(event) => setReconcileOpening(event.target.value)}
                    placeholder="0.00"
                    value={reconcileOpening}
                  />
                </label>
                <label>
                  Statement closing balance (INR)
                  <input
                    disabled={reconciling.reconciliation.status === "reconciled"}
                    inputMode="decimal"
                    onChange={(event) => setReconcileClosing(event.target.value)}
                    placeholder="0.00"
                    value={reconcileClosing}
                  />
                </label>
              </div>

              <div className="reconciliation-equation">
                <article>
                  <span>Opening balance</span>
                  <strong>
                    {reconciling.reconciliation.openingBalancePaise == null
                      ? "Not entered"
                      : money(reconciling.reconciliation.openingBalancePaise)}
                  </strong>
                </article>
                <i>+</i>
                <article>
                  <span>Approved movement</span>
                  <strong>{money(reconciling.reconciliation.recognizedMovementPaise)}</strong>
                  <small>{reconciling.reconciliation.pendingCount} rows still pending</small>
                </article>
                <i>=</i>
                <article>
                  <span>Calculated close</span>
                  <strong>
                    {reconciling.reconciliation.expectedClosingBalancePaise == null
                      ? "Not available"
                      : money(reconciling.reconciliation.expectedClosingBalancePaise)}
                  </strong>
                </article>
                <i>vs</i>
                <article className={reconciling.reconciliation.ledgerDifferencePaise === 0 ? "matched" : "unmatched"}>
                  <span>Statement close</span>
                  <strong>
                    {reconciling.reconciliation.closingBalancePaise == null
                      ? "Not entered"
                      : money(reconciling.reconciliation.closingBalancePaise)}
                  </strong>
                </article>
              </div>

              <div className="reconciliation-checks">
                <article
                  className={reconciling.reconciliation.extractionDifferencePaise === 0 ? "check-pass" : "check-fail"}
                >
                  <span>Extraction check</span>
                  <strong>
                    {reconciling.reconciliation.extractionDifferencePaise == null
                      ? "Needs balance details"
                      : reconciling.reconciliation.extractionDifferencePaise === 0
                        ? "All source rows reproduce the statement"
                        : `${money(Math.abs(reconciling.reconciliation.extractionDifferencePaise))} difference`}
                  </strong>
                  <small>Uses every debit and credit detected in the uploaded file.</small>
                </article>
                <article
                  className={reconciling.reconciliation.ledgerDifferencePaise === 0 ? "check-pass" : "check-fail"}
                >
                  <span>Approved-record check</span>
                  <strong>
                    {reconciling.reconciliation.ledgerDifferencePaise == null
                      ? "Complete the review first"
                      : reconciling.reconciliation.ledgerDifferencePaise === 0
                        ? "Approved records match the statement"
                        : `${money(Math.abs(reconciling.reconciliation.ledgerDifferencePaise))} difference`}
                  </strong>
                  <small>
                    {reconciling.reconciliation.rejectedCount} rejected · {reconciling.reconciliation.pendingCount}{" "}
                    pending
                  </small>
                </article>
              </div>

              <p className="reconciliation-impact">
                <strong>What happens when reconciled:</strong>{" "}
                {reconciliationAccount?.id === "account-primary-bank"
                  ? "the statement closing balance becomes this month’s trusted closing balance and the next month’s carryover."
                  : reconciliationAccount?.accountClass === "liability"
                    ? "the statement closing balance updates the loan or credit-card principal."
                    : "the statement is locked as reviewed evidence for this account."}
              </p>
              {actionError && <p className="form-error">{actionError}</p>}
              <div className="modal-actions reconciliation-actions">
                <button onClick={() => setReconciling(null)} type="button">
                  Close
                </button>
                {reconciling.reconciliation.status !== "reconciled" && (
                  <button
                    disabled={reconciliationDetailsMutation.isPending}
                    onClick={saveReconciliationDetails}
                    type="button"
                  >
                    {reconciliationDetailsMutation.isPending ? "Saving..." : "Save balance details"}
                  </button>
                )}
                <button
                  className="add-button"
                  disabled={!reconciling.reconciliation.canReconcile || reconcileMutation.isPending}
                  onClick={() => reconcileMutation.mutate(reconciling.id)}
                  title={
                    reconciling.reconciliation.canReconcile
                      ? "Use this verified closing balance"
                      : "Resolve the highlighted difference before reconciling"
                  }
                  type="button"
                >
                  {reconcileMutation.isPending
                    ? "Reconciling..."
                    : reconciling.reconciliation.status === "reconciled"
                      ? "Balance reconciled"
                      : "Reconcile account"}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
      {editing &&
        createPortal(
          <div className="modal-backdrop" role="presentation">
            <section
              aria-labelledby="candidate-editor-title"
              aria-modal="true"
              className="wealth-modal import-editor"
              role="dialog"
            >
              <div className="modal-title">
                <div>
                  <p className="eyebrow">REVIEW SOURCE ROW {editing.sourceRow}</p>
                  <h2 id="candidate-editor-title">Correct before approval</h2>
                </div>
                <button onClick={() => setEditing(null)} type="button">
                  Close
                </button>
              </div>
              <div className="import-editor-grid">
                <label>
                  Date
                  <input onChange={(event) => setEditDate(event.target.value)} type="date" value={editDate} />
                </label>
                <label>
                  Direction
                  <select
                    onChange={(event) => setEditDirection(event.target.value as "debit" | "credit")}
                    value={editDirection}
                  >
                    <option value="debit">Debit / expense</option>
                    <option value="credit">Credit / income</option>
                  </select>
                </label>
                <label className="wide">
                  Payee or merchant
                  <input onChange={(event) => setEditPayee(event.target.value)} value={editPayee} />
                </label>
                <label>
                  Amount (INR)
                  <input
                    inputMode="decimal"
                    onChange={(event) => setEditAmount(event.target.value)}
                    value={editAmount}
                  />
                </label>
                <label>
                  Account
                  <select onChange={(event) => setEditAccountId(event.target.value)} value={editAccountId}>
                    <option value="">Choose account</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
                {editDirection === "debit" && (
                  <label className="wide">
                    {editSplits.length > 0 ? "Split expense" : "Expense category"}
                    <select
                      disabled={editSplits.length > 0}
                      onChange={(event) => setEditCategoryId(event.target.value)}
                      value={editCategoryId}
                    >
                      <option value="">Choose category</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {editDirection === "debit" && (
                  <div className="wide split-editor">
                    <div className="split-editor-heading">
                      <strong>Category split</strong>
                      <button
                        onClick={() => {
                          if (editSplits.length > 0) {
                            setEditSplits([]);
                          } else {
                            setEditCategoryId("");
                            setEditSplits([
                              { id: crypto.randomUUID(), categoryId: "", amount: "" },
                              { id: crypto.randomUUID(), categoryId: "", amount: "" },
                            ]);
                          }
                        }}
                        type="button"
                      >
                        {editSplits.length > 0 ? "Use one category" : "Split transaction"}
                      </button>
                    </div>
                    {editSplits.map((split, index) => (
                      <div className="split-editor-row" key={split.id}>
                        <select
                          aria-label={`Split ${index + 1} category`}
                          onChange={(event) =>
                            setEditSplits((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, categoryId: event.target.value } : item,
                              ),
                            )
                          }
                          value={split.categoryId}
                        >
                          <option value="">Choose category</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label={`Split ${index + 1} amount in INR`}
                          inputMode="decimal"
                          onChange={(event) =>
                            setEditSplits((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, amount: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="Amount in INR"
                          value={split.amount}
                        />
                        <button
                          disabled={editSplits.length <= 2}
                          onClick={() =>
                            setEditSplits((current) => current.filter((_, itemIndex) => itemIndex !== index))
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    {editSplits.length > 0 && editSplits.length < 20 && (
                      <button
                        className="split-add-line"
                        onClick={() =>
                          setEditSplits((current) => [
                            ...current,
                            { id: crypto.randomUUID(), categoryId: "", amount: "" },
                          ])
                        }
                        type="button"
                      >
                        + Add split line
                      </button>
                    )}
                  </div>
                )}
                {editDirection === "debit" && editSplits.length === 0 && (
                  <label className="wide remember-rule">
                    <input
                      checked={rememberMerchantRule}
                      onChange={(event) => setRememberMerchantRule(event.target.checked)}
                      type="checkbox"
                    />
                    Remember this merchant’s account and category for future imports
                  </label>
                )}
              </div>
              <div className="source-evidence">
                <span>ORIGINAL SOURCE VALUES</span>
                <dl>
                  {Object.entries(editing.source).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{value || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              {actionError && <p className="form-error">{actionError}</p>}
              <div className="modal-actions">
                <button onClick={() => setEditing(null)} type="button">
                  Cancel
                </button>
                <button className="add-button" disabled={editMutation.isPending} onClick={saveEdit} type="button">
                  {editMutation.isPending ? "Saving..." : "Save review"}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
      {rejectRequest &&
        createPortal(
          <div className="modal-backdrop" role="presentation">
            <section
              aria-labelledby="candidate-reject-title"
              aria-modal="true"
              className="wealth-modal reject-editor"
              role="dialog"
            >
              <div className="modal-title">
                <div>
                  <p className="eyebrow">REJECT IMPORT CANDIDATE</p>
                  <h2 id="candidate-reject-title">Confirm rejection</h2>
                </div>
                <button onClick={() => setRejectRequest(null)} type="button">
                  Close
                </button>
              </div>
              <p className="reject-target">{rejectRequest.label}</p>
              <label className="reject-reason-field">
                Reason
                <textarea onChange={(event) => setRejectReason(event.target.value)} rows={4} value={rejectReason} />
              </label>
              {actionError && <p className="form-error">{actionError}</p>}
              <div className="modal-actions">
                <button onClick={() => setRejectRequest(null)} type="button">
                  Cancel
                </button>
                <button
                  className="danger-button"
                  disabled={rejectMutation.isPending}
                  onClick={submitReject}
                  type="button"
                >
                  {rejectMutation.isPending ? "Rejecting..." : "Reject transaction"}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
      {resetRequest &&
        createPortal(
          <div className="modal-backdrop" role="presentation">
            <section
              aria-labelledby="candidate-reset-title"
              aria-modal="true"
              className="wealth-modal reject-editor"
              role="dialog"
            >
              <div className="modal-title">
                <div>
                  <p className="eyebrow">RESTORE IMPORT CANDIDATE</p>
                  <h2 id="candidate-reset-title">Move back to pending?</h2>
                </div>
                <button onClick={() => setResetRequest(null)} type="button">
                  Close
                </button>
              </div>
              <p className="reject-target">{resetRequest.payee}</p>
              <p>
                {resetRequest.status === "approved"
                  ? "The linked financial entry will be reversed. You can then edit and approve this transaction again."
                  : "The rejection will be cleared so this transaction can be reviewed again."}
              </p>
              {actionError && <p className="form-error">{actionError}</p>}
              <div className="modal-actions">
                <button onClick={() => setResetRequest(null)} type="button">
                  Cancel
                </button>
                <button
                  className="add-button"
                  disabled={resetMutation.isPending}
                  onClick={() => resetMutation.mutate(resetRequest.id)}
                  type="button"
                >
                  {resetMutation.isPending ? "Restoring..." : "Move to pending"}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}
