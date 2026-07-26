import type {
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
  rejectImportCandidates,
  updateImportCandidate,
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

export function ImportsView({ data, loading, money, referenceData }: ImportsViewProps) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadAccountId, setUploadAccountId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [editing, setEditing] = useState<ImportCandidate | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editPayee, setEditPayee] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDirection, setEditDirection] = useState<"debit" | "credit">("debit");
  const [editAccountId, setEditAccountId] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [rejectRequest, setRejectRequest] = useState<{ ids: string[]; label: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("Not a valid transaction");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing && !rejectRequest) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setEditing(null);
      setRejectRequest(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [editing, rejectRequest]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["imports"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger"] }),
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
    mutationFn: (ids: string[]) => approveImportCandidates({ ids }),
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

  const candidates = useMemo(
    () => (data?.candidates ?? []).filter((candidate) => filter === "all" || candidate.status === "pending"),
    [data, filter],
  );
  const pendingVisible = candidates.filter((candidate) => candidate.status === "pending");
  const accounts = referenceData?.accounts ?? [];
  const categories = referenceData?.categories ?? [];
  const candidateIsReady = (candidate: ImportCandidate) =>
    candidate.status === "pending" &&
    candidate.occurredOn != null &&
    candidate.accountId != null &&
    (candidate.direction === "credit" || candidate.categoryId != null);
  const readyPendingVisible = pendingVisible.filter(candidateIsReady);
  const allReadySelected =
    readyPendingVisible.length > 0 && readyPendingVisible.every((candidate) => selected.has(candidate.id));
  const assignmentIsPending = (id: string) => assignmentMutation.isPending && assignmentMutation.variables?.id === id;

  function beginEdit(candidate: ImportCandidate) {
    setEditing(candidate);
    setEditDate(candidate.occurredOn ?? "");
    setEditPayee(candidate.payee);
    setEditAmount(String(candidate.amountPaise / 100));
    setEditDirection(candidate.direction);
    setEditAccountId(candidate.accountId ?? "");
    setEditCategoryId(candidate.categoryId ?? "");
    setActionError(null);
  }

  function saveEdit() {
    if (!editing) return;
    const amountPaise = rupeesToPaise(editAmount);
    if (!editDate || !editPayee.trim() || !amountPaise || !editAccountId) {
      setActionError("Date, payee, positive amount, and account are required.");
      return;
    }
    if (editDirection === "debit" && !editCategoryId) {
      setActionError("Debit transactions require an expense category.");
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
        categoryId: editDirection === "debit" ? editCategoryId : null,
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

  if (loading && !data) {
    return <section className="panel loading-panel">Loading the local review queue...</section>;
  }

  return (
    <div className="imports-view">
      <section className="imports-hero">
        <div>
          <p className="eyebrow">STATEMENT INBOX / APPROVAL GATE / UNIFIED LEDGER</p>
          <h2>Nothing posts without your approval.</h2>
          <p>
            Upload bank or card statements, review every detected row, correct the account or category, then approve
            selected transactions into the balanced ledger.
          </p>
        </div>
        <div className="import-safety">
          <span>LOCAL-ONLY EVIDENCE</span>
          <strong>Files stay on this Mac</strong>
          <small>CSV, TSV, text PDFs, XLS and XLSX extract locally. Scanned PDFs are held for OCR.</small>
        </div>
      </section>

      <section className="import-kpis">
        <article>
          <span>Pending review</span>
          <strong>{data?.pendingCount ?? 0}</strong>
          <small>Not in the ledger</small>
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
                  <small>{artifact.parserMessage}</small>
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
            <button className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")} type="button">
              Pending
            </button>
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")} type="button">
              All
            </button>
          </div>
        </div>

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
                    {filter === "pending" ? "No transactions are waiting for approval." : "No candidates available."}
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
                              defaultValue={candidate.accountId ?? ""}
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
                                    input: { categoryId: event.target.value || null },
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
                              : candidateIsReady(candidate)
                                ? "Ready to approve"
                                : "Choose required fields"}
                          </small>
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
                                ? "Approve and post this transaction to the ledger"
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
                        <span className={`candidate-status ${candidate.status}`}>{candidate.status}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

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
                    Expense category
                    <select onChange={(event) => setEditCategoryId(event.target.value)} value={editCategoryId}>
                      <option value="">Choose category</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
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
    </div>
  );
}
