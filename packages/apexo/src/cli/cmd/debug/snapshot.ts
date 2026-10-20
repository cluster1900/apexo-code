import { Effect } from "effect"
import { Snapshot } from "../../../snapshot"
import { effectCmd, fail } from "../../effect-cmd"
import { cmd } from "../cmd"

export const SnapshotCommand = cmd({
  command: "snapshot",
  describe: "snapshot debugging utilities",
  builder: (yargs) => yargs.command(TrackCommand).command(PatchCommand).command(DiffCommand).demandCommand(),
  async handler() {},
})

const TrackCommand = effectCmd({
  command: "track",
  describe: "track current snapshot state",
  handler: Effect.fn("Cli.debug.snapshot.track")(function* () {
    const out = yield* Snapshot.Service.use((svc) => svc.track())
    if (!out) return yield* fail("Snapshots are disabled or current directory is not a git repository")
    console.log(out)
  }),
})

const PatchCommand = effectCmd({
  command: "patch <hash>",
  describe: "show patch for a snapshot hash",
  builder: (yargs) =>
    yargs.positional("hash", {
      type: "string",
      description: "hash",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.debug.snapshot.patch")(function* (args) {
    if (!/^[0-9a-f]{7,64}$/i.test(args.hash)) return yield* fail(`Invalid snapshot hash: ${args.hash}`)
    const tracked = yield* Snapshot.Service.use((svc) => svc.track())
    if (!tracked) return yield* fail("Snapshots are disabled or current directory is not a git repository")
    const out = yield* Snapshot.Service.use((svc) => svc.patch(args.hash))
    console.log(out)
  }),
})

const DiffCommand = effectCmd({
  command: "diff <hash>",
  describe: "show diff for a snapshot hash",
  builder: (yargs) =>
    yargs.positional("hash", {
      type: "string",
      description: "hash",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.debug.snapshot.diff")(function* (args) {
    if (!/^[0-9a-f]{7,64}$/i.test(args.hash)) return yield* fail(`Invalid snapshot hash: ${args.hash}`)
    const tracked = yield* Snapshot.Service.use((svc) => svc.track())
    if (!tracked) return yield* fail("Snapshots are disabled or current directory is not a git repository")
    const out = yield* Snapshot.Service.use((svc) => svc.diff(args.hash))
    console.log(out)
  }),
})
