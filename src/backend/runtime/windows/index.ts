/**
 * Phase 3.8-A — Windows persistent runtime process entrypoint.
 *
 * Run on Windows (project root):
 *   npm run runtime:windows      (or the project's package-manager equivalent)
 *
 * This file is intentionally minimal: it wires signal handling around the
 * worker. All lifecycle logic lives in worker.ts (testable), and the trading
 * runtime itself is the existing one — no duplicate engine.
 *
 * FOUNDATION ONLY: trading remains disabled (safety gate in loadWorkerConfig).
 */

import { logger } from "../../logger";
import { createWindowsWorker, loadWorkerConfig } from "./worker";

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const worker = await createWindowsWorker(config);
  await worker.start();
  logger.info("windows-runtime", "Windows persistent runtime is live (trading disabled)");

  let exiting = false;
  const handleSignal = (signal: string) => {
    if (exiting) return;
    exiting = true;
    void worker
      .shutdown(`signal:${signal}`)
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error("windows-runtime", `Shutdown error: ${err}`);
        process.exit(1);
      });
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logger.error("windows-runtime", `Unhandled rejection: ${reason}`);
  });
  process.on("uncaughtException", (err) => {
    logger.error("windows-runtime", `Uncaught exception: ${err?.message ?? err}`);
  });
}

void main().catch((err) => {
  // Includes the TRADING_ENABLED=true safety-gate rejection.
  logger.error("windows-runtime", `Worker failed to start: ${err?.message ?? err}`);
  process.exit(1);
});
