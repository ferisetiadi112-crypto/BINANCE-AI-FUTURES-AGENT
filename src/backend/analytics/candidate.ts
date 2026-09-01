/**
 * Candidate Strategy Management — BINANCE AI FUTURES AGENT v0.1
 *
 * Manages strategy candidates through their lifecycle:
 *   DRAFT → TESTING → VALIDATED → PROMOTED_TO_PAPER
 *
 * SAFETY:
 *   - PROMOTED_TO_LIVE is NOT ALLOWED in Phase 6
 *   - AI cannot auto-promote strategies
 *   - All promotions require validation
 *   - Complete audit trail maintained
 */

import type { BaselineMetrics } from "./baseline";
import type { Experiment } from "./experiment";
import { logger } from "../logger";

// ─── Candidate Types ────────────────────────────────────────────────

export type CandidateStatus =
  | "DRAFT"
  | "TESTING"
  | "VALIDATED"
  | "REJECTED"
  | "PROMOTED_TO_PAPER";

export type StrategyCandidate = {
  id: string;
  strategyId: string;
  version: string;
  parameters: Record<string, unknown>;
  
  // Performance
  baseline: BaselineMetrics;
  validatedMetrics: BaselineMetrics | null;
  
  // Validation
  experiments: string[]; // Experiment IDs
  validationPeriod: {
    start: number;
    end: number | null;
  };
  
  // Status
  status: CandidateStatus;
  rejectionReason: string | null;
  
  // Metadata
  experimentId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PromotionGate = {
  candidateId: string;
  checks: {
    name: string;
    passed: boolean;
    message: string;
  }[];
  approved: boolean;
  reason: string;
  promotedAt: string | null;
};

// ─── Configuration ──────────────────────────────────────────────────

const MINIMUM_EXPERIMENTS = 1;
const MINIMUM_SAMPLE_SIZE = 30;
const MINIMUM_IMPROVEMENT_PERCENT = 5;

// ─── Candidate Management ───────────────────────────────────────────

let candidateCounter = 0;

export function createCandidate(config: {
  strategyId: string;
  version: string;
  parameters: Record<string, unknown>;
  baseline: BaselineMetrics;
  experimentId: string;
}): StrategyCandidate {
  candidateCounter++;

  const candidate: StrategyCandidate = {
    id: `CAND-${Date.now()}-${candidateCounter}`,
    strategyId: config.strategyId,
    version: config.version,
    parameters: config.parameters,
    
    baseline: config.baseline,
    validatedMetrics: null,
    
    experiments: [config.experimentId],
    validationPeriod: {
      start: Date.now(),
      end: null,
    },
    
    status: "TESTING",
    rejectionReason: null,
    
    experimentId: config.experimentId,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  logger.info(
    "candidate",
    `Created candidate: ${candidate.id} — ${candidate.strategyId} v${candidate.version}`
  );

  return candidate;
}

export function validateCandidate(
  candidate: StrategyCandidate,
  validatedMetrics: BaselineMetrics,
): StrategyCandidate {
  if (candidate.status !== "TESTING") {
    throw new Error(`Cannot validate candidate in status: ${candidate.status}`);
  }

  candidate.validatedMetrics = validatedMetrics;
  candidate.validationPeriod.end = Date.now();
  candidate.status = "VALIDATED";
  candidate.updatedAt = new Date().toISOString();

  logger.info(
    "candidate",
    `Validated candidate: ${candidate.id} — win rate: ${validatedMetrics.winRate.toFixed(1)}%`
  );

  return candidate;
}

export function rejectCandidate(
  candidate: StrategyCandidate,
  reason: string,
): StrategyCandidate {
  candidate.status = "REJECTED";
  candidate.rejectionReason = reason;
  candidate.validationPeriod.end = Date.now();
  candidate.updatedAt = new Date().toISOString();

  logger.info("candidate", `Rejected candidate: ${candidate.id} — ${reason}`);
  return candidate;
}

// ─── Promotion Gate ─────────────────────────────────────────────────

export function evaluatePromotion(candidate: StrategyCandidate): PromotionGate {
  const checks: PromotionGate["checks"] = [];

  // 1. Status must be VALIDATED
  checks.push({
    name: "status_check",
    passed: candidate.status === "VALIDATED",
    message: candidate.status === "VALIDATED"
      ? "Candidate is VALIDATED"
      : `Candidate status is ${candidate.status}, must be VALIDATED`,
  });

  // 2. Must have validated metrics
  checks.push({
    name: "metrics_check",
    passed: candidate.validatedMetrics !== null,
    message: candidate.validatedMetrics
      ? "Validated metrics available"
      : "No validated metrics",
  });

  // 3. Sample size must be sufficient
  const sampleSize = candidate.validatedMetrics?.sampleSize || 0;
  checks.push({
    name: "sample_size_check",
    passed: sampleSize >= MINIMUM_SAMPLE_SIZE,
    message: `Sample size: ${sampleSize}/${MINIMUM_SAMPLE_SIZE}`,
  });

  // 4. Must show improvement over baseline
  if (candidate.validatedMetrics) {
    const improvement = calculateImprovement(candidate.baseline, candidate.validatedMetrics);
    checks.push({
      name: "improvement_check",
      passed: improvement > MINIMUM_IMPROVEMENT_PERCENT,
      message: `Improvement: ${improvement.toFixed(1)}% (threshold: ${MINIMUM_IMPROVEMENT_PERCENT}%)`,
    });
  } else {
    checks.push({
      name: "improvement_check",
      passed: false,
      message: "Cannot evaluate improvement without metrics",
    });
  }

  // 5. Must have completed at least one experiment
  checks.push({
    name: "experiment_check",
    passed: candidate.experiments.length >= MINIMUM_EXPERIMENTS,
    message: `Experiments: ${candidate.experiments.length}/${MINIMUM_EXPERIMENTS}`,
  });

  // 6. Statistical status must be at least PRELIMINARY
  const statisticalStatus = candidate.validatedMetrics?.statisticalStatus || "INSUFFICIENT_SAMPLE";
  checks.push({
    name: "statistical_check",
    passed: statisticalStatus !== "INSUFFICIENT_SAMPLE",
    message: `Statistical status: ${statisticalStatus}`,
  });

  // 7. SAFETY: Live promotion is NEVER allowed
  checks.push({
    name: "safety_live_promotion",
    passed: true, // Always passes — we don't allow live promotion
    message: "Live promotion is disabled (Phase 6 policy)",
  });

  const allPassed = checks.every(c => c.passed);
  const failedChecks = checks.filter(c => !c.passed);

  const gate: PromotionGate = {
    candidateId: candidate.id,
    checks,
    approved: allPassed,
    reason: allPassed
      ? "All promotion checks passed — eligible for PAPER promotion"
      : `Failed: ${failedChecks.map(c => c.message).join("; ")}`,
    promotedAt: null,
  };

  logger.info(
    "candidate",
    `Promotion gate: ${candidate.id} — ${allPassed ? "APPROVED" : "REJECTED"}`
  );

  return gate;
}

export function promoteToPaper(
  candidate: StrategyCandidate,
  gate: PromotionGate,
): StrategyCandidate {
  if (!gate.approved) {
    throw new Error(`Cannot promote: gate not approved — ${gate.reason}`);
  }

  // SAFETY CHECK: Ensure we're not promoting to live
  if (candidate.status === "PROMOTED_TO_PAPER") {
    throw new Error("Candidate already promoted to paper");
  }

  candidate.status = "PROMOTED_TO_PAPER";
  candidate.updatedAt = new Date().toISOString();
  gate.promotedAt = new Date().toISOString();

  logger.info(
    "candidate",
    `Promoted to PAPER: ${candidate.id} — ${candidate.strategyId} v${candidate.version}`
  );

  // SAFETY LOG: Ensure this is logged for audit
  logger.warn(
    "candidate",
    `AUDIT: Paper promotion executed. Candidate ${candidate.id} promoted to paper trading only. LIVE TRADING REMAINS DISABLED.`
  );

  return candidate;
}

// ─── Helpers ────────────────────────────────────────────────────────

function calculateImprovement(control: BaselineMetrics, candidate: BaselineMetrics): number {
  if (control.winRate === 0) return candidate.winRate > 0 ? 100 : 0;
  return ((candidate.winRate - control.winRate) / control.winRate) * 100;
}

// ─── Query Functions ────────────────────────────────────────────────

export function canPromoteToLive(): boolean {
  // SAFETY: This always returns false in Phase 6
  // Live promotion requires external human approval
  logger.warn("candidate", "Attempted live promotion check — always DENIED in Phase 6");
  return false;
}
