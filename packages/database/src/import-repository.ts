import { createHash, randomUUID } from "node:crypto";
import type { FinanceHeroDatabase } from "./encrypted-database";
import type { LedgerRepository } from "./ledger-repository";

export type ImportArtifactStatus = "parsed" | "needs_parser" | "failed";
export type ImportCandidateStatus = "pending" | "approved" | "rejected";

export interface ImportArtifactRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  accountId: string | null;
  accountName: string | null;
  status: ImportArtifactStatus;
  parserMessage: string | null;
  rowCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  createdAt: string;
}

export interface ImportArtifactSource {
  id: string;
  filename: string;
  contentHash: string;
  mimeType: string;
  accountId: string | null;
  approvedCount: number;
}

export interface ImportCandidateRecord {
  id: string;
  artifactId: string;
  filename: string;
  sourceRow: number;
  version: number;
  occurredOn: string | null;
  payee: string;
  amountPaise: number;
  direction: "debit" | "credit";
  accountId: string | null;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  status: ImportCandidateStatus;
  confidence: number;
  warnings: string[];
  source: Record<string, string>;
  transactionId: string | null;
  rejectionReason: string | null;
  duplicateOfCandidateId: string | null;
  duplicatePayee: string | null;
  duplicateFilename: string | null;
  duplicateConfidence: number | null;
  duplicateResolution: "none" | "suspected" | "distinct" | "merged";
  splits: Array<{ categoryId: string; categoryName: string | null; amountPaise: number }>;
  updatedAt: string;
}

export interface ImportQueueRecord {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  artifacts: ImportArtifactRecord[];
  candidates: ImportCandidateRecord[];
}

export interface CreateImportArtifactInput {
  filename: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  accountId?: string;
  status: ImportArtifactStatus;
  parserMessage?: string;
  rows: Array<{
    sourceRow: number;
    occurredOn: string | null;
    payee: string;
    amountPaise: number;
    direction: "debit" | "credit";
    categoryId?: string;
    confidence: number;
    warnings: string[];
    source: Record<string, string>;
  }>;
}

export interface UpdateImportCandidateInput {
  occurredOn?: string | null;
  payee?: string;
  amountPaise?: number;
  direction?: "debit" | "credit";
  accountId?: string | null;
  categoryId?: string | null;
  splits?: Array<{ categoryId: string; amountPaise: number }> | null;
  rememberMerchantRule?: boolean;
}

export type ResolveImportDuplicateAction = "keep_distinct" | "merge";

