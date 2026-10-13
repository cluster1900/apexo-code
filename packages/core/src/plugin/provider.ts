import { AnthropicPlugin } from "./provider/anthropic"
import { AntigravityPlugin } from "./provider/antigravity"
import { DynamicProviderPlugin } from "./provider/dynamic"
import { GooglePlugin } from "./provider/google"
import { OpenAIPlugin } from "./provider/openai"
import { OpenAICompatiblePlugin } from "./provider/openai-compatible"
import { XAIPlugin } from "./provider/xai"
import type { PluginInternal } from "./internal"
import type { Scope } from "effect"

// Native login integrations sit alongside API-key providers. Custom providers remain configurable.
export const ProviderPlugins: PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>[] = [
  AntigravityPlugin,
  AnthropicPlugin,
  GooglePlugin,
  OpenAICompatiblePlugin,
  OpenAIPlugin,
  XAIPlugin,
  DynamicProviderPlugin,
]
