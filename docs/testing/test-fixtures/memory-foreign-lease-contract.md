# BUG-20261015-234: Foreign-lease fixture assumed unsupported store inputs and fields

- **Scope:** One newly authored native Memory foreign-lease case, with two distinct fixture contract assumptions. This is one authoring episode, not a recurring product defect.
- **Observed:** The expanded gate passed 44 tests and failed this case before its ownership assertions with `Integer outside the supported range`. Apexo typechecking separately rejected `lease_owner` and `lease_token` reads on the public `Job` projection.
- **Causes:** The fixture requested a one-millisecond lease below the canonical 1000-millisecond minimum. It also treated the public Job projection as the internal SQL row, although ownership is represented by the separately returned Lease.
- **Fix:** Create an already-expired lease with a valid 1000-millisecond duration. Assert it remains running at attempt one, then successfully settle using the original returned Lease; this behavior proves its ownership survived both flush and explicit retry. Do not expose SQL ownership fields or weaken duration bounds.
- **Verification:** The corrected focused case and final package types are reported in the Stage 1 feature verification. The first edit missed the formatter-expanded duration expression; that unchanged repeated failure is the same unrepaired episode, not a second occurrence.
