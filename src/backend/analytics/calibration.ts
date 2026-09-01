/**
 * Confidence Calibration Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * Tests whether AI confidence has a meaningful relationship with actual outcomes.
 * Confidence is NOT probability of winning until calibrated and proven.
 *
 * Methodology:
 *   Group experiences by confidence bucket
 *   Calculate actual win rate per bucket
 *   Compare confidence vs actual outcome
 *   Calculate calibration metrics
 *
 * Key Principle:
 *   High confidence should correlate with higher win rates.
 *   If it doesn't, confidence thresholds need adjustment.
 */

import type { TradeExperience } from "../ai/experience-engine";
import { logger } from "../logger";

// ─── Calibration Types ──────────────────────────────────────────────

export type ConfidenceBucket = {
  bucket: string;              // e.g., "0.70-0.79"
  minConfidence: number;
  maxConfidence: number;
  sampleSize: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  averagePnl: number;
  expectancy: number;
  averageConfidence: number;
  actualSuccessRate: number;   // Actual win rate
  calibrationGap: number;     // Confidence - actual success rate
};

export type CalibrationResult = {
  buckets: ConfidenceBucket[];
  overallMetrics: {
    totalExperiences: number;
    totalTrades: number;
    averageConfidence: number;
    overallWinRate: number;
    brierScore: number | null;
    calibrationError: number | null;
    reliabilityGrade: "A" | "B" | "C" | "D" | "F" | "INSUFFICIENT_DATA";
  };
  sampleStatus: "INSUFFICIENT_SAMPLE" | "PRELIMINARY" | "VALIDATED";
  minimumSampleSize: number;
  actualSampleSize: number;
  calibrationAssessment: string;
};

// ─── Configuration ──────────────────────────────────────────────────

const BUCKET_RANGES = [
  { min: 0.00, max: 0.49, label: "0.00-0.49" },
  { min: 0.50, max: 0.59, label: "0.50-0.59" },
  { min: 0.60, max: 0.69, label: "0.60-0.69" },
  { min: 0.70, max: 0.79, label: "0.70-0.79" },
  { min: 0.80, max: 0.89, label: "0.80-0.89" },
  { min: 0.90, max: 1.00, label: "0.90-1.00" },
];

const MINIMUM_SAMPLE_PER_BUCKET = 5;
const MINIMUM_TOTAL_SAMPLE = 30;

// ─── Calibration Engine ─────────────────────────────────────────────

export function calibrateConfidence(experiences: TradeExperience[]): CalibrationResult {
  // Filter to actual trades (exclude NO_TRADE for calibration)
  const trades = experiences.filter(e => e.direction !== "NO_TRADE" && e.outcome !== "CANCELLED");

  if (trades.length < MINIMUM_TOTAL_SAMPLE) {
    return createInsufficientSampleResult(trades.length);
  }

  // Group by confidence bucket
  const buckets: ConfidenceBucket[] = [];

  for (const range of BUCKET_RANGES) {
    const bucketExps = trades.filter(
      e => e.confidence >= range.min && e.confidence <= range.max
    );

    if (bucketExps.length === 0) continue;

    const wins = bucketExps.filter(e => e.outcome === "WIN").length;
    const losses = bucketExps.filter(e => e.outcome === "LOSS").length;
    const breakevens = bucketExps.filter(e => e.outcome === "BREAKEVEN").length;

    const winRate = bucketExps.length > 0 ? (wins / bucketExps.length) * 100 : 0;
    const totalPnl = bucketExps.reduce((sum, e) => sum + (e.netPnl ?? 0), 0);
    const averagePnl = totalPnl / bucketExps.length;
    const expectancy = averagePnl;
    const averageConfidence = bucketExps.reduce((sum, e) => sum + e.confidence, 0) / bucketExps.length;

    // Calibration gap: how far actual success rate is from stated confidence
    const actualSuccessRate = winRate / 100;
    const calibrationGap = averageConfidence - actualSuccessRate;

    buckets.push({
      bucket: range.label,
      minConfidence: range.min,
      maxConfidence: range.max,
      sampleSize: bucketExps.length,
      wins,
      losses,
      breakevens,
      winRate,
      averagePnl,
      expectancy,
      averageConfidence,
      actualSuccessRate,
      calibrationGap,
    });
  }

  // Calculate overall metrics
  const totalTrades = trades.length;
  const totalWins = trades.filter(e => e.outcome === "WIN").length;
  const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
  const averageConfidence = trades.reduce((sum, e) => sum + e.confidence, 0) / totalTrades;

  // Brier Score (lower is better, 0 is perfect)
  const brierScore = calculateBrierScore(buckets);

  // Mean Calibration Error
  const calibrationError = calculateCalibrationError(buckets);

  // Reliability Grade
  const reliabilityGrade = determineReliabilityGrade(calibrationError, totalTrades);

  // Sample status
  let sampleStatus: CalibrationResult["sampleStatus"];
  if (totalTrades >= MINIMUM_TOTAL_SAMPLE) {
    sampleStatus = "VALIDATED";
  } else if (totalTrades >= 10) {
    sampleStatus = "PRELIMINARY";
  } else {
    sampleStatus = "INSUFFICIENT_SAMPLE";
  }

  // Assessment
  const calibrationAssessment = generateAssessment(buckets, calibrationError, reliabilityGrade);

  logger.info(
    "calibration",
    `Calibration complete: ${totalTrades} trades, grade: ${reliabilityGrade}, error: ${calibrationError?.toFixed(3) || "N/A"}`
  );

  return {
    buckets,
    overallMetrics: {
      totalExperiences: experiences.length,
      totalTrades,
      averageConfidence,
      overallWinRate,
      brierScore,
      calibrationError,
      reliabilityGrade,
    },
    sampleStatus,
    minimumSampleSize: MINIMUM_TOTAL_SAMPLE,
    actualSampleSize: totalTrades,
    calibrationAssessment,
  };
}

