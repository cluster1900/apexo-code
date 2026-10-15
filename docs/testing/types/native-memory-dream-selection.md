# BUG-20261015-248: Dream used projected User fields as Session selection

- **Scope:** Private native Dream implementation, before shared integration.
- **Observed:** Core typechecking rejected `User.agent` (TS2551) and `User.model` (TS2339). A follow-up selection expression retained an optional provider ID where canonical Model.Ref requires one.
- **Expected:** Auxiliary Dream captures the durable Session's selected agent and a fully resolved model; projected user messages are not a parallel selection authority.
- **Cause and fix:** The first draft assumed compatibility-like fields on the native User projection. It now resolves the Session agent/model through the existing native catalogs, resolves the fallback model before constructing an override, and captures the resulting canonical Model.Ref. No cast or schema weakening was used.
- **Verification:** `bun typecheck` in `packages/core` and `packages/apexo` passed. The actual native Dream test consolidates a real observation using the configured model. These diagnostics belong to one draft-authoring episode, not recurring production failures.

Related diagnostics in the same initial typed implementation included recursive inference for `admit` after automatic follow-up called it again, and an `unknown` variant property after a structural `in` check. The recursive controller now states its real Info/error/environment boundary; branch narrowing uses the canonical variant schema. These compiler corrections are separate mistakes within this authoring episode, not additional occurrences of the User-field error. The later conditional Plan/MigrationPlan callback mismatch is recorded independently as the fifth occurrence of BUG-20261015-005.
