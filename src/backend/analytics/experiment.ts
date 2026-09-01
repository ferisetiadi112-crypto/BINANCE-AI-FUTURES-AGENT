/**
 * A/B Experiment Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * Manages controlled experiments for strategy optimization.
 * Every experiment compares a CONTROL (baseline) against a CANDIDATE.
 *
 * Key Principles:
 *   - No automatic strategy promotion
 *   - Experiments run in PAPER/SIMULATION only
 *   - Statistical validation required before any conclusion
 *   - Complete audit trail for every experiment
 */

import type { BaselineMetrics } from "./baseline";
import { logger } from "../logger";

// ─── Experiment Types ───────────────────────────────────────────────

export type ExperimentStatus = "DRAFT" | "RUNNING" | "COMPLETED" | "REJECTED" | "ACCEPTED";

export type ExperimentMetrics = {
  controlSampleSize: number;
  candidateSampleSize: number;
  controlWinRate: number;
  candidateWinRate: number;
  controlPnl: number;
  candidatePnl: number;
  controlExpectancy: number;
  candidateExpectancy: number;
  controlProfitFactor: number;
  candidateProfitFactor: number;
  improvementPercent: number;
  statisticalSignificance: number | null;
  pValue: number | null;
};

export type Experiment = {
  id: string;
  name: string;
  description: string;
  hypothesis: string;
  
  // Control vs Candidate
  control: {
    strategyId: string;
    strategyVersion: string;
    parameters: Record<string, unknown>;
    baseline: BaselineMetrics;
  };
  candidate: {
    strategyId: string;
    strategyVersion: string;
    parameters: Record<string, unknown>;
    baseline: BaselineMetrics | null;
  };
  
  // Timing
  startTime: number;
  endTime: number | null;
  duration: number | null;
  
  // Sample
  sampleSize: number;
  minimumSampleSize: number;
  
  // Status
  status: ExperimentStatus;
  
  // Results
  metrics: ExperimentMetrics | null;
  result: "CONTROL_WINS" | "CANDIDATE_WINS" | "NO_SIGNIFICANT_DIFFERENCE" | "INSUFFICIENT_DATA" | null;
  decision: string | null;
  
  // Metadata
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

// ─── Configuration ──────────────────────────────────────────────────

const MINIMUM_SAMPLE_SIZE = 30;
const SIGNIFICANCE_LEVEL = 0.05; // 95% confidence

// ─── Experiment Engine ──────────────────────────────────────────────

let experimentCounter = 0;

export function createExperiment(config: {
  name: string;
  description: string;
  hypothesis: string;
  controlStrategyId: string;
  controlStrategyVersion: string;
  controlParameters: Record<string, unknown>;
  candidateStrategyId: string;
  candidateStrategyVersion: string;
  candidateParameters: Record<string, unknown>;
  controlBaseline: BaselineMetrics;
}): Experiment {
  experimentCounter++;

  const experiment: Experiment = {
    id: `EXP-${Date.now()}-${experimentCounter}`,
    name: config.name,
    description: config.description,
    hypothesis: config.hypothesis,
    
    control: {
      strategyId: config.controlStrategyId,
      strategyVersion: config.controlStrategyVersion,
      parameters: config.controlParameters,
      baseline: config.controlBaseline,
    },
    candidate: {
      strategyId: config.candidateStrategyId,
      strategyVersion: config.candidateStrategyVersion,
      parameters: config.candidateParameters,
      baseline: null,
    },
    
    startTime: Date.now(),
    endTime: null,
    duration: null,
    
    sampleSize: 0,
    minimumSampleSize: MINIMUM_SAMPLE_SIZE,
    
    status: "DRAFT",
    
    metrics: null,
    result: null,
    decision: null,
    
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  logger.info(
    "experiment",
    `Created experiment: ${experiment.id} — ${experiment.name}`
  );

  return experiment;
}

export function startExperiment(experiment: Experiment): Experiment {
  if (experiment.status !== "DRAFT") {
    throw new Error(`Cannot start experiment in status: ${experiment.status}`);
  }

  experiment.status = "RUNNING";
  experiment.startTime = Date.now();
  experiment.updatedAt = new Date().toISOString();

  logger.info("experiment", `Started experiment: ${experiment.id}`);
  return experiment;
}

export function updateExperimentMetrics(
  experiment: Experiment,
  controlMetrics: BaselineMetrics,
  candidateMetrics: BaselineMetrics,
): Experiment {
  if (experiment.status !== "RUNNING") {
    throw new Error(`Cannot update metrics for experiment in status: ${experiment.status}`);
  }

  // Update baselines
  experiment.control.baseline = controlMetrics;
  experiment.candidate.baseline = candidateMetrics;

  // Update sample sizes
  experiment.sampleSize = controlMetrics.sampleSize + candidateMetrics.sampleSize;

  // Calculate comparative metrics
  const metrics: ExperimentMetrics = {
    controlSampleSize: controlMetrics.sampleSize,
    candidateSampleSize: candidateMetrics.sampleSize,
    controlWinRate: controlMetrics.winRate,
    candidateWinRate: candidateMetrics.winRate,
    controlPnl: controlMetrics.netPnl,
    candidatePnl: candidateMetrics.netPnl,
    controlExpectancy: controlMetrics.expectancy,
    candidateExpectancy: candidateMetrics.expectancy,
    controlProfitFactor: controlMetrics.profitFactor,
    candidateProfitFactor: candidateMetrics.profitFactor,
    improvementPercent: calculateImprovement(controlMetrics, candidateMetrics),
    statisticalSignificance: null, // Will be calculated when sufficient data
    pValue: null,
  };

  experiment.metrics = metrics;
  experiment.updatedAt = new Date().toISOString();

  logger.info(
    "experiment",
    `Updated metrics: ${experiment.id} — control: ${controlMetrics.sampleSize}, candidate: ${candidateMetrics.sampleSize}`
  );

  return experiment;
}

export function completeExperiment(
  experiment: Experiment,
  decision: "CONTROL_WINS" | "CANDIDATE_WINS" | "NO_SIGNIFICANT_DIFFERENCE" | "INSUFFICIENT_DATA",
): Experiment {
  if (experiment.status !== "RUNNING") {
    throw new Error(`Cannot complete experiment in status: ${experiment.status}`);
  }

  experiment.status = "COMPLETED";
  experiment.endTime = Date.now();
  experiment.duration = experiment.endTime - experiment.startTime;
  experiment.result = decision;
  experiment.decision = generateDecisionText(experiment, decision);
  experiment.updatedAt = new Date().toISOString();

  logger.info(
    "experiment",
    `Completed experiment: ${experiment.id} — result: ${decision}`
  );

  return experiment;
}

export function rejectExperiment(experiment: Experiment, reason: string): Experiment {
  experiment.status = "REJECTED";
  experiment.endTime = Date.now();
  experiment.duration = experiment.endTime - experiment.startTime;
  experiment.result = "INSUFFICIENT_DATA";
  experiment.decision = `Rejected: ${reason}`;
  experiment.updatedAt = new Date().toISOString();

  logger.info("experiment", `Rejected experiment: ${experiment.id} — ${reason}`);
  return experiment;
}

// ─── Evaluation ─────────────────────────────────────────────────────

export function evaluateExperiment(experiment: Experiment): {
  canComplete: boolean;
  recommendation: "RUN_LONGER" | "READY_TO_COMPLETE" | "INSUFFICIENT_DATA";
  reason: string;
} {
  if (!experiment.metrics) {
    return {
      canComplete: false,
      recommendation: "INSUFFICIENT_DATA",
      reason: "No metrics available yet",
    };
  }

  const totalSamples = experiment.metrics.controlSampleSize + experiment.metrics.candidateSampleSize;

  if (totalSamples < experiment.minimumSampleSize) {
    return {
      canComplete: false,
      recommendation: "RUN_LONGER",
      reason: `Need ${experiment.minimumSampleSize - totalSamples} more samples (have ${totalSamples}/${experiment.minimumSampleSize})`,
    };
  }

  // Check if improvement is statistically meaningful
  const improvement = experiment.metrics.improvementPercent;
  const hasMinimumImprovement = Math.abs(improvement) > 5; // 5% improvement threshold

  if (!hasMinimumImprovement) {
    return {
      canComplete: true,
      recommendation: "READY_TO_COMPLETE",
      reason: "Improvement is minimal (< 5%), no significant difference",
    };
  }

  return {
    canComplete: true,
    recommendation: "READY_TO_COMPLETE",
    reason: `Sufficient data with ${improvement.toFixed(1)}% improvement`,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function calculateImprovement(control: BaselineMetrics, candidate: BaselineMetrics): number {
  if (control.winRate === 0) return candidate.winRate > 0 ? 100 : 0;
  return ((candidate.winRate - control.winRate) / control.winRate) * 100;
}

function generateDecisionText(
  experiment: Experiment,
  decision: Experiment["result"],
): string {
  switch (decision) {
    case "CANDIDATE_WINS":
      return `Candidate ${experiment.candidate.strategyVersion} outperforms control. Consider paper promotion with monitoring.`;
    case "CONTROL_WINS":
      return `Control ${experiment.control.strategyVersion} performs better. Candidate rejected.`;
    case "NO_SIGNIFICANT_DIFFERENCE":
      return `No significant difference between control and candidate. Keeping current strategy.`;
    case "INSUFFICIENT_DATA":
      return `Insufficient data for conclusive result. Experiment needs more samples.`;
    default:
      return "Evaluation pending";
  }
}
