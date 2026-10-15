# Native Memory UI production composer comparison

This is a performance observation, not a bug occurrence or proof of a causal speed change.

The before artifact is the preserved production App build immediately before the Memory UI integration. The after artifact is the shared App production build with that integration. Both use the same preserved Desktop backend bundle (SHA-256 `e0f021eae5a8214986b92a5b8185f18bb7cb8b576e33d6475f3d7f689ceb5cbd`), isolated fixture data and the same browser measurement harness. Each reload measures browser-clock time from requesting reload to the first animation frame with a visible composer.

| Run order | Artifact | Samples | Median | Reported p95 | Long Tasks |
| --- | --- | --- | --- | --- | --- |
| First | Before | 10 | 321.5 ms | 356 ms | 0 |
| Second | After | 10 | 119 ms | 134 ms | 0 |
| Third | After | 10 | 124.5 ms | 141 ms | 0 |
| Fourth | Before | 10 | 120.5 ms | 137 ms | 0 |

The large first-pair difference prompted a reversed-order comparison using the same immutable artifacts and backend. The reversed pair differs by four milliseconds in both reported median and p95. The initial slower baseline remains included; its cause was not isolated. These small samples under a shared development host do not establish an improvement or regression, and do not measure model latency. Navigation/resource timing and host load were retained with each sample. All four commands completed with exit zero and cleaned up their owned processes.

Functional evidence is separately recorded in [Native Memory management UI](../../native-memory-ui.md): real browser and native-window checks, pure-native and packaged mixed-server terminal checks, and zero management-induced provider requests.
