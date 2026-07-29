import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

export const DEFAULT_TOGGLE_DASHBOARD_SHORTCUT = "ctrl+shift+t" satisfies KeyId;
export const DEFAULT_FULLSCREEN_DASHBOARD_SHORTCUT = "ctrl+shift+f" satisfies KeyId;

const CONFIG_FILE_NAME = "pi-evo-research.json";

export interface EvoResearchShortcuts {
  toggleDashboard: KeyId | null;
  fullscreenDashboard: KeyId | null;
}

interface EvoResearchShortcutConfig {
  toggleDashboard?: unknown;
  fullscreenDashboard?: unknown;
}

export function evoResearchShortcutsConfigPath(agentDir: string = getAgentDir()): string {
  return join(agentDir, "extensions", CONFIG_FILE_NAME);
}

export function resolveEvoResearchShortcuts(
  configPath: string = evoResearchShortcutsConfigPath()
): EvoResearchShortcuts {
  if (!existsSync(configPath)) {
    return defaultEvoResearchShortcuts();
  }

  const config = readShortcutConfig(configPath);
  if (!config) {
    return defaultEvoResearchShortcuts();
  }

  return {
    toggleDashboard: shortcutFromConfig(
      config.toggleDashboard,
      DEFAULT_TOGGLE_DASHBOARD_SHORTCUT
    ),
    fullscreenDashboard: shortcutFromConfig(
      config.fullscreenDashboard,
      DEFAULT_FULLSCREEN_DASHBOARD_SHORTCUT
    ),
  };
}

function readShortcutConfig(configPath: string): EvoResearchShortcutConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    warnUsingDefaults("Could not read", configPath);
    return null;
  }

  const shortcuts = isRecord(parsed) ? parsed.shortcuts : undefined;
  if (shortcuts === undefined) {
    return {};
  }

  if (!isRecord(shortcuts) || !hasValidShortcutValues(shortcuts)) {
    warnUsingDefaults("Invalid", configPath);
    return null;
  }

  return shortcuts;
}

function hasValidShortcutValues(shortcuts: Record<string, unknown>): boolean {
  return (
    isValidShortcutConfigValue(shortcuts.toggleDashboard) &&
    isValidShortcutConfigValue(shortcuts.fullscreenDashboard)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidShortcutConfigValue(value: unknown): value is string | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value !== "")
  );
}

function shortcutFromConfig(configured: unknown, fallback: KeyId): KeyId | null {
  if (configured === null) return null;
  return typeof configured === "string" ? configured as KeyId : fallback;
}

function defaultEvoResearchShortcuts(): EvoResearchShortcuts {
  return {
    toggleDashboard: DEFAULT_TOGGLE_DASHBOARD_SHORTCUT,
    fullscreenDashboard: DEFAULT_FULLSCREEN_DASHBOARD_SHORTCUT,
  };
}

function warnUsingDefaults(reason: "Could not read" | "Invalid", configPath: string): void {
  console.warn(
    `${reason} pi-evo-research config at ${configPath}; using default shortcuts.`
  );
}
