# BUG-20261015-340: Exact prompt retry fixture compared mutable promotion state

- Scope: public CLI/Desktop automatic Memory acceptance.
- Observed: the first CLI run failed whole-response equality between the original prompt admission and its exact retry after the ordinary provider turn. The retry included the newly available `promotedSeq`.
- Expected: an exact retry preserves the admitted input identity, admission sequence and prompt, while returning the current durable promotion state.
- Reproduction: admit a prompt with an explicit message ID, wait for execution, retry the identical prompt, then compare the entire responses.
- Root cause: the fixture treated the admission response as an immutable snapshot of all later input fields. Production correctly reconciled the existing input and exposed its promotion.
- Fix: compare `id`, `admittedSeq` and the admitted `prompt`; independently verify one ordinary provider call, one automatic flush and zero additional work on exact/passive retries.
- Verification: source CLI and rebuilt Desktop backend each passed nine checks with ten ordinary, six flush and two summary requests. Exact prompt identity and exact operation retry assertions pass. This record does not classify unrelated startup or operation-settlement timeouts as the same bug.
