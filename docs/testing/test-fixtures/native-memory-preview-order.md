# BUG-20261015-266: Migration preview fixture assumed constructor key order

- Type: test fixture.
- Scope: native Memory migration ordering diagnostic.
- Occurrences: one verified authoring episode; no product defect or recurring constraint claimed.

## Observation and expected behavior

The diagnostic constructed a reversed-property preview with `MemoryOperation.MigrationPreview.make` and expected its keys to remain reversed. That assertion failed: the constructor returned schema order. The actual migration had not run when this assertion failed.

## Cause and correction

The pinned Effect schema constructor normalizes property order. The fixture now supplies a raw structurally typed object using `satisfies MemoryOperation.MigrationPreview`, proves that its insertion order differs and its schema value is equivalent, then calls the real native operation. Production code is unchanged: `prepareMigration` already normalizes its expected preview with the same constructor.

## Verification

From `packages/apexo`, with Bun 1.3.14:

```sh
bun test test/v2/memory-dream-native.test.ts --test-name-pattern 'native migration previews'
```

The initial diagnostic failed one assertion before migration. The corrected real Core test passed one test with nine assertions, including actual publication, exact retry using the original property order, preserved source and zero provider calls. No HTTP failure or product repair is claimed.
