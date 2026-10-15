# BUG-20261015-110: Native media redirect fixture exhausted its whole-test deadline

- **Status:** Original timing cause unresolved; no media runtime repair claimed.
- **Scope:** New native HTTP media fixture, API-redirect case.
- **Observed episode:** One eight-case checkpoint had seven passes and a timeout at 5,003.89 ms for the API-redirect case. The whole test used Bun's default five-second deadline, while its completion poll independently allowed 15 seconds. The original failure did not capture its last phase.
- **Expected:** The provider redirect is refused, the redirected target receives zero requests, the tool settles as an error, and the ordinary Session continuation completes without saving output.
- **Bounded diagnosis:** A scoped diagnostic retained the 15-second operation deadline and used an explicit 20-second whole-test deadline. It passed one test and six assertions in 1,623.53 ms. Phase observations showed setup, Session creation, provider request and assertions completing; exactly one API request and zero redirected-target requests occurred. This does not establish the original delay's cause or prove a product fix.
- **Fixture adjustment:** New multi-step native HTTP negative cases have an explicit bounded whole-test budget that accommodates their existing operation deadline and fixture setup/cleanup. No production timeout, retry or transport behavior changed. Temporary phase logging was removed.
- **Remaining boundary:** Do not attribute the original timeout to host contention, redirect handling or any previous timing bug without evidence. A passing scoped rerun alone does not close the observation.

## Shared integration observation

The first shared run passed 13 tests and failed the read-denial case at 5,008.16 ms, with 104 assertions across the suite and clean exit1. The read/edit loop still used the default five-second whole-test deadline while its completion helper allows fifteen seconds. The unchanged focused read-denial run then passed one test / four assertions in 1,918.19 ms. Neither run captured the original last phase, so completion versus teardown delay remains unknown; the original redirect timing cause is not assumed to be the same.

The remaining two denial cases now use the same explicit twenty-second whole-test budget as the other multi-step negative cases. This aligns their outer fixture deadline with the existing operation deadline; it does not change runtime behavior, prove a product repair, or count as a recurring root cause. The adjusted shared suite passed 14 tests / 104 assertions in 16.45 seconds with clean exit0. The original timing observations remain unresolved.

Later shared Plan/media UI checkpoint: the full repository unit command completed all six Turbo tasks successfully, including the Apexo suite’s 4,155 passes, 19 skips, one todo and zero failures across 383 files. This adds a successful aggregate observation, not a causal repair or a new failure occurrence. The earlier unexplained symptom remains an investigation. This aggregate precedes the Shell/media-options integration.
