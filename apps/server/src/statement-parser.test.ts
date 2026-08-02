import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  parseStatementDelimitedFile,
  parseStatementExcelFile,
  parseStatementOcrPages,
  parseStatementPdfFile,
} from "./statement-parser";
import { STATEMENT_INSTITUTION_FIXTURES } from "./test-fixtures/statement-institutions";

function createTextPdfPages(pages: Array<Array<Array<{ text: string; x: number }>>>): Buffer {
  const escapePdfText = (value: string) => value.replace(/([\\()])/g, "\\$1");
  const pageObjectIds = pages.map((_, index) => 4 + index);
  const contentObjectIds = pages.map((_, index) => 4 + pages.length + index);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let index = 0; index < pages.length; index += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`,
    );
  }
  for (const lines of pages) {
    const text = lines
      .flatMap((line, lineIndex) =>
        line.map(
          ({ text: value, x }) =>
            `BT /F1 11 Tf 1 0 0 1 ${x} ${760 - lineIndex * 24} Tm (${escapePdfText(value)}) Tj ET`,
        ),
      )
      .join("\n");
    objects.push(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function createTextPdf(lines: Array<Array<{ text: string; x: number }>>): Buffer {
  return createTextPdfPages([lines]);
}

function createStatementWorkbook(bookType: "xls" | "xlsx"): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Synthetic statement instructions"]]), "Read me");
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Statement summary"],
      ["Transaction Date", "Narration", "Debit Amount", "Credit Amount"],
      ["18/07/2026", "GROCERY STORE", 2450.75, ""],
      ["19/07/2026", "MONTHLY SALARY", "", 300000],
    ]),
    "Transactions",
  );
  return XLSX.write(workbook, { type: "buffer", bookType }) as Buffer;
}

describe("statement delimited parser", () => {
  it("extracts quoted debit and credit rows from a bank CSV", () => {
    const parsed = parseStatementDelimitedFile(
      Buffer.from(
        [
          "Transaction Date,Narration,Debit Amount,Credit Amount",
          '18/07/2026,"SWIGGY, BANGALORE","1,245.50",',
          "19/07/2026,MONTHLY SALARY,,300000",
        ].join("\n"),
      ),
      "statement.csv",
    );

    expect(parsed.rows).toEqual([
      expect.objectContaining({
        sourceRow: 2,
        occurredOn: "2026-07-18",
        payee: "SWIGGY, BANGALORE",
        amountPaise: 124550,
        direction: "debit",
      }),
      expect.objectContaining({
        sourceRow: 3,
        occurredOn: "2026-07-19",
        amountPaise: 30000000,
        direction: "credit",
      }),
    ]);
  });

  it("marks an invalid date for review instead of inventing one", () => {
    const [candidate] = parseStatementDelimitedFile(
      Buffer.from("Date,Description,Amount,Type\nunknown,Cafe,500,DR"),
      "statement.csv",
    ).rows;

    expect(candidate?.occurredOn).toBeNull();
    expect(candidate?.warnings).toContain("Date needs review");
  });

  it("corrects reversed debit and credit labels using running balances", () => {
    const parsed = parseStatementDelimitedFile(
      Buffer.from(
        [
          "Tran Date,PARTICULARS,DR,CR,BAL",
          "01-07-2026,SHOP,,5000.00,244850.91",
          "01-07-2026,INTEREST,408.00,,245258.91",
          "02-07-2026,RENT,,16433.00,228825.91",
        ].join("\n"),
      ),
      "axis.csv",
    );

    expect(parsed.message).toContain("labels were corrected");
    expect(parsed.rows).toEqual([
      expect.objectContaining({ payee: "SHOP", amountPaise: 500000, direction: "debit" }),
      expect.objectContaining({ payee: "INTEREST", amountPaise: 40800, direction: "credit" }),
      expect.objectContaining({ payee: "RENT", amountPaise: 1643300, direction: "debit" }),
    ]);
    expect(parsed.reconciliation).toMatchObject({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-02",
      openingBalanceAssetPaise: 24985091,
      closingBalancePaise: 22882591,
    });
  });

  it("derives the same statement balances from newest-first exports", () => {
    const parsed = parseStatementDelimitedFile(
      Buffer.from(
        [
          "Date,Description,Debit,Credit,Balance",
          "02/07/2026,REFUND,,500,9500",
          "01/07/2026,GROCERIES,1000,,9000",
        ].join("\n"),
      ),
      "newest-first.csv",
    );

    expect(parsed.reconciliation).toEqual({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-02",
      openingBalanceAssetPaise: 1000000,
      openingBalanceLiabilityPaise: 800000,
      closingBalancePaise: 950000,
    });
  });

  it("rejects a table without recognizable statement headers", () => {
    expect(() => parseStatementDelimitedFile(Buffer.from("A,B,C\n1,2,3"), "statement.csv")).toThrow(
      "Required date, description, and amount columns could not be detected.",
    );
  });

  it("detects semicolon-delimited exports and card amount DR markers", () => {
    const parsed = parseStatementDelimitedFile(
      Buffer.from("Posting Date;Transaction Description;Transaction Amount\n20/07/2026;APOLLO PHARMACY;600.00 DR"),
      "card.csv",
    );
    expect(parsed.rows[0]).toMatchObject({
      occurredOn: "2026-07-20",
      payee: "APOLLO PHARMACY",
      amountPaise: 60000,
      direction: "debit",
    });
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "delimited.delimiter_detected", message: "semicolon delimiter detected." }),
      ]),
    );
  });

  it.each(STATEMENT_INSTITUTION_FIXTURES)("parses the $id CSV fixture with an explicit profile", (fixture) => {
    const parsed = parseStatementDelimitedFile(
      Buffer.from(fixture.table.map((row) => row.join(",")).join("\n")),
      `${fixture.filenameBase}.csv`,
    );

    expect(parsed.rows).toMatchObject(fixture.expectedRows);
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "profile.detected", message: "Axis Bank layout detected." }),
      ]),
    );
  });
});

describe("statement OCR normalizer", () => {
  it("creates low-confidence review candidates from dated OCR lines", () => {
    const parsed = parseStatementOcrPages([
      {
        page: 1,
        lines: ["01/07/2026 OPENING INTEREST 408.00 CR 245258.91", "02/07/2026 RENT PAYMENT 16433.00 DR 228825.91"],
      },
    ]);
    expect(parsed.rows).toEqual([
      expect.objectContaining({ payee: "OPENING INTEREST", amountPaise: 40800, direction: "credit" }),
      expect.objectContaining({ payee: "RENT PAYMENT", amountPaise: 1643300, direction: "debit" }),
    ]);
    expect(parsed.rows[0]?.warnings).toContain("Extracted with local OCR; verify date, direction, and amount");
  });
});

describe("statement Excel parser", () => {
  it.each(["xls", "xlsx"] as const)("extracts rows from %s workbooks", (bookType) => {
    const parsed = parseStatementExcelFile(createStatementWorkbook(bookType), `statement.${bookType}`);

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      occurredOn: "2026-07-18",
      payee: "GROCERY STORE",
      amountPaise: 245075,
      direction: "debit",
    });
    expect(parsed.rows[1]).toMatchObject({
      occurredOn: "2026-07-19",
      amountPaise: 30000000,
      direction: "credit",
    });
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "excel.sheet_skipped", source: `statement.${bookType} / Read me` }),
      ]),
    );
  });

  it.each(STATEMENT_INSTITUTION_FIXTURES)("parses the $id XLSX fixture", (fixture) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(fixture.table), "Transactions");
    const content = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const parsed = parseStatementExcelFile(content, `${fixture.filenameBase}.xlsx`);

    expect(parsed.rows).toMatchObject(fixture.expectedRows);
    expect(parsed.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "profile.detected" })]));
  });
});

describe("statement PDF parser", () => {
  it("reconstructs positioned transaction columns from a text PDF", async () => {
    const pdf = createTextPdf([
      [
        { text: "Date", x: 50 },
        { text: "Description", x: 150 },
        { text: "Debit", x: 350 },
        { text: "Credit", x: 450 },
        { text: "Balance", x: 540 },
      ],
      [
        { text: "18/07/2026", x: 50 },
        { text: "SWIGGY ORDER", x: 150 },
        { text: "1250.50", x: 350 },
        { text: "998749.50", x: 540 },
      ],
      [
        { text: "19/07/2026", x: 50 },
        { text: "MONTHLY SALARY", x: 150 },
        { text: "300000", x: 450 },
        { text: "1298749.50", x: 540 },
      ],
    ]);

    const parsed = await parseStatementPdfFile(pdf);

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      occurredOn: "2026-07-18",
      payee: "SWIGGY ORDER",
      amountPaise: 125050,
      direction: "debit",
    });
    expect(parsed.rows[1]).toMatchObject({
      occurredOn: "2026-07-19",
      direction: "credit",
    });
    expect(parsed.reconciliation).toMatchObject({
      periodStart: "2026-07-18",
      periodEnd: "2026-07-19",
      openingBalanceAssetPaise: 100000000,
      closingBalancePaise: 129874950,
    });
  });

  it("parses Axis-style Tran Date rows and headerless continuation pages", async () => {
    const pdf = createTextPdfPages([
      [
        [
          { text: "Tran Date", x: 40 },
          { text: "Particulars", x: 130 },
          { text: "Debit", x: 340 },
          { text: "Credit", x: 420 },
          { text: "Balance", x: 500 },
        ],
        [
          { text: "OPENING BALANCE", x: 130 },
          { text: "500000.00", x: 500 },
        ],
        [{ text: "EMI PAYMENT", x: 130 }],
        [
          { text: "10-07-2026", x: 40 },
          { text: "DEBASIS NATH", x: 130 },
          { text: "40582.00", x: 340 },
          { text: "459418.00", x: 500 },
        ],
      ],
      [
        [{ text: "UPI REVERSAL", x: 130 }],
        [
          { text: "13-07-2026", x: 40 },
          { text: "REFERENCE 123", x: 130 },
          { text: "153.00", x: 420 },
          { text: "459571.00", x: 500 },
        ],
      ],
    ]);

    const parsed = await parseStatementPdfFile(pdf);

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      occurredOn: "2026-07-10",
      payee: "EMI PAYMENT DEBASIS NATH",
      amountPaise: 4058200,
      direction: "debit",
    });
    expect(parsed.rows[1]).toMatchObject({
      occurredOn: "2026-07-13",
      payee: "UPI REVERSAL REFERENCE 123",
      amountPaise: 15300,
      direction: "credit",
    });
    expect(parsed.reconciliation).toMatchObject({
      periodStart: "2026-07-10",
      periodEnd: "2026-07-13",
      openingBalanceAssetPaise: 50000000,
      closingBalancePaise: 45957100,
    });
  });

  it("flags PDFs without a text transaction table for OCR", async () => {
    await expect(parseStatementPdfFile(createTextPdf([[{ text: "Scanned statement cover", x: 50 }]]))).rejects.toThrow(
      "OCR is required",
    );
  });

  it.each(STATEMENT_INSTITUTION_FIXTURES)("parses the $id PDF fixture and diagnoses cover pages", async (fixture) => {
    const xPositions = [40, 150, 350, 440, 520];
    const transactionPage = fixture.table.map((row) =>
      row.flatMap((text, index) => (text ? [{ text, x: xPositions[index] ?? 40 }] : [])),
    );
    const pdf = createTextPdfPages([[[{ text: "Synthetic statement cover", x: 40 }]], transactionPage]);

    const parsed = await parseStatementPdfFile(pdf);

    expect(parsed.rows).toMatchObject(fixture.expectedRows);
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "pdf.page_skipped", source: "PDF page 1" }),
        expect.objectContaining({ code: "profile.detected", source: "PDF page 2" }),
      ]),
    );
  });
});
