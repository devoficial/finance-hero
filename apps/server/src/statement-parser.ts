import { getDocument, PasswordException, PasswordResponses } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as XLSX from "xlsx";

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

interface PdfToken {
  text: string;
  x: number;
  y: number;
}

export class StatementPasswordRequiredError extends Error {
  constructor(message = "This PDF is password protected. Enter its password to extract transactions.") {
    super(message);
    this.name = "StatementPasswordRequiredError";
  }
}

const MAXIMUM_STATEMENT_ROWS = 20_000;
const MAXIMUM_PDF_PAGES = 200;
const MAXIMUM_PDF_TEXT_ITEMS = 500_000;
const MAXIMUM_XLSX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAXIMUM_XLSX_ENTRIES = 5_000;
const DATE_HEADERS = ["date", "transactiondate", "txndate", "valuedate", "posteddate"];
const DESCRIPTION_HEADERS = ["description", "narration", "particulars", "merchant", "transactiondetails", "remarks"];
const DEBIT_HEADERS = ["debit", "debitamount", "withdrawal", "withdrawals"];
const CREDIT_HEADERS = ["credit", "creditamount", "deposit", "deposits"];
const AMOUNT_HEADERS = ["amount", "transactionamount", "txnamount"];
const DIRECTION_HEADERS = ["direction", "type", "drcr", "debitcredit"];
const BALANCE_HEADERS = ["balance", "closingbalance", "availablebalance", "runningbalance"];

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

function findHeaderRow(table: string[][]): number {
  const scanLimit = Math.min(table.length, 50);
  for (let index = 0; index < scanLimit; index += 1) {
    const headers = table[index] ?? [];
    const hasDate = findColumn(headers, DATE_HEADERS) >= 0;
    const hasDescription = findColumn(headers, DESCRIPTION_HEADERS) >= 0;
    const hasAmount =
      findColumn(headers, DEBIT_HEADERS) >= 0 ||
      findColumn(headers, CREDIT_HEADERS) >= 0 ||
      findColumn(headers, AMOUNT_HEADERS) >= 0;
    if (hasDate && hasDescription && hasAmount) {
      return index;
    }
  }
  return -1;
}

export function parseStatementTable(table: string[][], sourceName?: string): ParsedStatement {
  const headerRow = findHeaderRow(table);
  if (headerRow < 0) {
    throw new Error("Required date, description, and amount columns could not be detected.");
  }
  if (table.length - headerRow - 1 > MAXIMUM_STATEMENT_ROWS) {
    throw new Error(`The statement exceeds the ${MAXIMUM_STATEMENT_ROWS.toLocaleString("en-IN")} row safety limit.`);
  }

  const headers = table[headerRow] ?? [];
  const dateIndex = findColumn(headers, DATE_HEADERS);
  const descriptionIndex = findColumn(headers, DESCRIPTION_HEADERS);
  const debitIndex = findColumn(headers, DEBIT_HEADERS);
  const creditIndex = findColumn(headers, CREDIT_HEADERS);
  const amountIndex = findColumn(headers, AMOUNT_HEADERS);
  const directionIndex = findColumn(headers, DIRECTION_HEADERS);
  const rows: ParsedStatementRow[] = [];

  for (let index = headerRow + 1; index < table.length; index += 1) {
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
    if (sourceName) {
      source.Source = sourceName;
    }

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
  return parseStatementTable(table);
}

function assertSafeXlsxArchive(content: Buffer) {
  if (content.subarray(0, 2).toString("ascii") !== "PK") {
    return;
  }
  let entries = 0;
  let totalUncompressedBytes = 0;
  for (let offset = 0; offset <= content.length - 46; offset += 1) {
    if (content.readUInt32LE(offset) !== 0x02014b50) {
      continue;
    }
    entries += 1;
    totalUncompressedBytes += content.readUInt32LE(offset + 24);
    if (entries > MAXIMUM_XLSX_ENTRIES || totalUncompressedBytes > MAXIMUM_XLSX_UNCOMPRESSED_BYTES) {
      throw new Error("The Excel archive exceeds the safe extraction limit.");
    }
    const filenameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    offset += 45 + filenameLength + extraLength + commentLength;
  }
  if (entries === 0) {
    throw new Error("The XLSX archive directory could not be validated.");
  }
}

export function parseStatementExcelFile(content: Buffer, filename: string): ParsedStatement {
  assertSafeXlsxArchive(content);
  const workbook = XLSX.read(content, {
    type: "buffer",
    dense: true,
    sheetRows: MAXIMUM_STATEMENT_ROWS + 50,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellNF: false,
    bookDeps: false,
    bookVBA: false,
  });
  if (workbook.SheetNames.length > 50) {
    throw new Error("The workbook exceeds the 50-sheet safety limit.");
  }

  const rows: ParsedStatementRow[] = [];
  const parsedSheets: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const table = XLSX.utils.sheet_to_json<string[]>(worksheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    try {
      const parsed = parseStatementTable(table, `${filename} / ${sheetName}`);
      parsedSheets.push(sheetName);
      for (const row of parsed.rows) {
        rows.push({ ...row, sourceRow: rows.length + 1 });
      }
    } catch {
      // Summary and instruction sheets are common; only recognized transaction tables are imported.
    }
    if (rows.length > MAXIMUM_STATEMENT_ROWS) {
      throw new Error(`The statement exceeds the ${MAXIMUM_STATEMENT_ROWS.toLocaleString("en-IN")} row safety limit.`);
    }
  }
  if (rows.length === 0) {
    throw new Error("No worksheet with recognizable date, description, and amount columns was found.");
  }
  return {
    rows,
    message: `${rows.length} transaction candidate${rows.length === 1 ? "" : "s"} extracted from ${parsedSheets.length} worksheet${parsedSheets.length === 1 ? "" : "s"}.`,
  };
}

function groupPdfLines(tokens: PdfToken[]): PdfToken[][] {
  const sorted = [...tokens].sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: PdfToken[][] = [];
  for (const token of sorted) {
    const line = lines.at(-1);
    if (line) {
      const lineY = line[0]?.y ?? token.y;
      if (Math.abs(lineY - token.y) <= 2.5) {
        line.push(token);
        continue;
      }
    }
    lines.push([token]);
  }
  return lines.map((line) => line.sort((left, right) => left.x - right.x));
}

function findPdfHeader(tokens: PdfToken[]): Array<{ name: string; x: number }> | null {
  const aliases = [
    ...DATE_HEADERS,
    ...DESCRIPTION_HEADERS,
    ...DEBIT_HEADERS,
    ...CREDIT_HEADERS,
    ...AMOUNT_HEADERS,
    ...DIRECTION_HEADERS,
    ...BALANCE_HEADERS,
  ];
  const columns: Array<{ name: string; x: number }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    for (let width = 1; width <= 3 && index + width <= tokens.length; width += 1) {
      const name = tokens
        .slice(index, index + width)
        .map((token) => token.text)
        .join(" ");
      if (aliases.includes(normalizeHeader(name))) {
        columns.push({ name, x: tokens[index]?.x ?? 0 });
        index += width - 1;
        break;
      }
    }
  }
  const names = columns.map((column) => column.name);
  const valid =
    findColumn(names, DATE_HEADERS) >= 0 &&
    findColumn(names, DESCRIPTION_HEADERS) >= 0 &&
    (findColumn(names, DEBIT_HEADERS) >= 0 ||
      findColumn(names, CREDIT_HEADERS) >= 0 ||
      findColumn(names, AMOUNT_HEADERS) >= 0);
  return valid ? columns.sort((left, right) => left.x - right.x) : null;
}

