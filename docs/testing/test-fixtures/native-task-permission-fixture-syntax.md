# BUG-20261015-055: Permission authority fixture had an unmatched closing parenthesis

- **Type:** Test fixture; two independent authoring episodes.
- **Scope:** New native Task inherited-permission test.
- **Observed:** Bun could not parse the fixture's nested Effect/AppNode construction; no policy assertions ran.
- **Expected:** The fixture must construct the real native Permission service and execute its assertions.
- **Cause:** One extra closing parenthesis in the fixture's Effect.provide expression.
- **Fix:** Correct the delimiter; retain the actual service graph and all intended assertions.
- **Verification:** After the separate missing-public-binding correction in BUG-20261014-134, `bun test test/v2/task-authority.test.ts` from `packages/apexo` passed one test and 12 assertions in isolated draft validation. The combined authority/store checkpoint passed two tests and 28 assertions.

## Native media fixture occurrence

While authoring the native media HTTP fixture, one extra closing parenthesis was placed after nested `Effect.promise`, `Bun.write` and `JSON.stringify` calls. Prettier reported `',' expected`; the fixture did not execute. Removing only the unmatched delimiter restored parsing. The first actual native media run then passed one test and 36 assertions, covering all four tools. This is a second independent delimiter-authoring episode, not a production failure or an occurrence of the separate nested-object-shape record.
