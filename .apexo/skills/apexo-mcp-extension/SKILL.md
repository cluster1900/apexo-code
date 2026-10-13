---
name: apexo-mcp-extension
description: Use when adding or changing MCP servers, transports, OAuth, prompts, resources, resource templates, MCP tools, or deferred tool discovery.
---

# MCP extension

Read the current MCP implementation in `packages/apexo/src/mcp/index.ts`, the tool registry, permission rules, and the nearest `AGENTS.md` before editing.

## Requirements

- Implement one transport or capability slice at a time. Reuse the current MCP client and permission path before adding a generalized catalog or lifecycle abstraction.
- Preserve stdio, SSE, Streamable HTTP, and OAuth behavior unless a transport change is intentional.
- Treat prompts, resources, resource templates, and tools as separate capabilities with explicit source and lifecycle state.
- MCP tools must pass through current permission evaluation, input validation, result redaction, and session cancellation. When trust/provenance lands, add its gate before executable registration without weakening those checks.
- A future deferred catalog may discover MCP tools lazily. Use a tool ID such as `tool_search`, never the existing web-search ID `websearch`; it must not bypass permission or register unselected tools into the provider turn.
- Close clients, child processes, streams, and OAuth resources through the existing Effect scope/lifecycle. Future lifecycle work must avoid starting processes from module import side effects; preserve current behavior until that migration is specified.
- Keep MCP errors actionable while removing tokens, authorization headers, and sensitive resource content from logs.

## Verification

Choose focused checks for the capability being changed: for example, a transport change tests the affected local/remote lifecycle, while a tool change tests permission, cancellation, cleanup, duplicate names, and redaction as applicable. Do not require the full MCP matrix for an unrelated one-slice change. Run package tests from `packages/apexo`.