interface CandidateRow {
  id: string;
  artifactId: string;
  filename: string;
  sourceRow: number;
  version: number;
  occurredOn: string | null;
  payee: string;
  amountPaise: number;
  direction: "debit" | "credit";
  accountId: string | null;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  status: ImportCandidateStatus;
  confidence: number;
  warningsJson: string;
  sourceJson: string;
  transactionId: string | null;
  rejectionReason: string | null;
  normalizedPayee: string;
  fingerprint: string;
  duplicateOfCandidateId: string | null;
  duplicatePayee: string | null;
  duplicateFilename: string | null;
  duplicateConfidence: number | null;
  duplicateResolution: ImportCandidateRecord["duplicateResolution"];
  splitsJson: string;
  updatedAt: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizePayee(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\b(?:upi|imps|neft|rtgs|pos|p2a|p2m|payment|txn|transaction|ref|reference)\b/g, " ")
    .replace(/\d{6,}/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function candidateFingerprint(input: {
  occurredOn: string | null;
  amountPaise: number;
  direction: "debit" | "credit";
  accountId: string | null;
  normalizedPayee: string;
}): string {
  if (!input.occurredOn || !input.accountId || !input.normalizedPayee) return "";
  return createHash("sha256")
    .update([input.occurredOn, input.amountPaise, input.direction, input.accountId, input.normalizedPayee].join("|"))
    .digest("hex");
}

export class ImportRepository {
  constructor(
    private readonly database: FinanceHeroDatabase,
    private readonly ledger: LedgerRepository,
  ) {}

  private audit(action: string, entityType: string, entityId: string, detail: unknown, now: string) {
    this.database.connection
      .prepare(`
        INSERT INTO audit_events (id, action, entity_type, entity_id, detail_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(randomUUID(), action, entityType, entityId, JSON.stringify(detail), now);
  }

  private applyMerchantRule(input: {
    payee: string;
    direction: "debit" | "credit";
    accountId: string | null;
    categoryId: string | null;
  }): { accountId: string | null; categoryId: string | null; matched: boolean } {
    const normalized = normalizePayee(input.payee);
    if (!normalized) return { accountId: input.accountId, categoryId: input.categoryId, matched: false };
    const rule = this.database.connection
      .prepare(`
        SELECT id, account_id AS accountId, category_id AS categoryId
        FROM merchant_rules
        WHERE normalized_payee = ? AND direction = ?
      `)
      .get(normalized, input.direction) as
      | { id: string; accountId: string | null; categoryId: string | null }
      | undefined;
    if (!rule) return { accountId: input.accountId, categoryId: input.categoryId, matched: false };
    this.database.connection
      .prepare("UPDATE merchant_rules SET times_applied = times_applied + 1, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), rule.id);
    return {
      accountId: input.accountId ?? rule.accountId,
      categoryId: input.direction === "debit" ? (input.categoryId ?? rule.categoryId) : null,
      matched: true,
    };
  }

  private refreshDuplicateMatches(now: string) {
    const candidates = this.database.connection
      .prepare(`
        SELECT id, occurred_on AS occurredOn, amount_paise AS amountPaise, direction,
               account_id AS accountId, payee, normalized_payee AS normalizedPayee,
               fingerprint, duplicate_resolution AS duplicateResolution
               , status
        FROM import_candidates
        ORDER BY created_at, rowid
      `)
      .all() as Array<{
      id: string;
      occurredOn: string | null;
      amountPaise: number;
      direction: "debit" | "credit";
      accountId: string | null;
      payee: string;
      normalizedPayee: string;
      fingerprint: string;
      duplicateResolution: ImportCandidateRecord["duplicateResolution"];
      status: ImportCandidateStatus;
    }>;

    const firstByFingerprint = new Map<string, string>();
    const priorBySemanticKey = new Map<
      string,
      Array<{ id: string; occurredOn: string; status: ImportCandidateStatus }>
    >();
    const updateIdentity = this.database.connection.prepare(`
      UPDATE import_candidates
      SET normalized_payee = ?, fingerprint = ?, duplicate_of_candidate_id = ?,
          duplicate_confidence = ?, duplicate_resolution = ?, updated_at = ?
      WHERE id = ?
    `);
    for (const candidate of candidates) {
      const normalized = normalizePayee(candidate.payee);
      const fingerprint = candidateFingerprint({ ...candidate, normalizedPayee: normalized });
      const exactCanonicalId = fingerprint ? firstByFingerprint.get(fingerprint) : undefined;
      const semanticKey =
        candidate.accountId && normalized
          ? [candidate.accountId, candidate.direction, candidate.amountPaise, normalized].join("|")
          : "";
      const candidateDate = candidate.occurredOn ? Date.parse(`${candidate.occurredOn}T00:00:00Z`) : Number.NaN;
      const nearCanonical = semanticKey
        ? priorBySemanticKey
            .get(semanticKey)
            ?.find(
              (prior) =>
                prior.status !== "rejected" &&
                Number.isFinite(candidateDate) &&
                Math.abs(candidateDate - Date.parse(`${prior.occurredOn}T00:00:00Z`)) <= 2 * 86_400_000,
            )
        : undefined;
      const canonicalId = exactCanonicalId ?? nearCanonical?.id;
      const duplicateConfidence = exactCanonicalId ? 100 : nearCanonical ? 92 : null;
      const preservedResolution =
        candidate.duplicateResolution === "distinct" || candidate.duplicateResolution === "merged"
          ? candidate.duplicateResolution
          : canonicalId
            ? "suspected"
            : "none";
      updateIdentity.run(
        normalized,
        fingerprint,
        canonicalId ?? null,
        duplicateConfidence,
        preservedResolution,
        now,
        candidate.id,
      );
      if (fingerprint && candidate.status !== "rejected" && !firstByFingerprint.has(fingerprint)) {
        firstByFingerprint.set(fingerprint, candidate.id);
      }
      if (semanticKey && candidate.occurredOn) {
        const prior = priorBySemanticKey.get(semanticKey) ?? [];
        prior.push({ id: candidate.id, occurredOn: candidate.occurredOn, status: candidate.status });
        priorBySemanticKey.set(semanticKey, prior.slice(-10));
      }
    }
  }

  private saveMerchantRule(candidate: CandidateRow, now: string) {
    if (!candidate.accountId || (candidate.direction === "debit" && !candidate.categoryId)) {
      throw new Error("Choose the account and category before saving a merchant rule.");
    }
    const normalized = normalizePayee(candidate.payee);
    if (normalized.length < 3) {
      throw new Error("The merchant name is too short to create a reliable rule.");
    }
    this.database.connection
      .prepare(`
        INSERT INTO merchant_rules
          (id, normalized_payee, direction, account_id, category_id, source_candidate_id,
           times_applied, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(normalized_payee, direction) DO UPDATE SET
          account_id = excluded.account_id,
          category_id = excluded.category_id,
          source_candidate_id = excluded.source_candidate_id,
          updated_at = excluded.updated_at
      `)
      .run(
        randomUUID(),
        normalized,
        candidate.direction,
        candidate.accountId,
        candidate.direction === "debit" ? candidate.categoryId : null,
        candidate.id,
        now,
        now,
      );
    this.audit(
      "import.merchant_rule_saved",
      "import_candidate",
      candidate.id,
      { normalizedPayee: normalized, accountId: candidate.accountId, categoryId: candidate.categoryId },
      now,
    );
  }

  private rebaseExpenseAggregate(
    month: string,
    splits: Array<{ categoryId: string; amountPaise: number }>,
    detailedDelta: 1 | -1,
    now: string,
  ) {
    for (const split of splits) {
      const aggregateIds = [
        `migration-expense-history-${month}-${split.categoryId}`,
        `expense-sheet-${month}-${split.categoryId}`,
      ];
      const aggregate = this.database.connection
        .prepare(`
          SELECT t.id, p.id AS expensePostingId, p.amount_paise AS amountPaise,
                 balancing.id AS balancingPostingId
          FROM journal_transactions t
          JOIN postings p ON p.transaction_id = t.id AND p.category_id = ?
          JOIN postings balancing ON balancing.transaction_id = t.id AND balancing.id <> p.id
          WHERE t.id IN (?, ?) AND t.status = 'posted'
          ORDER BY CASE t.id WHEN ? THEN 0 ELSE 1 END
          LIMIT 1
        `)
        .get(split.categoryId, ...aggregateIds, aggregateIds[0]) as
        | { id: string; expensePostingId: string; amountPaise: number; balancingPostingId: string }
        | undefined;
      if (!aggregate) continue;
      const nextAmount = aggregate.amountPaise - detailedDelta * split.amountPaise;
      if (nextAmount === 0) {
        this.database.connection.prepare("DELETE FROM postings WHERE transaction_id = ?").run(aggregate.id);
        this.database.connection.prepare("DELETE FROM journal_transactions WHERE id = ?").run(aggregate.id);
      } else {
        this.database.connection
          .prepare("UPDATE postings SET amount_paise = ? WHERE id = ?")
          .run(nextAmount, aggregate.expensePostingId);
        this.database.connection
          .prepare("UPDATE postings SET amount_paise = ? WHERE id = ?")
          .run(-nextAmount, aggregate.balancingPostingId);
        this.database.connection
          .prepare(`
            UPDATE journal_transactions
            SET origin = 'expense_sheet_aggregate',
                memo = 'Monthly total correction after detailed statement reconciliation.'
            WHERE id = ?
          `)
          .run(aggregate.id);
      }
      this.audit(
        "expense_aggregate.rebased",
        "budget_period",
        month,
        {
          categoryId: split.categoryId,
          detailedDelta,
          detailedAmountPaise: split.amountPaise,
          previousAggregatePaise: aggregate.amountPaise,
          nextAggregatePaise: nextAmount,
        },
        now,
      );
    }
  }

  private getCandidateRow(id: string): CandidateRow {
    const row = this.database.connection
      .prepare(`
        SELECT c.id, c.artifact_id AS artifactId, a.filename, c.source_row AS sourceRow,
               c.version, c.occurred_on AS occurredOn, c.payee, c.amount_paise AS amountPaise,
               c.direction, c.account_id AS accountId, account.name AS accountName,
               c.category_id AS categoryId, category.name AS categoryName, c.status,
               c.confidence, c.warnings_json AS warningsJson, c.source_json AS sourceJson,
               c.transaction_id AS transactionId, c.rejection_reason AS rejectionReason,
               c.normalized_payee AS normalizedPayee, c.fingerprint,
               c.duplicate_of_candidate_id AS duplicateOfCandidateId,
               duplicate.payee AS duplicatePayee, duplicate_artifact.filename AS duplicateFilename,
               c.duplicate_confidence AS duplicateConfidence,
               c.duplicate_resolution AS duplicateResolution, c.splits_json AS splitsJson,
               c.updated_at AS updatedAt
        FROM import_candidates c
        JOIN import_artifacts a ON a.id = c.artifact_id
        LEFT JOIN accounts account ON account.id = c.account_id
        LEFT JOIN categories category ON category.id = c.category_id
        LEFT JOIN import_candidates duplicate ON duplicate.id = c.duplicate_of_candidate_id
        LEFT JOIN import_artifacts duplicate_artifact ON duplicate_artifact.id = duplicate.artifact_id
        WHERE c.id = ?
      `)
      .get(id) as CandidateRow | undefined;
    if (!row) {
      throw new Error("Import candidate does not exist.");
    }
    return row;
  }

  private mapCandidate(row: CandidateRow): ImportCandidateRecord {
    const rawSplits = parseJson<Array<{ categoryId: string; amountPaise: number }>>(row.splitsJson, []);
    const categoryNames =
      rawSplits.length === 0
        ? new Map<string, string>()
        : new Map(
            (
              this.database.connection
                .prepare(`SELECT id, name FROM categories WHERE id IN (${rawSplits.map(() => "?").join(",")})`)
                .all(...rawSplits.map((split) => split.categoryId)) as Array<{ id: string; name: string }>
            ).map((category) => [category.id, category.name]),
          );
    return {
      ...row,
      warnings: parseJson<string[]>(row.warningsJson, ["Source warnings could not be read"]),
      source: parseJson<Record<string, string>>(row.sourceJson, {}),
      splits: rawSplits.map((split) => ({
        ...split,
        categoryName: categoryNames.get(split.categoryId) ?? null,
      })),
    };
  }

  private getArtifact(id: string): ImportArtifactRecord {
    const artifact = this.database.connection
      .prepare(`
        SELECT a.id, a.filename, a.mime_type AS mimeType, a.size_bytes AS sizeBytes,
               a.account_id AS accountId, account.name AS accountName, a.status,
               a.parser_message AS parserMessage, a.row_count AS rowCount, a.created_at AS createdAt,
               COALESCE(SUM(CASE WHEN c.status = 'pending' THEN 1 ELSE 0 END), 0) AS pendingCount,
               COALESCE(SUM(CASE WHEN c.status = 'approved' THEN 1 ELSE 0 END), 0) AS approvedCount,
               COALESCE(SUM(CASE WHEN c.status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejectedCount
        FROM import_artifacts a
        LEFT JOIN accounts account ON account.id = a.account_id
        LEFT JOIN import_candidates c ON c.artifact_id = a.id
        WHERE a.id = ?
        GROUP BY a.id
      `)
      .get(id) as ImportArtifactRecord | undefined;
    if (!artifact) {
      throw new Error("Statement artifact does not exist.");
    }
    return artifact;
  }

  getArtifactSource(id: string): ImportArtifactSource {
    const artifact = this.database.connection
      .prepare(`
        SELECT a.id, a.filename, a.content_hash AS contentHash, a.mime_type AS mimeType,
               a.account_id AS accountId,
               COALESCE(SUM(CASE WHEN c.status = 'approved' THEN 1 ELSE 0 END), 0) AS approvedCount
        FROM import_artifacts a
        LEFT JOIN import_candidates c ON c.artifact_id = a.id
        WHERE a.id = ?
        GROUP BY a.id
      `)
      .get(id) as ImportArtifactSource | undefined;
    if (!artifact) {
      throw new Error("Statement artifact does not exist.");
    }
    return artifact;
  }

  getQueue(): ImportQueueRecord {
    const artifacts = this.database.connection
      .prepare(`
        SELECT a.id, a.filename, a.mime_type AS mimeType, a.size_bytes AS sizeBytes,
               a.account_id AS accountId, account.name AS accountName, a.status,
               a.parser_message AS parserMessage, a.row_count AS rowCount, a.created_at AS createdAt,
               COALESCE(SUM(CASE WHEN c.status = 'pending' THEN 1 ELSE 0 END), 0) AS pendingCount,
               COALESCE(SUM(CASE WHEN c.status = 'approved' THEN 1 ELSE 0 END), 0) AS approvedCount,
               COALESCE(SUM(CASE WHEN c.status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejectedCount
        FROM import_artifacts a
        LEFT JOIN accounts account ON account.id = a.account_id
        LEFT JOIN import_candidates c ON c.artifact_id = a.id
        GROUP BY a.id
        ORDER BY a.created_at DESC
        LIMIT 50
      `)
      .all() as ImportArtifactRecord[];
    const rows = this.database.connection
      .prepare(`
        SELECT c.id, c.artifact_id AS artifactId, a.filename, c.source_row AS sourceRow,
               c.version, c.occurred_on AS occurredOn, c.payee, c.amount_paise AS amountPaise,
               c.direction, c.account_id AS accountId, account.name AS accountName,
               c.category_id AS categoryId, category.name AS categoryName, c.status,
               c.confidence, c.warnings_json AS warningsJson, c.source_json AS sourceJson,
               c.transaction_id AS transactionId, c.rejection_reason AS rejectionReason,
               c.normalized_payee AS normalizedPayee, c.fingerprint,
               c.duplicate_of_candidate_id AS duplicateOfCandidateId,
               duplicate.payee AS duplicatePayee, duplicate_artifact.filename AS duplicateFilename,
               c.duplicate_confidence AS duplicateConfidence,
               c.duplicate_resolution AS duplicateResolution, c.splits_json AS splitsJson,
               c.updated_at AS updatedAt
        FROM import_candidates c
        JOIN import_artifacts a ON a.id = c.artifact_id
        LEFT JOIN accounts account ON account.id = c.account_id
        LEFT JOIN categories category ON category.id = c.category_id
        LEFT JOIN import_candidates duplicate ON duplicate.id = c.duplicate_of_candidate_id
        LEFT JOIN import_artifacts duplicate_artifact ON duplicate_artifact.id = duplicate.artifact_id
        ORDER BY CASE c.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                 c.occurred_on DESC, a.created_at DESC, c.source_row
        LIMIT 1000
      `)
      .all() as CandidateRow[];
    const counts = this.database.connection
      .prepare(`
        SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pendingCount,
               COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approvedCount,
               COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejectedCount
        FROM import_candidates
      `)
      .get() as Pick<ImportQueueRecord, "pendingCount" | "approvedCount" | "rejectedCount">;
    const candidates = rows.map((row) => this.mapCandidate(row));
    return {
      ...counts,
      artifacts,
      candidates,
    };
  }

  createArtifact(input: CreateImportArtifactInput): {
    artifact: ImportArtifactRecord;
    duplicate: boolean;
  } {
    const duplicate = this.database.connection
      .prepare("SELECT id FROM import_artifacts WHERE content_hash = ?")
      .get(input.contentHash) as { id: string } | undefined;
    if (duplicate) {
      return { artifact: this.getArtifact(duplicate.id), duplicate: true };
    }

    if (input.accountId) {
      const account = this.database.connection
        .prepare("SELECT id FROM accounts WHERE id = ? AND account_class IN ('asset', 'liability') AND is_active = 1")
        .get(input.accountId);
      if (!account) {
        throw new Error("Selected statement account does not exist.");
      }
    }

    const artifactId = randomUUID();
    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          INSERT INTO import_artifacts
            (id, filename, content_hash, mime_type, size_bytes, account_id, status,
             parser_message, row_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          artifactId,
          input.filename.trim(),
          input.contentHash,
          input.mimeType,
          input.sizeBytes,
          input.accountId ?? null,
          input.status,
          input.parserMessage ?? null,
          input.rows.length,
          now,
        );
      const insertCandidate = this.database.connection.prepare(`
        INSERT INTO import_candidates
          (id, artifact_id, source_row, occurred_on, payee, amount_paise, direction,
           account_id, category_id, status, confidence, warnings_json, source_json,
           normalized_payee, fingerprint, splits_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, '[]', ?, ?)
      `);
      for (const row of input.rows) {
        const assignment = this.applyMerchantRule({
          payee: row.payee,
          direction: row.direction,
          accountId: input.accountId ?? null,
          categoryId: row.categoryId ?? null,
        });
        const warnings = [...row.warnings];
        if (!assignment.accountId && !warnings.includes("Choose an account")) {
          warnings.push("Choose an account");
        }
        if (assignment.matched) {
          warnings.push("Merchant rule applied");
        }
        const normalized = normalizePayee(row.payee);
        const fingerprint = candidateFingerprint({
          occurredOn: row.occurredOn,
          amountPaise: row.amountPaise,
          direction: row.direction,
          accountId: assignment.accountId,
          normalizedPayee: normalized,
        });
        insertCandidate.run(
          randomUUID(),
          artifactId,
          row.sourceRow,
          row.occurredOn,
          row.payee.trim(),
          row.amountPaise,
          row.direction,
          assignment.accountId,
          assignment.categoryId,
          row.confidence,
          JSON.stringify(warnings),
          JSON.stringify(row.source),
          normalized,
          fingerprint,
          now,
          now,
        );
      }
      this.refreshDuplicateMatches(now);
      this.audit(
        "import.artifact_created",
        "import_artifact",
        artifactId,
        { filename: input.filename, rowCount: input.rows.length, status: input.status },
        now,
      );
    });
    write.immediate();
    return { artifact: this.getArtifact(artifactId), duplicate: false };
  }

  replaceArtifactParseResult(
    id: string,
    input: Pick<CreateImportArtifactInput, "status" | "parserMessage" | "rows">,
  ): ImportArtifactRecord {
    const artifact = this.getArtifactSource(id);
    if (artifact.approvedCount > 0) {
      throw new Error("A statement with posted candidates cannot be parsed again.");
    }
    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      this.database.connection.prepare("DELETE FROM import_candidates WHERE artifact_id = ?").run(id);
      this.database.connection
        .prepare(`
          UPDATE import_artifacts
          SET status = ?, parser_message = ?, row_count = ?
          WHERE id = ?
        `)
        .run(input.status, input.parserMessage ?? null, input.rows.length, id);

      const insertCandidate = this.database.connection.prepare(`
        INSERT INTO import_candidates
          (id, artifact_id, source_row, occurred_on, payee, amount_paise, direction,
           account_id, category_id, status, confidence, warnings_json, source_json,
           normalized_payee, fingerprint, splits_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, '[]', ?, ?)
      `);
      for (const row of input.rows) {
        const assignment = this.applyMerchantRule({
          payee: row.payee,
          direction: row.direction,
          accountId: artifact.accountId,
          categoryId: row.categoryId ?? null,
        });
        const warnings = [...row.warnings];
        if (!assignment.accountId && !warnings.includes("Choose an account")) {
          warnings.push("Choose an account");
        }
        if (assignment.matched) warnings.push("Merchant rule applied");
        const normalized = normalizePayee(row.payee);
        const fingerprint = candidateFingerprint({
          occurredOn: row.occurredOn,
          amountPaise: row.amountPaise,
          direction: row.direction,
          accountId: assignment.accountId,
          normalizedPayee: normalized,
        });
        insertCandidate.run(
          randomUUID(),
          id,
          row.sourceRow,
          row.occurredOn,
          row.payee.trim(),
          row.amountPaise,
          row.direction,
          assignment.accountId,
          assignment.categoryId,
          row.confidence,
          JSON.stringify(warnings),
          JSON.stringify(row.source),
          normalized,
          fingerprint,
          now,
          now,
        );
      }
      this.refreshDuplicateMatches(now);
      this.audit(
        "import.artifact_reparsed",
        "import_artifact",
        id,
        { rowCount: input.rows.length, status: input.status },
        now,
      );
    });
    write.immediate();
    return this.getArtifact(id);
  }

  updateCandidate(id: string, input: UpdateImportCandidateInput): ImportCandidateRecord {
    const existing = this.getCandidateRow(id);
    if (existing.status !== "pending") {
      throw new Error("Only pending import candidates can be edited.");
    }
    const next = {
      occurredOn: input.occurredOn === undefined ? existing.occurredOn : input.occurredOn,
      payee: input.payee?.trim() ?? existing.payee,
      amountPaise: input.amountPaise ?? existing.amountPaise,
      direction: input.direction ?? existing.direction,
      accountId: input.accountId === undefined ? existing.accountId : input.accountId,
      categoryId: input.categoryId === undefined ? existing.categoryId : input.categoryId,
      splits:
        input.splits === undefined
          ? parseJson<Array<{ categoryId: string; amountPaise: number }>>(existing.splitsJson, [])
          : (input.splits ?? []),
    };
    if (!next.payee || !Number.isSafeInteger(next.amountPaise) || next.amountPaise <= 0) {
      throw new Error("Candidate payee and positive amount are required.");
    }
    if (next.accountId) {
      const account = this.database.connection
        .prepare("SELECT account_class AS accountClass FROM accounts WHERE id = ? AND is_active = 1")
        .get(next.accountId) as { accountClass: string } | undefined;
      if (!account || !["asset", "liability"].includes(account.accountClass)) {
        throw new Error("Selected candidate account does not exist.");
      }
      if (next.direction === "credit" && account.accountClass !== "asset") {
        throw new Error("Credits must be assigned to an asset account.");
      }
    }
    const categoryIds = [
      ...(next.categoryId ? [next.categoryId] : []),
      ...next.splits.map((split) => split.categoryId),
    ];
    for (const categoryId of new Set(categoryIds)) {
      if (!this.database.connection.prepare("SELECT id FROM categories WHERE id = ?").get(categoryId)) {
        throw new Error("Selected candidate category does not exist.");
      }
    }
    if (next.direction !== "debit" && next.splits.length > 0) {
      throw new Error("Only debit expenses can be split across categories.");
    }
    if (next.splits.length > 0) {
      if (next.splits.length < 2 || next.splits.length > 20) {
        throw new Error("Split expenses require between 2 and 20 lines.");
      }
      if (
        next.splits.some((split) => !Number.isSafeInteger(split.amountPaise) || split.amountPaise <= 0) ||
        next.splits.reduce((sum, split) => sum + split.amountPaise, 0) !== next.amountPaise
      ) {
        throw new Error("Split amounts must be positive and equal the candidate amount.");
      }
      next.categoryId = null;
    }
    const warnings = parseJson<string[]>(existing.warningsJson, []).filter(
      (warning) =>
        warning !== "Date needs review" && warning !== "Choose an account" && warning !== "Choose an expense category",
    );
    if (!next.occurredOn) warnings.push("Date needs review");
    if (!next.accountId) warnings.push("Choose an account");
    if (next.direction === "debit" && !next.categoryId && next.splits.length === 0) {
      warnings.push("Choose an expense category");
    }
    const confidence = warnings.length === 0 ? Math.max(existing.confidence, 85) : Math.min(existing.confidence, 60);
    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      const normalized = normalizePayee(next.payee);
      const fingerprint = candidateFingerprint({ ...next, normalizedPayee: normalized });
      this.database.connection
        .prepare(`
          UPDATE import_candidates
          SET occurred_on = ?, payee = ?, amount_paise = ?, direction = ?,
              account_id = ?, category_id = ?, confidence = ?, warnings_json = ?,
              normalized_payee = ?, fingerprint = ?, splits_json = ?,
              duplicate_resolution = 'none', duplicate_of_candidate_id = NULL,
              duplicate_confidence = NULL, version = version + 1, updated_at = ?
          WHERE id = ?
        `)
        .run(
          next.occurredOn,
          next.payee,
          next.amountPaise,
          next.direction,
          next.accountId,
          next.categoryId,
          confidence,
          JSON.stringify(warnings),
          normalized,
          fingerprint,
          JSON.stringify(next.splits),
          now,
          id,
        );
      this.refreshDuplicateMatches(now);
      if (input.rememberMerchantRule) {
        this.saveMerchantRule(this.getCandidateRow(id), now);
      }
    });
    write.immediate();
    this.audit("import.candidate_updated", "import_candidate", id, { before: existing, after: next }, now);
    return this.mapCandidate(this.getCandidateRow(id));
  }

  approveCandidates(ids: string[]): ImportQueueRecord {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      throw new Error("Select at least one import candidate.");
    }
    const write = this.database.connection.transaction(() => {
      for (const id of uniqueIds) {
        const candidate = this.getCandidateRow(id);
        if (candidate.status !== "pending") {
          throw new Error("Only pending import candidates can be approved.");
        }
        if (!candidate.occurredOn || !candidate.accountId) {
          throw new Error(`${candidate.payee} needs a valid date and account before approval.`);
        }
        const splits = parseJson<Array<{ categoryId: string; amountPaise: number }>>(candidate.splitsJson, []);
        if (candidate.direction === "debit" && !candidate.categoryId && splits.length === 0) {
          throw new Error(`${candidate.payee} needs an expense category before approval.`);
        }
        if (candidate.duplicateResolution === "suspected") {
          throw new Error(
            `${candidate.payee} matches an existing transaction. Merge it or explicitly keep it as a separate transaction.`,
          );
        }
        const transaction = this.ledger.createManualTransaction({
          occurredOn: candidate.occurredOn,
          payee: candidate.payee,
          memo: `Imported from ${candidate.filename}, row ${candidate.sourceRow}`,
          kind: candidate.direction === "debit" ? "expense" : "income",
          amountPaise: candidate.amountPaise,
          accountId: candidate.accountId,
          categoryId: candidate.direction === "debit" ? (candidate.categoryId ?? undefined) : undefined,
          splits: candidate.direction === "debit" && splits.length > 0 ? splits : undefined,
          idempotencyKey: `import-candidate:${candidate.id}:v${candidate.version}`,
        });
        const now = new Date().toISOString();
        if (candidate.direction === "debit") {
          this.rebaseExpenseAggregate(
            candidate.occurredOn.slice(0, 7),
            splits.length > 0
              ? splits
              : [{ categoryId: candidate.categoryId as string, amountPaise: candidate.amountPaise }],
            1,
            now,
          );
        }
        this.database.connection
          .prepare(`
            UPDATE import_candidates
            SET status = 'approved', transaction_id = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(transaction.id, now, candidate.id);
        this.audit(
          "import.candidate_approved",
          "import_candidate",
          candidate.id,
          { transactionId: transaction.id },
          now,
        );
      }
    });
    write.immediate();
    return this.getQueue();
  }

  rejectCandidates(ids: string[], reason: string): ImportQueueRecord {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      throw new Error("Select at least one import candidate.");
    }
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3) {
      throw new Error("A rejection reason is required.");
    }
    const now = new Date().toISOString();
    const write = this.database.connection.transaction(() => {
      for (const id of uniqueIds) {
        const candidate = this.getCandidateRow(id);
        if (candidate.status !== "pending") {
          throw new Error("Only pending import candidates can be rejected.");
        }
        this.database.connection
          .prepare(`
            UPDATE import_candidates
            SET status = 'rejected', rejection_reason = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(normalizedReason, now, id);
        this.audit("import.candidate_rejected", "import_candidate", id, { reason: normalizedReason }, now);
      }
    });
    write.immediate();
    return this.getQueue();
  }

  resetCandidatesToPending(ids: string[]): ImportQueueRecord {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      throw new Error("Select at least one import candidate.");
    }
    for (const id of uniqueIds) {
      const candidate = this.getCandidateRow(id);
      if (candidate.status === "pending") {
        throw new Error("This import candidate is already pending.");
      }
      let reversedTransactionId: string | null = null;
      if (candidate.status === "approved") {
        if (!candidate.transactionId) {
          throw new Error("The approved candidate has no linked ledger transaction.");
        }
        const linked = this.database.connection
          .prepare("SELECT status FROM journal_transactions WHERE id = ?")
          .get(candidate.transactionId) as { status: string } | undefined;
        if (!linked) {
          throw new Error("The approved candidate's ledger transaction does not exist.");
        }
        if (linked.status === "posted") {
          if (candidate.direction === "debit" && candidate.occurredOn) {
            const splits = parseJson<Array<{ categoryId: string; amountPaise: number }>>(candidate.splitsJson, []);
            this.rebaseExpenseAggregate(
              candidate.occurredOn.slice(0, 7),
              splits.length > 0
                ? splits
                : [{ categoryId: candidate.categoryId as string, amountPaise: candidate.amountPaise }],
              -1,
              new Date().toISOString(),
            );
          }
          this.ledger.reverseTransaction(candidate.transactionId, {
            reason: "Import approval moved back to pending",
            idempotencyKey: `import-candidate-reset:${candidate.id}:v${candidate.version}`,
          });
          reversedTransactionId = candidate.transactionId;
        } else if (linked.status !== "reversed") {
          throw new Error("The linked ledger transaction cannot be moved back to pending.");
        }
      }
      const now = new Date().toISOString();
      const write = this.database.connection.transaction(() => {
        this.database.connection
          .prepare(`
            UPDATE import_candidates
            SET status = 'pending', transaction_id = NULL, rejection_reason = NULL,
                duplicate_resolution = 'none', duplicate_of_candidate_id = NULL,
                duplicate_confidence = NULL, version = version + 1, updated_at = ?
            WHERE id = ?
          `)
          .run(now, candidate.id);
        this.refreshDuplicateMatches(now);
        this.audit(
          "import.candidate_reset_pending",
          "import_candidate",
          candidate.id,
          { previousStatus: candidate.status, reversedTransactionId },
          now,
        );
      });
      write.immediate();
    }
    return this.getQueue();
  }

  resolveDuplicate(id: string, action: ResolveImportDuplicateAction): ImportQueueRecord {
    const candidate = this.getCandidateRow(id);
    if (candidate.status !== "pending" || candidate.duplicateResolution !== "suspected") {
      throw new Error("Only a pending suspected duplicate can be resolved.");
    }
    const now = new Date().toISOString();
    if (action === "keep_distinct") {
      this.database.connection
        .prepare(`
          UPDATE import_candidates
          SET duplicate_resolution = 'distinct', version = version + 1, updated_at = ?
          WHERE id = ?
        `)
        .run(now, id);
      this.audit(
        "import.duplicate_kept_distinct",
        "import_candidate",
        id,
        { duplicateOfCandidateId: candidate.duplicateOfCandidateId },
        now,
      );
      return this.getQueue();
    }

    this.database.connection
      .prepare(`
        UPDATE import_candidates
        SET status = 'rejected', duplicate_resolution = 'merged',
            rejection_reason = 'Merged with matching imported transaction', updated_at = ?
        WHERE id = ?
      `)
      .run(now, id);
    this.audit(
      "import.duplicate_merged",
      "import_candidate",
      id,
      { duplicateOfCandidateId: candidate.duplicateOfCandidateId },
      now,
    );
    return this.getQueue();
  }
}
