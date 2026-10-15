# BUG-20261015-241: Native headless CLI argument typing

- Status: verified by final private package typechecking.
- Scope: private CLI adapter authoring, not an observed released runtime failure.

The first package typecheck reported a string-valued yargs format assigned to the narrowed output union and missing input-id/inputId properties in the existing Mini argument constructor. Explicitly validate the selected format and supply both absent retry-ID spellings when constructing interactive arguments. A subsequent logger amendment used an ordinary conditional array as variadic pipe arguments, which TypeScript correctly rejected; select the complete scoped layer branch instead. A later history-replay loop also assumed the generated event union always had a durable sequence; the adapter now checks that property before using it and rejects malformed history explicitly. These diagnostics belong to one adapter authoring episode.

The complete adapter, logger branch, generated SDK calls and history sequence checks passed `bun typecheck` in `packages/apexo` with exit 0. The separately identified deferred event-property narrowing follows the existing validated-deferred-values constraint and is not counted as a new root cause here.

Shared integration verification: fresh compiled local headless15/20, compiled file handling7/4 and rebuilt mixed Desktop17/22 pass; compiled startup cancellation3/0, active races3/3 and pre-start rejection7/0 also pass. Refreshed shared Core and Apexo package typechecks pass. Commands and exact evidence boundaries are retained in [the shared headless checkpoint](../../native-headless-cli.md#shared-integration-checkpoint); these checks do not replace final repository gates.
