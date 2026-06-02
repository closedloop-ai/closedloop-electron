import type { CatalogEntry } from "./CatalogCard";

export type PackInstallAction = "install" | "uninstall";

export function resolvePackModalHarness(
  entry: Pick<CatalogEntry, "single_install">,
  harness: string,
  action: PackInstallAction,
): string {
  if (action === "uninstall" && entry.single_install === 1) {
    return "auto";
  }
  return harness;
}

export function resolvePackPreviewCommand(
  entry: Pick<CatalogEntry, "harnesses" | "install_commands" | "uninstall_commands">,
  harness: string,
  action: PackInstallAction,
): string {
  const cmdMap =
    action === "install" ? entry.install_commands : entry.uninstall_commands;

  if (harness === "auto") {
    if (action === "uninstall") {
      return entry.harnesses
        .map((candidate) => cmdMap[candidate])
        .filter((command): command is string => Boolean(command))
        .join(" ; ");
    }
    return cmdMap["codex"] || cmdMap["claude"] || Object.values(cmdMap)[0] || "";
  }

  return cmdMap[harness] || "";
}

export function usesAutoDetectedInstallCommand(
  harness: string,
  action: PackInstallAction,
): boolean {
  return harness === "auto" && action === "install";
}
