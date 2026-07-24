import { describe, expect, it } from "vitest";
import { parseStatementDelimitedFile } from "./statement-parser";

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

  it("rejects a table without recognizable statement headers", () => {
    expect(() => parseStatementDelimitedFile(Buffer.from("A,B,C\n1,2,3"), "statement.csv")).toThrow(
      "Required date, description, and amount columns could not be detected.",
    );
  });
});
