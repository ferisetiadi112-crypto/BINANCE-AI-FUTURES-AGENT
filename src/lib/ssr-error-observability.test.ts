/**
 * Phase 3.5-X — SSR error observability tests.
 *
 * Verifies:
 * - requestId generation (fallback when x-vercel-id absent, header reuse when present)
 * - path/method context capture
 * - error name/message/stack/cause capture
 * - secret-like values are redacted
 * - forbidden keys rejected
 * - error-page render is unaffected (no trading behavior touched)
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  logSsrError,
  redactSecretLike,
  isLoggableKey,
} from "./ssr-error-observability";
import { renderErrorPage } from "./error-page";

afterEach(() => vi.restoreAllMocks());

describe("ssr-error-observability (Phase 3.5-X)", () => {
  it("generates a requestId when x-vercel-id is absent", () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l: unknown) => lines.push(String(l)));
    const req = new Request("https://x.test/command-center");
    const id = logSsrError({ source: "server_top_level", request: req, error: new Error("boom") });
    expect(id).toBeTruthy();
    const payload = JSON.parse(lines[0]!);
    expect(payload.requestId).toBe(id);
    expect(payload.path).toBe("/command-center");
    expect(payload.method).toBe("GET");
    expect(payload.event).toBe("ssr_error");
    expect(payload.error.name).toBe("Error");
    expect(payload.error.message).toBe("boom");
    expect(payload.error.stack).toContain("boom");
  });

  it("reuses x-vercel-id as requestId when present", () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l: unknown) => lines.push(String(l)));
    const req = new Request("https://x.test/dashboard", {
      headers: { "x-vercel-id": "iad1::abc123" },
    });
    const id = logSsrError({ source: "h3_swallowed", request: req, error: new Error("x") });
    expect(id).toBe("iad1::abc123");
    expect(JSON.parse(lines[0]!).requestId).toBe("iad1::abc123");
    expect(JSON.parse(lines[0]!).source).toBe("h3_swallowed");
  });

  it("captures the cause chain", () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l: unknown) => lines.push(String(l)));
    const root = new Error("db down");
    const wrapped = new Error("SSR failed", { cause: root });
    logSsrError({ source: "start_middleware", request: null, error: wrapped });
    const payload = JSON.parse(lines[0]!);
    expect(payload.error.cause).toContain("Error: db down");
  });

  it("redacts secret-like strings from message and stack", () => {
    expect(redactSecretLike("connect postgresql://user:pass@host/db")).toBe(
      "connect postgresql://[REDACTED]",
    );
    expect(redactSecretLike("auth failed for Bearer eyJhbGciOiJ.abc")).toBe(
      "auth failed for Bearer [REDACTED]",
    );
    expect(redactSecretLike("BINANCE_TESTNET_API_KEY=abc123def456ghi789jkl")).toBe(
      "BINANCE_TESTNET_API_KEY=[REDACTED]",
    );
  });

  it("rejects forbidden log keys and allows safe ones", () => {
    for (const k of ["apiKey", "api_secret", "Authorization", "cookie", "DATABASE_URL", "signature", "token"]) {
      expect(isLoggableKey(k)).toBe(false);
    }
    for (const k of ["event", "requestId", "path", "method", "timestamp", "error"]) {
      expect(isLoggableKey(k)).toBe(true);
    }
  });

  it("redacts secrets embedded in the logged error payload", () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l: unknown) => lines.push(String(l)));
    logSsrError({
      source: "server_top_level",
      request: null,
      error: new Error("connect failed: postgresql://user:pass@host/db"),
    });
    expect(lines[0]).not.toContain("user:pass@host");
    expect(lines[0]).toContain("[REDACTED]");
  });

  it("non-Error values are stringified safely", () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l: unknown) => lines.push(String(l)));
    logSsrError({ source: "server_top_level", request: null, error: "plain failure" });
    const payload = JSON.parse(lines[0]!);
    expect(payload.error.name).toBe("string");
    expect(payload.error.message).toBe("plain failure");
  });

  it("renderErrorPage remains unchanged and contains no dynamic data", () => {
    const html = renderErrorPage();
    expect(html).toContain("This page didn't load");
    expect(html).toContain("Something went wrong on our end");
    expect(html).not.toContain("apiKey");
    expect(html).not.toContain("postgres");
  });
});
