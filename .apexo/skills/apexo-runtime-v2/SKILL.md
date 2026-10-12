---
name: apexo-runtime-v2
description: Use when changing Session V2 prompts, runners, wakes, queue/steer delivery, interruptions, replay, context epochs, Location resources, or model execution.
---

# Apexo Session V2 runtime

Read the repository root `AGENTS.md`, `packages/apexo/AGENTS.md`, and any nearer session `AGENTS.md` before editing runtime code.

## Invariants

- Make the smallest change at the existing admission, coordinator, runner, or LLM seam. Do not refactor the whole runner or introduce a second orchestration abstraction for one delivery behavior.
- `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)`, unless `resume: false` requests admit-only behavior.
- The serialized runner promotes admitted inputs into visible user messages at safe provider-turn boundaries. Steers promote by default; queued inputs wait until the session would otherwise become idle.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID is an exact retry only when Session, prompt, and delivery mode match.
- `SessionExecution` is process-global and Session-ID based. A drain is not a durable identity or transcript boundary, and local drains remain process-local until clustering is designed.
- SessionRunner, model resolution, tool registry, permissions, and filesystem are Location-scoped. Do not pass a Session ID into those resource layers.
- Keep one explicit `llm.stream(request)` per provider turn and reload projected history before durable continuation.
- Do not bridge through legacy `SessionPrompt.loop(...)` or introduce an in-memory tool loop.
- Interruption targets the active process-local ownership chain. Idle or missing interruption is a no-op.

## Change procedure

Trace the path from public prompt admission through the durable inbox, wake/coordinator, runner, LLM adapter, event projection, and continuation. Keep admission, scheduling, provider execution, and projection changes separate so a crash or retry cannot duplicate user input or provider work.

When adding a delivery mode, define its persistence, promotion boundary, allowance reset, replay behavior, and exact retry semantics before writing the handler. Add live package tests for concurrent same-Session resumes and independent Sessions.

Avoid changing generated API files. If the public Protocol or Server HttpApi changes, use the `apexo-httpapi-contract` skill.
