export interface VerifyChallengeOptions {
  challengeToken: string;
  requestOrigin: string;
  userAgent?: string;
  apiOrigin: string;
  apiKey: string;
}

export type VerifyChallengeResult =
  | { ok: true; sessionTtlSeconds: number }
  | { ok: false; error: string; statusCode?: number };

const VERIFY_TIMEOUT_MS = 5_000;

/** Verify a challenge token with the API server using the desktop API key. */
export async function verifyChallenge(
  options: VerifyChallengeOptions
): Promise<VerifyChallengeResult> {
  const url = `${options.apiOrigin}/compute-targets/local-auth/verify`;

  const body: Record<string, string> = {
    challengeToken: options.challengeToken,
    requestOrigin: options.requestOrigin,
  };
  if (options.userAgent) {
    body.userAgent = options.userAgent;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.ok) {
      const data = (await response.json()) as { ok: boolean; sessionTtlSeconds?: number };
      if (data.ok && typeof data.sessionTtlSeconds === "number") {
        return { ok: true, sessionTtlSeconds: data.sessionTtlSeconds };
      }
      return { ok: false, error: "unexpected response format", statusCode: response.status };
    }

    let errorMessage = `verify failed (${response.status})`;
    try {
      const errorData = (await response.json()) as { error?: string };
      if (errorData.error) {
        errorMessage = errorData.error;
      }
    } catch {
      // ignore parse errors
    }

    return { ok: false, error: errorMessage, statusCode: response.status };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "verify request timed out", statusCode: 504 };
    }
    const message = error instanceof Error ? error.message : "network error";
    return { ok: false, error: message, statusCode: 502 };
  } finally {
    clearTimeout(timeout);
  }
}
