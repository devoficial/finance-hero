import { describe, expect, it } from "vitest";
import { assistantSafetyResponse } from "./assistant-service";

describe("assistantSafetyResponse", () => {
  it("blocks credentials", () => {
    expect(assistantSafetyResponse("My OTP is 123456, can you use it?")).toMatch(/cannot collect/i);
  });

  it("blocks financial mutations", () => {
    expect(assistantSafetyResponse("Delete this transaction for me")).toMatch(/read-only/i);
  });

  it("blocks indirectly worded requests to move money", () => {
    expect(assistantSafetyResponse("Could you take care of the transfer into my emergency fund for me?")).toMatch(
      /read-only/i,
    );
  });

  it("allows analysis and what-if questions", () => {
    expect(assistantSafetyResponse("What if I pay Rs 10,000 extra toward my home loan?")).toBeUndefined();
  });
});
