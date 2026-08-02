export interface StatementInstitutionFixture {
  id: string;
  filenameBase: string;
  profileId: string;
  table: string[][];
  expectedRows: Array<{
    occurredOn: string;
    payee: string;
    amountPaise: number;
    direction: "debit" | "credit";
  }>;
}

// Synthetic fixtures document supported institution layouts without containing
// any real account, merchant, or balance data.
export const STATEMENT_INSTITUTION_FIXTURES: readonly StatementInstitutionFixture[] = [
  {
    id: "axis-bank-current-account",
    filenameBase: "axis-bank-synthetic",
    profileId: "axis-bank",
    table: [
      ["Tran Date", "Particulars", "Debit", "Credit", "Balance"],
      ["01-07-2026", "SYNTHETIC GROCER", "500.00", "", "9500.00"],
      ["02-07-2026", "SYNTHETIC REFUND", "", "200.00", "9700.00"],
    ],
    expectedRows: [
      { occurredOn: "2026-07-01", payee: "SYNTHETIC GROCER", amountPaise: 50000, direction: "debit" },
      { occurredOn: "2026-07-02", payee: "SYNTHETIC REFUND", amountPaise: 20000, direction: "credit" },
    ],
  },
] as const;
