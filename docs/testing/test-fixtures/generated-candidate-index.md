# BUG-20261014-100: Generated-Output Gate Compared an Unstaged Candidate to the Old Index

- Status: Validation setup corrected; candidate consistency verified.
- Type: Test fixture / generated artifact validation.
- Affected scope: `packages/client` generated Promise and Effect clients.
- Independent occurrences: 1 observed gate invocation. No generator defect or recurring constraint is claimed.

## Observed and expected behavior

`bun run check:generated` regenerated the new Workflow and side-question client APIs, then exited with status 1 because its `git diff --exit-code` step compared the unstaged generated candidate with the old Git index. The candidate must regenerate identically before staging or committing, and CI must find no drift after the candidate is committed.

## Reproduction and root cause

Run the gate after changing Protocol and regenerating clients, while generated changes remain unstaged. The gate intentionally compares against the index; an API change alone does not indicate nondeterministic generation.

## Correction

Prepare an isolated Git index from `HEAD`, add only the candidate generated directories to that index, and run the unchanged `bun run check:generated` with `GIT_INDEX_FILE` pointing to it. Remove that temporary index afterward. This checks regeneration against the proposed outputs without changing the real index, source, or CI command. It does not replace the final committed CI check.

## Verification

The unchanged `bun run check:generated` passed against the isolated candidate index. Generation produced no changes against that candidate; the real Git index was unchanged. The ordinary unstaged invocation remains an expected failure until the new generated outputs are staged or committed.