function pdfLinesToTable(lines: PdfToken[][]): string[][] {
  const headerIndex = lines.findIndex((line) => findPdfHeader(line) != null);
  if (headerIndex < 0) {
    throw new Error("No recognizable transaction table was found. If this is a scanned PDF, OCR is required.");
  }
  const columns = findPdfHeader(lines[headerIndex] ?? []);
  if (!columns) {
    throw new Error("The PDF transaction columns could not be reconstructed.");
  }
  const boundaries = columns.map((column, index) => {
    const next = columns[index + 1];
    return next ? (column.x + next.x) / 2 : Number.POSITIVE_INFINITY;
  });
  const table = [columns.map((column) => column.name)];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = columns.map(() => "");
    for (const token of line) {
      let column = boundaries.findIndex((boundary) => token.x < boundary);
      if (column < 0) column = columns.length - 1;
      cells[column] = `${cells[column]} ${token.text}`.trim();
    }
    if (cells.some(Boolean)) table.push(cells);
  }
  return table;
}

export async function parseStatementPdfFile(content: Buffer, password?: string): Promise<ParsedStatement> {
  let loadingTask: ReturnType<typeof getDocument> | undefined;
  try {
    loadingTask = getDocument({
      data: new Uint8Array(content),
      password: password || undefined,
      useSystemFonts: false,
      useWasm: false,
      stopAtErrors: true,
      disableFontFace: true,
      enableXfa: false,
    });
    const document = await loadingTask.promise;
    if (document.numPages > MAXIMUM_PDF_PAGES) {
      throw new Error(`The PDF exceeds the ${MAXIMUM_PDF_PAGES}-page safety limit.`);
    }

    const rows: ParsedStatementRow[] = [];
    let extractedTextItems = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      extractedTextItems += text.items.length;
      if (extractedTextItems > MAXIMUM_PDF_TEXT_ITEMS) {
        throw new Error("The PDF exceeds the text extraction safety limit.");
      }
      const tokens: PdfToken[] = text.items
        .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item)
        .map((item) => ({
          text: item.str.trim(),
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
        }))
        .filter((item) => item.text.length > 0);
      try {
        const parsed = parseStatementTable(pdfLinesToTable(groupPdfLines(tokens)), `PDF page ${pageNumber}`);
        for (const row of parsed.rows) {
          rows.push({ ...row, sourceRow: rows.length + 1 });
        }
      } catch {
        // Statements may have cover or summary pages without a transaction table.
      }
      page.cleanup();
      if (rows.length > MAXIMUM_STATEMENT_ROWS) {
        throw new Error(
          `The statement exceeds the ${MAXIMUM_STATEMENT_ROWS.toLocaleString("en-IN")} row safety limit.`,
        );
      }
    }
    if (rows.length === 0) {
      throw new Error("No transaction table was detected. If this is a scanned PDF, OCR is required.");
    }
    return { rows, message: `${rows.length} transaction candidate${rows.length === 1 ? "" : "s"} extracted from PDF.` };
  } catch (error) {
    if (error instanceof PasswordException) {
      if (error.code === PasswordResponses.INCORRECT_PASSWORD) {
        throw new StatementPasswordRequiredError("The PDF password is incorrect. Try again; it is never stored.");
      }
      throw new StatementPasswordRequiredError();
    }
    throw error;
  } finally {
    await loadingTask?.destroy();
  }
}
