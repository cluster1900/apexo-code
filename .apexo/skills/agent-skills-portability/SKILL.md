---
name: agent-skills-portability
description: Use when creating, reviewing, or porting SKILL.md instructions across Apexo, Pi, Claude Code, Codex, or another Agent Skills-compatible runtime.
---

# Portable Agent Skills

Keep skills useful across runtimes while preserving Apexo's Grok-first and Session V2 rules.

## Current Apexo loader

- V1 (`packages/apexo/src/skill/index.ts`) scans `{skill,skills}/**/SKILL.md` under configured directories, global/project `.claude/skills` and `.agents/skills`, plus `skills.paths` and `skills.urls`. V1 requires `name`; `description` is optional; it only discovers `SKILL.md`.
- Configured directories come from the project `.apexo` and legacy `.opencode` paths, global `~/.config/apexo`, `APEXO_CONFIG_DIR`, and the directory walk between the project directory and worktree.
- V2 (`packages/schema/src/skill.ts`, `packages/core/src/skill.ts`) uses registered directory/URL/embedded sources and `{*.md,**/SKILL.md}`. A root-level `*.md` can derive `name` from its filename; a nested file without `name` is skipped. `name`, `description`, and `slash` are optional in its decoder.
- Both decoders tolerate extra frontmatter keys and discard them. The current `Info` types do not preserve `license`, `compatibility`, `metadata`, `allowed-tools`, or `disable-model-invocation`.
- A skill without `description` may load successfully but is omitted from V1 `Skill.fmt` and V2 `SkillGuidance`, so the model does not see it in the available-skills system context. `NameMismatchError` exists in V1 but the loader does not currently throw it.
- Do not assume duplicate resolution is stable: V1 loads with unbounded concurrency and the last completed write wins; disk skills can replace the built-in `customize-apexo`. V2 applies sources in registration order and sorts files within each source, with later sources overwriting earlier names.

## Authoring rules

- Use a short lowercase `name` and a precise `description` that says what the skill does and when to invoke it.
- Keep the portable frontmatter minimum as `name` and `description`. Optional fields such as `license`, `compatibility`, `metadata`, `allowed-tools`, and `disable-model-invocation` may be documented for other runtimes, but they are currently discarded by Apexo and must not be treated as runtime behavior.
- Keep paths relative to the skill directory. Put large references, scripts, and examples next to the skill instead of expanding the always-loaded prompt.
- Never include credentials, private URLs, machine-specific absolute paths, or unreviewed executable scripts.
- Keep each skill focused on one workflow and one decision boundary; do not turn a skill into a speculative framework or a copy of the whole repository policy.
- Explain destructive actions, required checks, and source-of-truth files. Prefer links to repository instructions over copying large policy blocks.
- Do not hide product behavior in a skill. Runtime features belong in code, with skills explaining when and how to use them.

## Reload and trust

There is no single user-facing reload contract yet. The target design is for a reload to make new content visible at the next safe provider-turn boundary; an in-flight turn keeps its existing resource snapshot. The minimal V2 cache slice removes the private `Map<string, Info[]>` in `packages/core/src/skill.ts`; if a later `State.reload` caller needs additional invalidation, specify and test that behavior separately rather than expanding the first slice.

Trust/provenance is not implemented yet. Current global and URL skills continue to load. Future trust should be explicit about whether an untrusted skill can be listed, when invocation requires user trust, and which executable capabilities remain unavailable. Do not claim that current discovery is workspace-only or trust-gated.
