---
name: apexo-ci-release
description: Use when validating, committing, pushing, or preparing a pull request for Apexo changes.
---

# Apexo CI and release

Read the repository root `AGENTS.md` and package-specific instructions before making changes.

## Branch and commit

- Never commit, push, or merge directly to `main`.
- Use a short branch name of at most three hyphen-separated words, with no slash or type prefix.
- Use conventional commit style: `type(scope): summary` with `feat`, `fix`, `docs`, `chore`, `refactor`, or `test`.
- Open a PR to `main` and wait for required CI before merging.

## Required checks

From the repository root run:

```sh
bun turbo typecheck --concurrency=2
GITHUB_ACTIONS=false bun turbo test --concurrency=2
```

From the repository root, run each package-local check in its own subshell:

```sh
(cd packages/client && bun run check:generated)
(cd packages/apexo && bun run test:httpapi)
```

Turbo typecheck/test commands run from the repository root and enter each package through Turbo. The package's own `bun test` must run from its package directory, never from the repository root. If a public Protocol or Server HttpApi changed, regenerate the client from source before these checks. Never edit generated files by hand.
