/**
 * Phase 3.8-B.3 — LLM Probe Server Function (READ-ONLY, boss-guarded)
 *
 * Exposes the diagnostic LLM provider probe through the project's existing
 * createServerFn + bossGuardMiddleware pattern (same protection as
 * topUpWallet/withdrawFromWallet). No new auth system, no new endpoints
 * beyond one guarded diagnostic call.
 *
 * SAFETY:
 * - GET, read-only diagnostic; calls provider.generateDecision() with a
 *   fixed, non-trading diagnostic prompt only.
 * - Accepts NO user input that influences provider selection (the chain is
 *   the existing getAvailableProviders() order).
 * - Returns safe metadata only — never credentials, headers, or raw payloads.
 * - Does not touch executor, risk engine, journal, or any trading path.
 */

import { createServerFn } from "@tanstack/react-start";
import { bossGuardMiddleware } from "../auth/middleware";
import { runLLMProbe, type LLMProbeResult } from "../diagnostics/llm-probe";

export type LLMDiagnosticResponse = {
  data: LLMProbeResult;
};

export const getLLMProbe = createServerFn({ method: "GET" })
  .middleware([bossGuardMiddleware])
  .handler(async (): Promise<LLMDiagnosticResponse> => {
    const result = await runLLMProbe();
    return { data: result };
  });
