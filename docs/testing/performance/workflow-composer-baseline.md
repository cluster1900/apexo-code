# Workflow UI composer benchmark

The immediate pre-Workflow baseline is the isolated [side-question sample](side-question-composer-baseline.md): 110 ms median and 118 ms p95 after two warmups.

Run from `packages/apexo` with pinned Bun 1.3.14:

```sh
bun script/grok-plugins-ui.mjs desktop --benchmark --benchmark-only
```

The final production App and Desktop artifacts included the Workflow ordering and paused-stop fixes. The full unit and typecheck gates had exited, and every agent freshly confirmed no active test or build processes before this exclusive measurement. The benchmark exited successfully and cleaned up its owned fixture processes.

Samples were 123, 117, 106, 109, 115, 120, 112, 104, 110, and 111 ms. After discarding two warmups, median was 110.5 ms and p95 was 120 ms. Compared with 110/118 ms, this sample shows no meaningful observed composer-readiness regression. It does not establish statistical equivalence or measure provider latency or Workflow panel opening time.
