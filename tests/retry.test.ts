import { describe, it, expect } from "bun:test";
import {
  extractRetryDelayMs,
  isRetryableError,
  invokeWithRetry,
} from "../src/common/retry";

describe("Retry Utility & Rate Limit Handling Flow", () => {
  it("extracts retry delay from Google RPC error payload", () => {
    const errorMsg = `[429 Too Many Requests] Quota exceeded. Please retry in 29.125897657s. [{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"29s"}]`;
    const delay = extractRetryDelayMs(new Error(errorMsg));
    // 29s + 1s safety buffer = 30000ms
    expect(delay).toBe(30_000);
  });

  it("extracts retry delay from text pattern 'Please retry in Xs'", () => {
    const errorMsg = `Please retry in 15.5s. Resource has been exhausted.`;
    const delay = extractRetryDelayMs(new Error(errorMsg));
    // 15.5s -> 15500 + 1000 = 16500ms
    expect(delay).toBe(16_500);
  });

  it("falls back to calculated backoff when no delay is in message", () => {
    const errorMsg = `429 Too Many Requests`;
    const fallback = 5000;
    const delay = extractRetryDelayMs(new Error(errorMsg), fallback);
    expect(delay).toBe(fallback);
  });

  it("identifies retryable error messages", () => {
    expect(isRetryableError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRetryableError(new Error("RESOURCE_EXHAUSTED: quota reached"))).toBe(true);
    expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);

    // Non-retryable
    expect(isRetryableError(new Error("400 Bad Request: Invalid tool parameter"))).toBe(false);
    expect(isRetryableError(new Error("401 Unauthorized: Invalid API Key"))).toBe(false);
    expect(isRetryableError(new Error("404 Not Found"))).toBe(false);
  });

  it("retries on retryable errors and succeeds when operation recovers", async () => {
    let callCount = 0;
    const retryDelays: number[] = [];

    const operation = async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("429 Too Many Requests: Please retry in 0.01s.");
      }
      return "SUCCESS";
    };

    const result = await invokeWithRetry(operation, {
      maxRetries: 3,
      initialDelayMs: 10,
      onRetry: (_attempt, delayMs) => {
        retryDelays.push(delayMs);
      },
    });

    expect(result).toBe("SUCCESS");
    expect(callCount).toBe(3);
    expect(retryDelays.length).toBe(2);
  });

  it("aborts retry loop when signal is aborted", async () => {
    const controller = new AbortController();
    let callCount = 0;

    const operation = async () => {
      callCount++;
      // Abort immediately during first failure
      controller.abort(new Error("Cancelled by user"));
      throw new Error("429 Too Many Requests");
    };

    expect(
      invokeWithRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 1000,
        signal: controller.signal,
      })
    ).rejects.toThrow("Cancelled by user");

    expect(callCount).toBe(1);
  });

  it("throws immediately on non-retryable errors without retrying", async () => {
    let callCount = 0;

    const operation = async () => {
      callCount++;
      throw new Error("401 Unauthorized: Invalid key");
    };

    expect(
      invokeWithRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
      })
    ).rejects.toThrow("401 Unauthorized");

    expect(callCount).toBe(1);
  });
});
