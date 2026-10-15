# BUG-20261015-131: Media acceptance fixture used browser routing in Desktop

- **Scope:** Private media renderer and terminal acceptance scripts; one authoring episode.
- **Observed:** The actual Electron window rendered the first image Session, then timed out waiting for the second tool while still showing the first Session.
- **Expected:** The fixture navigates through the actual application's router and checks the intended Session.
- **Root cause:** Desktop uses Solid MemoryRouter. Browser `history.pushState` plus a PopStateEvent does not update that router.
- **Fix:** Dispatch a normal same-origin anchor navigation through the router's existing delegated click handler; browser navigation keeps its normal history path. No application state is fabricated.
- **Verification:** Actual Electron passed twelve checks across all four media tools and three locales after this correction, including decoded images, positive video dimensions, advancing playback, lazy reads, reload and cleanup.

## Separate setup prerequisites observed during the same acceptance authoring

The initial real mini attach targeted a pure-native server, while current mini/fullscreen bootstrap calls legacy Session endpoints. That broader product transport limitation remains open; this media work adds no execution adapter.

A mixed-server attempt then returned explicit `ConfigInvalidError` because its compatibility route read a pure V2 `permissions` document. The fixture now selects a coherent V1 provider/model/permission document for the mixed server, which both loaders support; the direct legacy Session GET then returned 200 for the same native-created Session. This explicit rejection is distinct from BUG-20261014-252's silent dropping of native-only fields under V1 decoding, and is not counted as its recurrence.

The first source CLI child also started outside the package directory and missed the package's OpenTUI preload, reporting missing `react/jsx-dev-runtime`. The fixture now starts the source entrypoint with the package working directory and passes the isolated working directory through the real `--dir` option. No preload or production fallback is added. With these prerequisites corrected, both actual mini and fullscreen booted. The mixed server returned 200 for the native-created Session, but its legacy transcript endpoint returned `[]` while the native endpoint returned three messages. Both media transcript assertions remain red; this broader native CLI transcript boundary is not counted as a fixture fix or successful media acceptance.
