// Exponential backoff with full jitter. Only errors marked retryable are retried.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const isRetryable = (error) => error?.retryable === true

/** Delay before retry number `attempt` (1-based): random in [0, min(maxMs, baseMs * 2^(attempt-1))]. */
export function backoffDelay(attempt, { baseMs = 500, maxMs = 8000, random = Math.random } = {}) {
  const cap = Math.min(maxMs, baseMs * 2 ** (attempt - 1))
  return Math.round(random() * cap)
}

/**
 * Runs fn(attempt) and retries it up to `retries` more times on retryable errors.
 * Non-retryable errors are thrown at once.
 */
export async function retry(fn, { retries = 3, baseMs = 500, maxMs = 8000, shouldRetry = isRetryable, onRetry, sleepFn = sleep, random } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt)
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error
      const delay = backoffDelay(attempt + 1, { baseMs, maxMs, random })
      onRetry?.(error, attempt + 1, delay)
      await sleepFn(delay)
    }
  }
}
