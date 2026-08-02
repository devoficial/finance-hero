import { describe, expect, it } from "vitest";
import { parseIosMessage } from "./ios-message-parser";

describe("parseIosMessage", () => {
  it("detects a debit amount and merchant", () => {
    const parsed = parseIosMessage({
      stableId: "message-1",
      sentAt: "2026-08-02T04:30:00.000Z",
      sender: "AXISBK",
      body: "Rs.1,280.50 debited from A/c XX0755 at APPLE MED.",
    });

    expect(parsed.row).toMatchObject({
      occurredOn: "2026-08-02",
      payee: "APPLE MED",
      amountPaise: 128_050,
      direction: "debit",
    });
  });

  it("detects a credited amount", () => {
    const parsed = parseIosMessage({
      stableId: "message-2",
      body: "INR 20,000 credited to your account from ICICI Bank",
    });
    expect(parsed.row.direction).toBe("credit");
    expect(parsed.row.amountPaise).toBe(2_000_000);
  });
});
