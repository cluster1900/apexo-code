# BUG-20261014-073: Stop comparison assumed snake-case event-specific fields

- **Scope:** Official Stop comparison and local Stop payload compatibility.
- **Observed:** The installed official runtime emitted `lastAssistantMessage` and `stopHookActive`; the fixture read snake-case names and therefore never requested continuation. Its provider-context assertion failed.
- **Expected:** Compare the real emitted event-specific contract and preserve compatibility aliases in Apexo.
- **Reproduction:** Run the extended official Hooks comparison with a Stop command reading only `last_assistant_message`.
- **Root cause:** Common compatibility fields are snake-case, but these official Stop-specific fields are camel-case.
- **Fix:** Read the actual official camel-case fields in the comparator. Apexo emits both these official names and its existing snake-case aliases.
- **Verification:** Official extended comparator passed all ten scenarios, including Stop continuation/force-stop and the eight-continuation cap. Local CLI Stop five-scenario check passed; payload unit assertions passed.
- **Occurrences:** One observed official comparator failure.
