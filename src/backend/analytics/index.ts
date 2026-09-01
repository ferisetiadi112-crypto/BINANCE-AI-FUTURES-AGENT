/**
 * Analytics Module — BINANCE AI FUTURES AGENT v0.1
 *
 * Barrel export for all analytics engines:
 *   - Baseline Performance
 *   - Confidence Calibration
 *   - A/B Experiments
 *   - Candidate Management
 *   - Versioning
 */

export {
  calculateBaseline,
  calculateBaselineBreakdown,
} from "./baseline";

export type {
  BaselineMetrics,
  BaselineBreakdown,
} from "./baseline";

export {
  calibrateConfidence,
  getConfidenceBucketLabel,
} from "./calibration";

export type {
  ConfidenceBucket,
  CalibrationResult,
} from "./calibration";

export {
  createExperiment,
  startExperiment,
  updateExperimentMetrics,
  completeExperiment,
  rejectExperiment,
  evaluateExperiment,
} from "./experiment";

export type {
  Experiment,
  ExperimentMetrics,
  ExperimentStatus,
} from "./experiment";

export {
  createCandidate,
  validateCandidate,
  rejectCandidate,
  evaluatePromotion,
  promoteToPaper,
  canPromoteToLive,
} from "./candidate";

export type {
  StrategyCandidate,
  CandidateStatus,
  PromotionGate,
} from "./candidate";

export {
  createVersion,
  activateVersion,
  archiveVersion,
  deprecateVersion,
  getVersionHistory,
  trackDecisionVersion,
  formatVersionString,
} from "./versioning";

export type {
  Version,
  VersionType,
  VersionState,
  VersionHistory,
  DecisionVersion,
} from "./versioning";
