/**
 * Versioning System — BINANCE AI FUTURES AGENT v0.1
 *
 * Tracks all versions of AI models, strategies, and parameters.
 * Every decision can be traced back to the exact version used.
 *
 * Versioning ensures:
 *   - Complete audit trail
 *   - Reproducibility
 *   - Rollback capability
 *   - Experiment tracking
 */

import { logger } from "../logger";

// ─── Version Types ──────────────────────────────────────────────────

export type VersionType = "MODEL" | "STRATEGY" | "PARAMETER";

export type VersionState = "ACTIVE" | "CANDIDATE" | "ARCHIVED" | "DEPRECATED";

export type Version = {
  id: string;
  type: VersionType;
  name: string;
  version: string;
  state: VersionState;
  
  // Configuration
  config: Record<string, unknown>;
  
  // Performance (if evaluated)
  metrics: {
    sampleSize: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
  } | null;
  
  // Lineage
  basedOn: string | null; // Previous version ID
  experimentId: string | null;
  
  // Metadata
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type DecisionVersion = {
  modelVersion: string;
  strategyVersion: string;
  parameterVersion: string;
  experimentId: string | null;
};

// ─── Version Management ─────────────────────────────────────────────

let versionCounter = 0;

export function createVersion(config: {
  type: VersionType;
  name: string;
  version: string;
  config: Record<string, unknown>;
  basedOn?: string;
  experimentId?: string;
}): Version {
  versionCounter++;

  const version: Version = {
    id: `VER-${Date.now()}-${versionCounter}`,
    type: config.type,
    name: config.name,
    version: config.version,
    state: "CANDIDATE",
    
    config: config.config,
    
    metrics: null,
    
    basedOn: config.basedOn || null,
    experimentId: config.experimentId || null,
    
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  };

  logger.info(
    "versioning",
    `Created ${config.type} version: ${version.id} — ${config.name} v${config.version}`
  );

  return version;
}

export function activateVersion(version: Version): Version {
  version.state = "ACTIVE";
  version.updatedAt = new Date().toISOString();

  logger.info("versioning", `Activated version: ${version.id}`);
  return version;
}

export function archiveVersion(version: Version): Version {
  version.state = "ARCHIVED";
  version.archivedAt = new Date().toISOString();
  version.updatedAt = new Date().toISOString();

  logger.info("versioning", `Archived version: ${version.id}`);
  return version;
}

export function deprecateVersion(version: Version, reason: string): Version {
  version.state = "DEPRECATED";
  version.archivedAt = new Date().toISOString();
  version.updatedAt = new Date().toISOString();

  logger.info("versioning", `Deprecated version: ${version.id} — ${reason}`);
  return version;
}

// ─── Version History ────────────────────────────────────────────────

export type VersionHistory = {
  current: Version | null;
  history: Version[];
  totalVersions: number;
  activeVersions: number;
};

export function getVersionHistory(versions: Version[]): VersionHistory {
  const sorted = [...versions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const active = sorted.filter(v => v.state === "ACTIVE");

  return {
    current: active[0] || null,
    history: sorted,
    totalVersions: sorted.length,
    activeVersions: active.length,
  };
}

// ─── Decision Tracking ──────────────────────────────────────────────

export function trackDecisionVersion(decision: {
  modelVersion: string;
  strategyVersion: string;
  parameterVersion: string;
  experimentId?: string;
}): DecisionVersion {
  return {
    modelVersion: decision.modelVersion,
    strategyVersion: decision.strategyVersion,
    parameterVersion: decision.parameterVersion,
    experimentId: decision.experimentId || null,
  };
}

export function formatVersionString(v: DecisionVersion): string {
  return `model:${v.modelVersion}|strategy:${v.strategyVersion}|param:${v.parameterVersion}`;
}
