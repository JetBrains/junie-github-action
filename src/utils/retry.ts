import pRetry, { AbortError } from "p-retry";

/**
 * Execute an operation with retry logic for transient failures.
 *
 * Retries on:
 * - 5xx errors (500, 502, 503, 504) - temporary server errors
 * - Network errors (no status code)
 *
 * Does NOT retry on:
 * - 404 (Not Found) - permanent error
 * - 422 (Unprocessable Entity) - validation/permanent error
 * - 401/403 (Auth errors) - permanent error
 *
 * @param operation - Async function to execute
 * @param operationName - Human-readable name for logging
 * @param options - Optional retry configuration
 * @returns Result of the operation
 *
 * @example
 * ```ts
 * const result = await executeWithRetry(
 *   () => octokit.rest.pulls.create({...}),
 *   'Create Pull Request'
 * );
 * ```
 */
export async function executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    options?: {
        retries?: number;
        minTimeout?: number;
        maxTimeout?: number;
        factor?: number;
    }
): Promise<T> {
    const {
        retries = 3,
        minTimeout = 1000,
        maxTimeout = 5000,
        factor = 2,
    } = options || {};

    return pRetry(
        async () => {
            try {
                return await operation();
            } catch (error: any) {
                // Ensure we have an Error object for p-retry
                const errorObj = error instanceof Error
                    ? error
                    : new Error(error.message || String(error));

                // Copy status property if it exists
                if (error.status) {
                    (errorObj as any).status = error.status;
                }

                // Don't retry on permanent errors
                if (error.status === 404 || error.status === 422) {
                    console.error(`Non-retryable error for ${operationName}: ${error.message || error}`);
                    throw new AbortError(errorObj);
                }

                // Don't retry on authentication errors
                if (error.status === 401 || error.status === 403) {
                    console.error(`Authentication error for ${operationName}: ${error.message || error}`);
                    throw new AbortError(errorObj);
                }

                // Retry on 5xx errors and network errors
                if (error.status >= 500 || !error.status) {
                    console.warn(`${operationName} failed with status ${error.status || 'unknown'}, will retry: ${error.message || error}`);
                    throw errorObj;
                }

                // For other errors, don't retry
                throw new AbortError(errorObj);
            }
        },
        {
            retries,
            minTimeout,
            maxTimeout,
            factor,
            onFailedAttempt: (error) => {
                console.log(
                    `${operationName} attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`
                );
            }
        }
    );
}
