import type { Money } from "./money";

export type AccountClass = "asset" | "liability" | "income" | "expense" | "equity";

export interface PostingInput {
  accountId: string;
  accountClass: AccountClass;
  amount: Money;
  categoryId?: string;
}

export interface JournalTransaction {
  id: string;
  occurredOn: string;
  payee: string;
  memo?: string;
  status: "posted";
  postings: readonly PostingInput[];
}

export interface JournalTransactionInput {
  id: string;
  occurredOn: string;
  payee: string;
  memo?: string;
  postings: readonly PostingInput[];
}

export class UnbalancedJournalError extends Error {
  constructor(readonly differencePaise: bigint) {
    super(`Journal transaction is out of balance by ${differencePaise} paise.`);
    this.name = "UnbalancedJournalError";
  }
}

export function createJournalTransaction(input: JournalTransactionInput): JournalTransaction {
  if (input.postings.length < 2) {
    throw new TypeError("A journal transaction requires at least two postings.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) {
    throw new TypeError("occurredOn must be an ISO local date.");
  }

  const total = input.postings.reduce((sum, posting) => sum + posting.amount.paise, 0n);

  if (total !== 0n) {
    throw new UnbalancedJournalError(total);
  }

  return Object.freeze({
    ...input,
    payee: input.payee.trim(),
    status: "posted" as const,
    postings: Object.freeze([...input.postings]),
  });
}