// ─── Statistical Metrics ────────────────────────────────────────────

function calculateBrierScore(buckets: ConfidenceBucket[]): number | null {
  // Brier Score = mean((confidence - outcome)^2)
  // outcome = 1 for win, 0 for loss
  // Lower is better (0 = perfect calibration)

  let totalSquaredError = 0;
  let totalSamples = 0;

  for (const bucket of buckets) {
    if (bucket.sampleSize < MINIMUM_SAMPLE_PER_BUCKET) continue;

    // For each experience in this bucket, squared error = (confidence - outcome)^2
    // Average outcome for bucket = winRate / 100
    const avgOutcome = bucket.winRate / 100;
    const squaredError = Math.pow(bucket.averageConfidence - avgOutcome, 2);

    totalSquaredError += squaredError * bucket.sampleSize;
    totalSamples += bucket.sampleSize;
  }

  if (totalSamples === 0) return null;

  return totalSquaredError / totalSamples;
}

function calculateCalibrationError(buckets: ConfidenceBucket[]): number | null {
  // Mean Absolute Calibration Error
  // |confidence - actual_success_rate| averaged across buckets

  let totalError = 0;
  let totalWeight = 0;

  for (const bucket of buckets) {
    if (bucket.sampleSize < MINIMUM_SAMPLE_PER_BUCKET) continue;

    const error = Math.abs(bucket.calibrationGap);
    totalError += error * bucket.sampleSize;
    totalWeight += bucket.sampleSize;
  }

  if (totalWeight === 0) return null;

  return totalError / totalWeight;
}

function determineReliabilityGrade(
  calibrationError: number | null,
  sampleSize: number,
): CalibrationResult["overallMetrics"]["reliabilityGrade"] {
  if (calibrationError === null || sampleSize < MINIMUM_TOTAL_SAMPLE) {
    return "INSUFFICIENT_DATA";
  }

  if (calibrationError < 0.05) return "A";
  if (calibrationError < 0.10) return "B";
  if (calibrationError < 0.15) return "C";
  if (calibrationError < 0.25) return "D";
  return "F";
}

function generateAssessment(
  buckets: ConfidenceBucket[],
  calibrationError: number | null,
  grade: string,
): string {
  if (calibrationError === null) {
    return "Insufficient data for calibration assessment. Need more trading experiences.";
  }

  const validBuckets = buckets.filter(b => b.sampleSize >= MINIMUM_SAMPLE_PER_BUCKET);

  if (validBuckets.length < 2) {
    return "Too few confidence buckets with sufficient data. Collecting more experiences.";
  }

  // Check if higher confidence correlates with higher win rate
  const sortedByConfidence = [...validBuckets].sort((a, b) => a.minConfidence - b.minConfidence);
  const sortedByWinRate = [...validBuckets].sort((a, b) => b.winRate - a.winRate);

  const isMonotonic = sortedByConfidence.every(
    (b, i) => i === 0 || b.winRate >= (sortedByConfidence[i - 1]?.winRate ?? 0)
  );

  if (grade === "A" || grade === "B") {
    return `Confidence is well-calibrated (grade ${grade}). Higher confidence decisions show higher actual success rates.`;
  }

  if (isMonotonic) {
    return `Confidence shows positive correlation with outcomes but calibration error is moderate (${(calibrationError * 100).toFixed(1)}%). Consider refining confidence thresholds.`;
  }

  return `Confidence calibration needs improvement (grade ${grade}). Higher confidence does not consistently predict better outcomes. Review confidence calculation logic.`;
}

// ─── Helpers ────────────────────────────────────────────────────────

function createInsufficientSampleResult(sampleSize: number): CalibrationResult {
  return {
    buckets: [],
    overallMetrics: {
      totalExperiences: sampleSize,
      totalTrades: 0,
      averageConfidence: 0,
      overallWinRate: 0,
      brierScore: null,
      calibrationError: null,
      reliabilityGrade: "INSUFFICIENT_DATA",
    },
    sampleStatus: "INSUFFICIENT_SAMPLE",
    minimumSampleSize: MINIMUM_TOTAL_SAMPLE,
    actualSampleSize: sampleSize,
    calibrationAssessment: `Insufficient sample size (${sampleSize}/${MINIMUM_TOTAL_SAMPLE}). Need more trading experiences for meaningful calibration.`,
  };
}

// ─── Query Functions ────────────────────────────────────────────────

export function getConfidenceBucketLabel(confidence: number): string {
  for (const range of BUCKET_RANGES) {
    if (confidence >= range.min && confidence <= range.max) {
      return range.label;
    }
  }
  return "0.00-0.49";
}
