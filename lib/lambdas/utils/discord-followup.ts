const fetch = globalThis.fetch;

const RETRYABLE_ERROR_CODES = new Set([
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
]);

function isRetryableNetworkError(error: any): boolean {
  if (!error) return false;
  return error.name === 'AbortError' ||
         error.name === 'TypeError' ||
         RETRYABLE_ERROR_CODES.has(error.code);
}

/**
 * Send a deferred follow-up message to a Discord interaction. Retries on 5xx
 * responses and transient network errors. Throws on 4xx (which won't succeed
 * on retry) and on final failure after exhausting attempts.
 */
export async function sendFollowUpMessage(
  applicationId: string,
  token: string,
  content: any,
  retries: number = 2,
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${token}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'HuginBot/1.0',
        },
        body: JSON.stringify(content),
        signal: controller.signal,
      });

      if (response.ok) return;

      const errorBody = await response.text();
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Discord API client error ${response.status}: ${errorBody}`);
      }

      if (attempt < retries) {
        await delay((attempt + 1) * 1000);
        continue;
      }
      throw new Error(`Discord API returned ${response.status}: ${errorBody}`);
    } catch (error: any) {
      if (isRetryableNetworkError(error) && attempt < retries) {
        await delay((attempt + 1) * 1000);
        continue;
      }
      console.error('Discord follow-up failed:', error.message || error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
