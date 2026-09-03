/**
 * P7D-3-FIX-CONNECTION-DIAGNOSTIC
 *
 * Safe diagnostic endpoint for production debugging.
 * Reports boolean presence of credentials and connection state.
 * NEVER exposes actual API key or secret values.
 */

import { createServerFn } from "@tanstack/react-start";
import { getOrchestrator } from "../trading/runtime";
import { isTestnetConfigured } from "../exchange/binance-testnet";
import { getTestnetExecutor } from "../exchange/testnet-executor";

export type DiagnosticReport = {
  timestamp: string;
  environment: {
    hasApiKey: boolean;
    hasSecret: boolean;
    paperTrading: boolean;
    tradingEnabled: boolean;
  };
  execution: {
    executionMode: "TESTNET" | "PAPER";
    testnetConfigured: boolean;
    testnetReady: boolean;
    orchestratorExists: boolean;
  };
  connection: {
    status: "UNKNOWN" | "CONFIGURED" | "CONNECTED" | "DISCONNECTED" | "ERROR";
    clientConnected: boolean;
    connectionError: string | null;
    lastSuccessfulSync: number | null;
    lastSyncAttempt: number | null;
    consecutiveFailures: number;
  };
  server: {
    runtimeStarted: boolean;
  };
};

export const getDiagnostic = createServerFn({ method: "GET" }).handler(
  async () => {
    const hasApiKey = !!process.env["BINANCE_TESTNET_API_KEY"];
    const hasSecret = !!process.env["BINANCE_TESTNET_SECRET"];
    const paperTrading = process.env["PAPER_TRADING"] !== "false";
    const tradingEnabled = process.env["TRADING_ENABLED"] === "true";

    const testnetConfigured = isTestnetConfigured();
    const orchestrator = getOrchestrator();
    const orchestratorExists = orchestrator !== null;

    let executionMode: "TESTNET" | "PAPER" = "PAPER";
    let testnetReady = false;
    let connectionError: string | null = null;
    let lastSuccessfulSync: number | null = null;
    let lastSyncAttempt: number | null = null;
    let consecutiveFailures = 0;
    let clientConnected = false;
    let connectionStatus: DiagnosticReport["connection"]["status"] = "UNKNOWN";

    if (orchestrator) {
      executionMode = orchestrator.getExecutionMode();
      testnetReady = orchestrator.isTestnetReady();
      const connState = orchestrator.getConnectionState();
      connectionError = connState.connectionError;
      lastSuccessfulSync = connState.lastSuccessfulSync;
      lastSyncAttempt = connState.lastSyncAttempt;
      consecutiveFailures = connState.consecutiveSyncFailures;
    }

    if (testnetConfigured) {
      const executor = getTestnetExecutor();
      const client = executor.getClient();
      clientConnected = client?.isConnected() ?? false;

      if (testnetReady) {
        connectionStatus = "CONNECTED";
      } else if (clientConnected) {
        connectionStatus = "CONFIGURED";
      } else if (consecutiveFailures > 0) {
        connectionStatus = "ERROR";
      } else {
        connectionStatus = "DISCONNECTED";
      }
    } else {
      connectionStatus = hasApiKey && hasSecret ? "ERROR" : "DISCONNECTED";
    }

    const report: DiagnosticReport = {
      timestamp: new Date().toISOString(),
      environment: {
        hasApiKey,
        hasSecret,
        paperTrading,
        tradingEnabled,
      },
      execution: {
        executionMode,
        testnetConfigured,
        testnetReady,
        orchestratorExists,
      },
      connection: {
        status: connectionStatus,
        clientConnected,
        connectionError,
        lastSuccessfulSync,
        lastSyncAttempt,
        consecutiveFailures,
      },
      server: {
        runtimeStarted: orchestratorExists,
      },
    };

    return { data: report };
  },
);
