import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { POSTHOG_DEFAULT_HOST } from "../shared/contracts.js";

const POSTHOG_CONFIG_RESOURCE_PATH = path.join(
  "generated",
  "posthog-config.json",
);

export type PostHogConfig = {
  apiKey: string;
  host: string;
};

export type ResolvePostHogConfigOptions = {
  env?: NodeJS.ProcessEnv;
  isPackaged?: boolean;
  resourcesPath?: string;
};

/**
 * Resolves Desktop PostHog configuration from the existing local env contract
 * first, then from the packaged generated resource for shipped builds. Invalid
 * keys fail closed and no key value is logged.
 */
export function resolvePostHogConfig(
  options: ResolvePostHogConfigOptions = {},
): PostHogConfig | undefined {
  const env = options.env ?? process.env;
  const envApiKey = toNonEmptyString(env.CL_POSTHOG_API_KEY);
  if (envApiKey) {
    return buildConfigFromKey(envApiKey, env.CL_POSTHOG_HOST);
  }

  const shouldReadPackagedConfig =
    options.isPackaged === true ||
    (options.isPackaged === undefined && Boolean(options.resourcesPath));
  if (!shouldReadPackagedConfig) {
    return undefined;
  }

  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  if (!resourcesPath) {
    return undefined;
  }

  const configPath = path.join(resourcesPath, POSTHOG_CONFIG_RESOURCE_PATH);
  if (!existsSync(configPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
      apiKey?: unknown;
      host?: unknown;
    };
    return buildConfigFromKey(parsed.apiKey, parsed.host);
  } catch {
    return undefined;
  }
}

function buildConfigFromKey(
  apiKey: unknown,
  host: unknown,
): PostHogConfig | undefined {
  const normalizedKey = toNonEmptyString(apiKey);
  if (!normalizedKey?.startsWith("phc_")) {
    return undefined;
  }
  return {
    apiKey: normalizedKey,
    host: toNonEmptyString(host) ?? POSTHOG_DEFAULT_HOST,
  };
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
