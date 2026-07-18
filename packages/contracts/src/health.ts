import { z } from "zod";

export const healthResponseSchema = z.object({
  service: z.literal("finance-hero"),
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  database: z.enum(["encrypted", "unavailable", "not-configured"]),
  checkedAt: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
