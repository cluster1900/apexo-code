// Compatibility with existing OpenCode installs (Apexo is derived from OpenCode).
//
// Every place that still accepts the old "opencode" names reads them from this module, so
// files and settings already on users' machines keep working after the rename.
export const LEGACY_NAME = "opencode"

// ~/.config/opencode, ~/.local/share/opencode, ~/.cache/opencode, ~/.local/state/opencode
export const LEGACY_APP_DIR_NAME = LEGACY_NAME
// opencode.json / opencode.jsonc config files
export const LEGACY_CONFIG_NAME = LEGACY_NAME
// project-level .opencode/ config directories
export const LEGACY_CONFIG_DIR = "." + LEGACY_NAME
// OPENCODE_* environment variables
export const LEGACY_ENV_PREFIX = "OPENCODE_"
// opencode.db / opencode-<channel>.db session databases
export const LEGACY_DB_NAME = LEGACY_NAME
// the "Classic" theme's previous id
export const LEGACY_THEME_ID = LEGACY_NAME
// web/desktop UI storage keys ("opencode.global.dat", ...)
export const LEGACY_STORAGE_PREFIX = LEGACY_NAME + "."
// desktop app id, used for the previous Electron userData directory
export const LEGACY_DESKTOP_APP_ID = "ai.opencode.desktop"
// The plugin SDK is published on npm under its upstream name; config directories install it
// under the @apexo/plugin alias so local plugins and tools import "@apexo/plugin".
export const PLUGIN_SDK_NPM_SPEC = "npm:@opencode-ai/plugin"

// Copy legacy OPENCODE_<NAME> variables to APEXO_<NAME> when the Apexo name is not set.
export function applyLegacyEnv(env: Record<string, string | undefined> = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(LEGACY_ENV_PREFIX) || value === undefined) continue
    const next = "APEXO_" + key.slice(LEGACY_ENV_PREFIX.length)
    if (env[next] === undefined) env[next] = value
  }
}
