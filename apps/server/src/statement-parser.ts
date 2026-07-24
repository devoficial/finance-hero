export interface ParsedStatementRow {
  sourceRow: number;
  occurredOn: string | null;
  payee: string;
  amountPaise: number;
  direction: "debit" | "credit";
  confidence: number;
  warnings: string[];
  source: Record<string, string>;
}

export interface ParsedStatement {
  rows: ParsedStatementRow[];
  message: string;
}

const MAXIMUM_STATEMENT_ROWS = 20_000;
const DATE_HEADERS = ["date", "transactiondate", "txndate", "valuedate", "posteddate"];
const DESCRIPTION_HEADERS = ["description", "narration", "particulars", "merchant", "transactiondetails", "remarks"];
const DEBIT_HEADERS = ["debit", "debitamount", "withdrawal", "withdrawals"];
const CREDIT_HEADERS = ["credit", "creditamount", "deposit", "deposits"];
const AMOUNT_HEADERS = ["amount", "transactionamount", "txnamount"];
const DIRECTION_HEADERS = ["direction", "type", "drcr", "debitcredit"];

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findColumn(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(field.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }
  return rows;
}

function parseAmount(value: string): number | null {
  const normalized = value
    .replace(/[₹,\s]/g, "")
    .replace(/\(([^)]+)\)/, "-$1")
    .replace(/(?:CR|DR)$/i, "");
  if (!normalized) {
    return null;
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount === 0) {
    return null;
  }
  return Math.round(Math.abs(amount) * 100);
}

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2]?.padStart(2, "0")}-${iso[3]?.padStart(2, "0")}`;
  }

  const indian = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  if (indian) {
    const year = indian[3]?.length === 2 ? `20${indian[3]}` : indian[3];
    return `${year}-${indian[2]?.padStart(2, "0")}-${indian[1]?.padStart(2, "0")}`;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

function inferDirection(value: string, amountValue: string): "debit" | "credit" {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("cr") || normalized.includes("credit") || normalized.includes("deposit")) {
    return "credit";
  }
  if (normalized.includes("dr") || normalized.includes("debit") || normalized.includes("withdraw")) {
    return "debit";
  }
  return amountValue.trim().startsWith("-") ? "debit" : "credit";
}

export function parseStatementDelimitedFile(content: Buffer, filename: string): ParsedStatement {
  const text = content.toString("utf8").replace(/^\uFEFF/, "");
  if (text.includes("\u0000")) {
    throw new Error("The file is not a text CSV or TSV statement.");
  }
  const delimiter = filename.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const table = parseDelimited(text, delimiter);
  if (table.length < 2) {
    throw new Error("The statement does not contain a header and transaction rows.");
  }
  if (table.length - 1 > MAXIMUM_STATEMENT_ROWS) {
    throw new Error(`The statement exceeds the ${MAXIMUM_STATEMENT_ROWS.toLocaleString("en-IN")} row safety limit.`);
  }

  const headers = table[0] ?? [];
  const dateIndex = findColumn(headers, DATE_HEADERS);
  const descriptionIndex = findColumn(headers, DESCRIPTION_HEADERS);
  const debitIndex = findColumn(headers, DEBIT_HEADERS);
  const creditIndex = findColumn(headers, CREDIT_HEADERS);
  const amountIndex = findColumn(headers, AMOUNT_HEADERS);
  const directionIndex = findColumn(headers, DIRECTION_HEADERS);
  if (dateIndex < 0 || descriptionIndex < 0 || (debitIndex < 0 && creditIndex < 0 && amountIndex < 0)) {
    throw new Error("Required date, description, and amount columns could not be detected.");
  }

  const rows: ParsedStatementRow[] = [];
  for (let index = 1; index < table.length; index += 1) {
    const values = table[index] ?? [];
    const debit = debitIndex >= 0 ? parseAmount(values[debitIndex] ?? "") : null;
    const credit = creditIndex >= 0 ? parseAmount(values[creditIndex] ?? "") : null;
    const rawAmount = amountIndex >= 0 ? (values[amountIndex] ?? "") : "";
    const amount = debit ?? credit ?? parseAmount(rawAmount);
    if (!amount) {
      continue;
    }

    const occurredOn = parseDate(values[dateIndex] ?? "");
    const payee = (values[descriptionIndex] ?? "").trim() || "Unidentified transaction";
    const warnings: string[] = [];
    if (!occurredOn) {
      warnings.push("Date needs review");
    }
    if (debit && credit) {
      warnings.push("Both debit and credit values were present");
    }
    const direction =
      debit != null
        ? "debit"
        : credit != null
          ? "credit"
          : inferDirection(directionIndex >= 0 ? (values[directionIndex] ?? "") : "", rawAmount);
    const source = Object.fromEntries(
      headers.map((header, column) => [header || `Column ${column + 1}`, values[column] ?? ""]),
    );

    rows.push({
      sourceRow: index + 1,
      occurredOn,
      payee,
      amountPaise: amount,
      direction,
      confidence: warnings.length === 0 ? 85 : 55,
      warnings,
      source,
    });
  }

  if (rows.length === 0) {
    throw new Error("No transaction rows with valid amounts were found.");
  }
  return { rows, message: `${rows.length} transaction candidate${rows.length === 1 ? "" : "s"} extracted.` };
}
