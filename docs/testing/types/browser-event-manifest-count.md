# Browser event manifest count baseline

## Bug ID

`BROWSER-MANIFEST-COUNT-001`

## Affected scope

Schema event manifest tests in `packages/apexo`.

## Observed behavior

The full repository test gate failed in `test/event-manifest.test.ts` after Browser durable events were added. The test expected 93 latest public event definitions, while the manifest contained 101 definitions.

## Expected behavior

The manifest size assertion must include every current public event definition, including the eight Browser events introduced by the computer-use feature.

## Reproduction

From the repository root, run:

```sh
GITHUB_ACTIONS=false bun turbo test --concurrency=2
```

The `apexo` test batch containing `test/event-manifest.test.ts` reports `Expected: 93` and `Received: 101`.

## Root cause

The event manifest test uses an explicit count as a duplicate and omission guard. The new Browser event definitions were registered correctly, but the expected count was not updated with the feature.

## Fix

Update the expected latest manifest count from 93 to 101.

## Verification

The manifest test was rerun after the count update. The unrelated full-gate failures were the pre-existing ACP termination and memory Dream timeout cases; they do not involve Browser events.

## Unresolved symptoms

None for the Browser manifest count.
