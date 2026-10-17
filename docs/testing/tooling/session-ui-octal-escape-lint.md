# oxlint octal escape error in session-ui prompt input

- Bug ID: BUG-20261018-390
- Scope: `packages/session-ui/src/v2/components/prompt-input/index.tsx`
- Observed: `bun run lint` reports 1 error, "'0'-prefixed octal literals and octal escape sequences are deprecated", for the Tailwind class `empty:before:content-['\200B']` written as a JSX attribute string.
- Expected: lint has zero errors.
- Root cause: oxlint parses the backslash sequence in the JSX attribute as an octal escape; the intended value is the literal CSS escape `\200B`.
- Fix: pass the class as a JavaScript string expression with an escaped backslash, which yields the identical runtime class string.
- Verification: `npx oxlint` on the file reports 0 errors; typecheck passes.
