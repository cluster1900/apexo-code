---
name: apexo-provider-adapter
description: Use when adding or changing xAI/Grok, model catalogs, provider auth, streaming, tool calls, usage, retries, or LLM runtime adapters.
---

# Provider adapter

Grok/xAI is the first-class path. Read `docs/grok-agent-expansion.md` and `packages/apexo/src/session/llm/AGENTS.md` before changing provider code.

The current default path is AI SDK: `packages/apexo/src/session/llm.ts` calls `streamText`, the xAI model is supplied through `@ai-sdk/xai`, and `packages/apexo/src/session/llm/ai-sdk.ts` adapts `fullStream` parts into `LLMEvent`s. `packages/apexo/src/session/llm/native-runtime.ts` is experimental and accepts only the `openai` and `anthropic` provider IDs (with an OpenAI-compatible SDK package shape allowed); xAI falls back to AI SDK. `packages/apexo/src/session/llm/native-request.ts` already contains `XAI.configure(...).responses(...)` lowering, so the current xAI blocker is the native runtime's provider allowlist and `statusWithFetch` auth gate. xAI OAuth/device-code and API-key handling lives in `packages/apexo/src/plugin/xai.ts`, while Grok prompt selection lives in `packages/apexo/src/session/system.ts`.

## Boundaries

- Prefer one minimal AI SDK xAI change at a time. Do not expand native runtime support or refactor the provider catalog as part of an unrelated Grok feature.
- Keep auth, config, model/provider resolution, plugins, permissions, telemetry headers, and runtime selection in the session LLM service boundary.
- Keep request lowering in `native-request.ts`, transport/runtime selection in `native-runtime.ts`, and AI SDK event conversion in `ai-sdk.ts`.
- Make both runtime paths converge on the shared `LLMEvent` stream. Tool execution stays Apexo-owned.
- Preserve one explicit provider stream call per turn and durable history reload before continuation.
- Do not put provider-specific branches in generic Session orchestration, Tool registry, or HTTP handlers.

## Grok acceptance path

For xAI changes, verify the smallest relevant AI SDK path first: OAuth/API key handling, model catalog metadata, context/reasoning/tool-call capabilities, `streamText` request options, `fullStream` event mapping, usage/cost telemetry, retries, timeout behavior, or redaction. Test missing credentials and provider errors without leaking secrets. Do not send xAI work to `native-runtime.ts` unless its support matrix is intentionally expanded.

Secondary providers may use the same adapter seam, but their limitations must not redefine the Grok request or event model. Keep experimental/native runtime flags and fallback behavior intact unless the change explicitly changes that contract.
