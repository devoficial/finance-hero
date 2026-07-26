import { randomUUID } from "node:crypto";
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
}

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
  updatedAt: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
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

  private getCandidateRow(id: string): CandidateRow {
    const row = this.database.connection
      .prepare(`
        SELECT c.id, c.artifact_id AS artifactId, a.filename, c.source_row AS sourceRow,
               c.version, c.occurred_on AS occurredOn, c.payee, c.amount_paise AS amountPaise,
               c.direction, c.account_id AS accountId, account.name AS accountName,
               c.category_id AS categoryId, category.name AS categoryName, c.status,
               c.confidence, c.warnings_json AS warningsJson, c.source_json AS sourceJson,
               c.transaction_id AS transactionId, c.rejection_reason AS rejectionReason,
               c.updated_at AS updatedAt
        FROM import_candidates c
        JOIN import_artifacts a ON a.id = c.artifact_id
        LEFT JOIN accounts account ON account.id = c.account_id
        LEFT JOIN categories category ON category.id = c.category_id
        WHERE c.id = ?
      `)
      .get(id) as CandidateRow | undefined;
    if (!row) {
      throw new Error("Import candidate does not exist.");
    }
    return row;
  }

  private mapCandidate(row: CandidateRow): ImportCandidateRecord {
    return {
      ...row,
      warnings: parseJson<string[]>(row.warningsJson, ["Source warnings could not be read"]),
      source: parseJson<Record<string, string>>(row.sourceJson, {}),
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
               c.updated_at AS updatedAt
        FROM import_candidates c
        JOIN import_artifacts a ON a.id = c.artifact_id
        LEFT JOIN accounts account ON account.id = c.account_id
        LEFT JOIN categories category ON category.id = c.category_id
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
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
      `);
      for (const row of input.rows) {
        const warnings = [...row.warnings];
        if (!input.accountId && !warnings.includes("Choose an account")) {
          warnings.push("Choose an account");
        }
        insertCandidate.run(
          randomUUID(),
          artifactId,
          row.sourceRow,
          row.occurredOn,
          row.payee.trim(),
          row.amountPaise,
          row.direction,
          input.accountId ?? null,
          row.categoryId ?? null,
          row.confidence,
          JSON.stringify(warnings),
          JSON.stringify(row.source),
          now,
          now,
        );
      }
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
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
      `);
      for (const row of input.rows) {
        const warnings = [...row.warnings];
        if (!artifact.accountId && !warnings.includes("Choose an account")) {
          warnings.push("Choose an account");
        }
        insertCandidate.run(
          randomUUID(),
          id,
          row.sourceRow,
          row.occurredOn,
          row.payee.trim(),
          row.amountPaise,
          row.direction,
          artifact.accountId,
          row.categoryId ?? null,
          row.confidence,
          JSON.stringify(warnings),
          JSON.stringify(row.source),
          now,
          now,
        );
      }
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
    if (next.categoryId) {
      const category = this.database.connection.prepare("SELECT id FROM categories WHERE id = ?").get(next.categoryId);
      if (!category) {
        throw new Error("Selected candidate category does not exist.");
      }
    }
    const warnings = parseJson<string[]>(existing.warningsJson, []).filter(
      (warning) =>
        warning !== "Date needs review" && warning !== "Choose an account" && warning !== "Choose an expense category",
    );
    if (!next.occurredOn) warnings.push("Date needs review");
    if (!next.accountId) warnings.push("Choose an account");
    if (next.direction === "debit" && !next.categoryId) warnings.push("Choose an expense category");
    const confidence = warnings.length === 0 ? Math.max(existing.confidence, 85) : Math.min(existing.confidence, 60);
    const now = new Date().toISOString();
    this.database.connection
      .prepare(`
        UPDATE import_candidates
        SET occurred_on = ?, payee = ?, amount_paise = ?, direction = ?,
            account_id = ?, category_id = ?, confidence = ?, warnings_json = ?,
            version = version + 1, updated_at = ?
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
        now,
        id,
      );
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
        if (candidate.direction === "debit" && !candidate.categoryId) {
          throw new Error(`${candidate.payee} needs an expense category before approval.`);
        }
        const transaction = this.ledger.createManualTransaction({
          occurredOn: candidate.occurredOn,
          payee: candidate.payee,
          memo: `Imported from ${candidate.filename}, row ${candidate.sourceRow}`,
          kind: candidate.direction === "debit" ? "expense" : "income",
          amountPaise: candidate.amountPaise,
          accountId: candidate.accountId,
          categoryId: candidate.direction === "debit" ? (candidate.categoryId ?? undefined) : undefined,
          idempotencyKey: `import-candidate:${candidate.id}:v${candidate.version}`,
        });
        const now = new Date().toISOString();
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
                version = version + 1, updated_at = ?
            WHERE id = ?
          `)
          .run(now, candidate.id);
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
}
