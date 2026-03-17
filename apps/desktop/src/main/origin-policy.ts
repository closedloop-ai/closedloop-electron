const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function normalizeAndValidateOrigin(rawOrigin: string): string {
  const trimmed = rawOrigin.trim();
  if (!trimmed) {
    throw new Error("Origin is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Origin must be a valid URL");
  }

  if (parsed.protocol === "https:") {
    return parsed.origin;
  }

  if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) {
    return parsed.origin;
  }

  throw new Error(
    "Origin must use https (http is allowed only for localhost/127.0.0.1 in local development)"
  );
}

/** @deprecated Use normalizeAndValidateOrigin instead. */
export const normalizeAndValidateApiOrigin = normalizeAndValidateOrigin;

export function normalizeWebAppOrigin(rawOrigin: string): string {
  const trimmed = rawOrigin.trim();
  if (!trimmed) {
    throw new Error("Web app origin is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Web app origin must be a valid URL");
  }

  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopbackHost(parsed.hostname))) {
    throw new Error(
      "Web app origin must use https (http is allowed only for localhost/127.0.0.1 in local development)"
    );
  }

  return parsed.origin;
}

function isLoopbackHost(hostname: string): boolean {
  if (LOOPBACK_HOSTS.has(hostname.toLowerCase())) {
    return true;
  }
  return isLoopbackIPv4(hostname);
}

function isLoopbackIPv4(hostname: string): boolean {
  if (!hostname.startsWith("127.")) return false;
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}
