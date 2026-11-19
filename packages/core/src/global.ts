import path from "path"
import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { Flag } from "./flag/flag"
import { makeGlobalNode } from "./effect/app-node"
import { LEGACY_APP_DIR_NAME } from "./legacy-compat"
import { APP_DIR_NAME, migrateAppDirectory } from "./app-directory"

export { APP_DIR_NAME, LEGACY_APP_DIR_NAME }

export function resolveAppDir(base: string, forced = process.env.APEXO_APP_DIR_NAME) {
  return path.join(base, forced || APP_DIR_NAME)
}

const forced = process.env.APEXO_APP_DIR_NAME
const directories = new Map(
  await Promise.all(
    [...new Set([xdgData!, xdgCache!, xdgConfig!, xdgState!])].map(async (base) => {
      const directory = forced
        ? resolveAppDir(base, forced)
        : await migrateAppDirectory(base, APP_DIR_NAME, LEGACY_APP_DIR_NAME)
      return [base, directory] as const
    }),
  ),
)

const data = directories.get(xdgData!)!
const cache = directories.get(xdgCache!)!
const config = directories.get(xdgConfig!)!
const state = directories.get(xdgState!)!
const tmp = path.join(os.tmpdir(), forced || APP_DIR_NAME)

const paths = {
  get home() {
    return process.env.APEXO_TEST_HOME ?? os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
  cache,
  config,
  state,
  tmp,
}

export const Path = paths

Flock.setGlobal({ state })

await Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.tmp, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
  fs.mkdir(Path.repos, { recursive: true }),
])

export class Service extends Context.Service<Service, Interface>()("@apexo/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
  readonly repos: string
}

export function make(input: Partial<Interface> = {}): Interface {
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Flag.APEXO_CONFIG_DIR ?? Path.config,
    state: Path.state,
    tmp: Path.tmp,
    bin: Path.bin,
    log: Path.log,
    repos: Path.repos,
    ...input,
  }
}

const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })

export const layerWith = (input: Partial<Interface>) =>
  Layer.effect(
    Service,
    Effect.sync(() => Service.of(make(input))),
  )

export * as Global from "./global"
