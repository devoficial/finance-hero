import { createHash } from "node:crypto";

export interface IosMessageInput {
  stableId: string;
  sentAt?: string;
  sender?: string;
  body: string;
  accountId?: string;
}

function parseAmountPaise(body: string): number | undefined {
  const match = body.match(/(?:₹|INR|Rs\.?)[\s:]*(\d[\d,]*(?:\.\d{1,2})?)/i);
  if (!match) return undefined;
  const amountText = match[1];
  if (!amountText) return undefined;
  const amount = Number(amountText.replaceAll(",", ""));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : undefined;
}

export function parseIosMessage(input: IosMessageInput) {
  const body = input.body.replace(/\s+/g, " ").trim();
  if (!input.stableId.trim() || !body) throw new Error("Message stableId and body are required.");
  const amountPaise = parseAmountPaise(body);
  if (!amountPaise) throw new Error("No INR amount was detected in the message.");
  const credit = /\b(credited|credit|received|deposited|refund(?:ed)?|reversal)\b/i.test(body);
  const direction = credit ? "credit" : "debit";
  const sentAt = input.sentAt && !Number.isNaN(Date.parse(input.sentAt)) ? new Date(input.sentAt) : new Date();
  const occurredOn = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(sentAt);
  const merchant = [...body.matchAll(/\bat\s+([^.;,]{2,60})/gi)].at(-1)?.[1]?.trim();
  const counterparty = body.match(/\b(?:to|from)\s+([^.;,]{2,60})/i)?.[1]?.trim();
  const party = merchant || counterparty;
  const payee = party || input.sender?.trim() || "iPhone banking message";
  const contentHash = createHash("sha256").update(`ios-message:${input.stableId.trim()}:${body}`).digest("hex");
  return {
    contentHash,
    filename: `iphone-message-${input.stableId.replace(/[^a-z0-9_-]/gi, "").slice(0, 48)}.json`,
    accountId: input.accountId,
    row: {
      sourceRow: 1,
      occurredOn,
      payee,
      amountPaise,
      direction: direction as "credit" | "debit",
      confidence: 70,
      warnings: ["Imported from an iPhone Shortcut; verify before approval"],
      source: { channel: "ios-message", sender: input.sender ?? null, body, stableId: input.stableId },
    },
  };
}
