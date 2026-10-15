# Preserved work awaiting review

These artifacts preserve work that was not integrated when development paused. They are not production features and must not be applied wholesale without reviewing their baselines against the current worktree.

| Work | State at pause | Artifact |
| --- | --- | --- |
| Repository-wide Hook trust | Private implementation and focused tests; integration and broader validation incomplete | [Hook trust handoff](repository-hook-trust/README.md) |
| Optional legacy Memory embeddings/hybrid retrieval/semantic deduplication | Design only; no implementation | [Semantic retrieval design](legacy-memory-semantic-design.md) |
| Structured Session/turn/model usage CLI | Proposed read surface; see handoff for any draft status | [Usage handoff](session-usage/README.md) |

Patch files are portable review artifacts with repository-relative paths. Keep their baseline/final hashes and status together. Applying a patch is a future implementation action, not part of this documentation handoff. No generators, production dependencies or runtime jobs are enabled by these files.
