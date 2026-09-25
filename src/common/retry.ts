export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_INITIAL_DELAY_MS = 5000;
const DEFAULT_MAX_DELAY_MS = 60_000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

/**
 * Parses Google Gemini / HTTP rate limit retry delay from error messages or objects.
 */
export function extractRetryDelayMs(
  error: unknown,
  fallbackDelayMs: number = DEFAULT_INITIAL_DELAY_MS
): number {
  if (!error) return fallbackDelayMs;

  const errorMessage = error instanceof Error ? error.message : String(error);

  // 1. Google RPC RetryInfo: "retryDelay": "29s" or "29.12s"
  const rpcMatch = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s?"/i.exec(errorMessage);
  if (rpcMatch?.[1]) {
    const seconds = Number(rpcMatch[1]);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000) + 1000; // Add 1s safety buffer
    }
  }

  // 2. Text message: "Please retry in 29.125897657s."
  const textMatch = /retry in (\d+(?:\.\d+)?)s/i.exec(errorMessage);
  if (textMatch?.[1]) {
    const seconds = Number(textMatch[1]);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000) + 1000;
    }
  }

  // 3. Object property retryDelay
  if (typeof error === "object" && error !== null && "retryDelay" in error) {
    const raw = Reflect.get(error, "retryDelay");
    if (typeof raw === "number" && raw > 0) {
      return raw + 1000;
    }
    if (typeof raw === "string") {
      const parsed = Number(raw.replace(/s$/i, ""));
      if (!Number.isNaN(parsed) && parsed > 0) {
        return Math.ceil(parsed * 1000) + 1000;
      }
    }
  }

  return fallbackDelayMs;
}

/**
 * Checks if the error is a rate-limit (429) or transient network error.
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);

  const retryableIndicators = [
    "429",
    "Too Many Requests",
    "RESOURCE_EXHAUSTED",
    "quota exceeded",
    "generatelanguage.googleapis.com/generate_content_free_tier_requests",
    "503",
    "Service Unavailable",
    "504",
    "Gateway Timeout",
    "ECONNRESET",
    "ETIMEDOUT",
    "fetch failed",
  ];

  return retryableIndicators.some((indicator) => message.includes(indicator));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wraps an asynchronous operation with retry logic for rate limits and transient errors.
 */
export async function invokeWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelay = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const multiplier = options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;

  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error: unknown) {
      attempt++;

      if (attempt > maxRetries || !isRetryableError(error)) {
        throw error;
      }

      const calculatedBackoff = Math.min(
        initialDelay * Math.pow(multiplier, attempt - 1),
        maxDelay
      );
      const delayMs = Math.min(extractRetryDelayMs(error, calculatedBackoff), maxDelay);

      if (options.onRetry) {
        options.onRetry(attempt, delayMs, error);
      } else {
        console.warn(
          `[RateLimit] 429 quota limit encountered. Retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt}/${maxRetries})...`
        );
      }

      await sleep(delayMs, options.signal);
    }
  }
}
