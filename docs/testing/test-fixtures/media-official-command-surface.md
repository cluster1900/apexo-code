# BUG-20261014-032: Official pager commands are not advertised by installed ACP

- Scope: The installed Grok media comparison script.
- Observed behavior: An added assertion expecting `imagine` and `imagine-video` in ACP `available_commands_update` failed. All media tool and S3 protocol assertions had already passed. The installed runtime's advertised command list omitted both names.
- Expected behavior: The comparison must distinguish pager CLI command implementations from commands exposed over ACP, and report unsupported comparison surfaces explicitly.
- Reproduction: Start the installed Grok ACP backend in the isolated media fixture, capture available-command updates, and look for the two Imagine commands.
- Root cause: The fixture assumed the pinned source's pager commands were also advertised through installed ACP. That surface equivalence is not established.
- Fix: Preserve and report explicit boolean command-advertisement results instead of asserting an unsupported surface. Keep real media execution assertions. Native official pager command interaction remains unverified; source inspection confirms the pinned implementations.
- Verification: The failure directly demonstrated absence from the observed ACP list. The corrected script rerun passed all three official media scenarios and reported both command-advertisement booleans as false. Apexo CLI and Desktop command execution tests independently passed.
- Occurrences: One observed fixture assumption failure. No recurring constraint is promoted.
