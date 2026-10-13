---
name: grok-first-development
description: Use when extending Apexo agent runtime, providers, prompts, tools, auth, or user-facing agent behavior. Keep Grok/xAI as the primary product path and isolate secondary providers behind adapters.
---

# Grok-first development

Treat Grok/xAI as the product identity and the first acceptance path for every agent feature.

## Before changing code

1. Read `docs/grok-agent-expansion.md` and the nearest `AGENTS.md`.
2. Find the existing xAI/Grok provider, model catalog, auth, prompt, and stream-event seams before adding a generic abstraction.
3. Preserve the Session V2 boundaries: durable prompt admission is separate from model execution, and the runner owns continuation.

The default Grok path is `packages/apexo/src/session/llm.ts` → AI SDK `streamText` → `packages/apexo/src/session/llm/ai-sdk.ts` → `LLMEvent`. The xAI model catalog/provider is in the provider layer, OAuth/device-code is in `packages/apexo/src/plugin/xai.ts`, and Grok prompt selection is in `packages/apexo/src/session/system.ts`. `native-runtime.ts` is experimental and xAI currently falls back to AI SDK.

## Implementation rules

- Start with the smallest code slice that proves the Grok behavior. Reuse the existing AI SDK/provider seam before adding a new adapter, catalog, protocol, or lifecycle abstraction.
- Keep one feature per change. Do not add speculative fields, flags, package managers, RPC methods, or generic ranking layers until a real caller needs them.
- Test the Grok path first: auth, model selection, streaming, tool calls, usage, errors, and redaction.
- Keep provider-specific logic in the provider adapter or catalog. Do not scatter xAI branches through the Session runner, tool registry, or HTTP handlers.
- Add an abstraction only when it improves the Grok path or creates a clean adapter seam for a concrete secondary provider.
- Keep OpenAI, Anthropic, Google, and OpenAI-compatible providers optional and isolated. Their limitations must not become Grok's lowest common denominator.
- Preserve the existing HTTP API, ACP, MCP, permission, and Session V2 contracts unless the change explicitly updates the relevant public contract.
- Treat Grok Build ACP as an integration path around Apexo's runtime. Do not move Session V2 admission, permissions, or resource ownership into an external Grok Build process.
- Never add secrets, raw auth headers, or provider responses containing credentials to logs, skills, fixtures, or examples.

## Verification

Verify at least one xAI/Grok model end to end when credentials are available. Otherwise use the repository's provider fixtures and assert that the selected provider, request shape, tool-call mapping, stream events, and error redaction are Grok-correct.
