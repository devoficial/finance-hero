import { describe, expect, it } from "vitest";
import { createJournalTransaction, UnbalancedJournalError } from "./journal";
import { Money } from "./money";

describe("balanced journal", () => {
  it("records a credit-card purchase without touching cash", () => {
    const transaction = createJournalTransaction({
      id: "txn-card-grocery",
      occurredOn: "2026-07-18",
      payee: "Local Grocer",
      postings: [
        {
          accountId: "expense-groceries",
          accountClass: "expense",
          amount: Money.fromRupees(1250),
          categoryId: "groceries",
        },
        {
          accountId: "liability-icici-card",
          accountClass: "liability",
          amount: Money.fromRupees(-1250),
        },
      ],
    });

    expect(transaction.postings.reduce((sum, item) => sum + item.amount.paise, 0n)).toBe(0n);
  });

  it("rejects an unbalanced transaction", () => {
    expect(() =>
      createJournalTransaction({
        id: "txn-invalid",
        occurredOn: "2026-07-18",
        payee: "Unknown",
        postings: [
          { accountId: "expense-misc", accountClass: "expense", amount: Money.fromPaise(100n) },
          { accountId: "asset-bank", accountClass: "asset", amount: Money.fromPaise(-99n) },
        ],
      }),
    ).toThrowError(UnbalancedJournalError);
  });
});
