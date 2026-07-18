import { type HealthResponse, healthResponseSchema } from "@finance-hero/contracts";

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/api/v1/health", { signal });

  if (!response.ok) {
    throw new Error(`Local API returned ${response.status}`);
  }

  return healthResponseSchema.parse(await response.json());
}
