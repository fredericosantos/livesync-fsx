# Fork analysis

Baseline: fork of `vrtmrz/obsidian-livesync` at `1.0.3` (`e9b2477b`), branch `fsx-main`.

Goal: CouchDB-only sync against a self-hosted server, with a settings surface a
human can actually hold in their head.

## Severed from upstream

13th August 2026. The `upstream` remote has been removed and the repository
renamed to `livesync-fsx`, matching the plug-in id. Nothing here shares a name
with `vrtmrz/obsidian-livesync` any more.

The reason was concrete: dev builds of this fork were repeatedly written into a
real vault's `.obsidian/plugins/obsidian-livesync/` folder, overwriting the
upstream plug-in installed there, because the folder name and the plug-in id were
assumed to be the same thing. `scripts/install-local.sh` now derives the
destination from `manifest.json` and refuses any folder holding a different
plug-in; `test/e2e-obsidian/runner/pluginId.ts` does the same for the test
harness, with `pluginId.test.ts` failing if the two ever part company.

The cost, stated plainly so nobody is surprised by it later: upstream fixes to
sync correctness and security no longer arrive. `e9b2477b` is the only reference
point left. Re-adding the remote for a one-off `git fetch` remains possible:

```
git remote add upstream https://github.com/vrtmrz/obsidian-livesync.git
```

`livesync-commonlib` — which holds the sync engine — keeps its own upstream
remote and its "track, do not diverge" policy. That is where sync correctness
actually lives, and it played no part in the above.

## The key structural fact

The sync engine is **not in this repo**. It is `@vrtmrz/livesync-commonlib@0.1.2`,
a published npm package from a separate repository. This repo is the Obsidian
host: settings UI, commands, Obsidian API glue.

Consequences:

- We do not own sync correctness. Chunking, replication, conflict handling, and
  E2EE all stay upstream and arrive via `npm update`. This removes the main
  reason not to fork.
- `ObsidianLiveSyncSettings` is defined in commonlib. We cannot delete keys from
  the type without forking commonlib too — and we should not want to. Deleting a
  key breaks migration from existing installs.
- Therefore the settings work is **not "delete keys". It is "expose fewer keys".**
  The type stays whole; the UI shrinks. Migration and commonlib upgrades keep
  working untouched.

### Update: commonlib is forked too

`fredericosantos/livesync-commonlib`, cloned beside this repository,
branch `fsx-main` at `6aa42da` (0.1.2) — the exact commit this plugin pinned, so
the baseline is reproducible. Upstream `main` is already at 0.1.4.

This repo now consumes it locally:

```
"@vrtmrz/livesync-commonlib": "file:../livesync-commonlib/.package"
```

Note the `.package` suffix. `npm run build:package` generates the publishable
package — with its 117-entry `exports` map — into `.package/`, not the repo root.
Pointing `file:` at the repo root resolves nothing. `.package` is gitignored, so
**commonlib must be built before this repo will install.**

Baseline verification, all on the 0.1.2 branch:

- commonlib `npm test` — 69 files, 1216 tests, green
- plugin `npm run build` — 3.7M `main.js`
- plugin `npm run test:unit` — 86 files, 604 tests, green
- plugin `npm run tsc-check` — was **20 errors, all pre-existing upstream**
  (`ObsidianServiceHub.ts` ×10, `createLiveSyncBrowserServiceHub.ts` ×8,
  `ObsidianAPIService.ts`, `LiveSyncBrowserAPIService.ts`).

  **Fixed, 13th August 2026: both typechecks are clean, and are now a gate.**
  Nearly all of it was one cause. `ObsHttpHandler extends FetchHttpHandler`, but
  the copy of `@smithy/fetch-http-handler` resolved by the plug-in and the copy
  resolved inside `livesync-commonlib` are two installations of the same
  package, and a private field makes two declarations of a class nominally
  distinct however identical they are. So the subclass was not assignable to its
  own base's return type, and every hub holding that service failed with it.
  `ObsidianAPIService` now takes the type from the base class instead of
  importing it, so only one declaration is ever in play.

  The rest was ours: the CLI still read `syncOnStart`, `periodicReplication`,
  `syncOnSave`, `syncOnEditorSave`, `syncOnFileOpen` and `syncAfterMerge` after
  those settings were removed. Continuous replication is the only mode, so the
  daemon captures and restores `liveSync` alone.

Owning commonlib means owning sync correctness. Policy: **track, do not diverge.**
Merge `upstream/main` regularly, keep patches thin and on top. The 1216-test suite
is the safety net; run it before every merge.

## Settings surface

167 keys in `SETTINGS_SCHEMA_DEFAULTS`.

| Group | Keys | Disposition |
| --- | ---: | --- |
| P2P / WebRTC | 21 | delete from UI |
| S3 / bucket | 7 | delete from UI |
| CouchDB | 7 | keep, this is the only backend |
| Everything else | 132 | see below |

Backend removal only accounts for 28. The bulk is elsewhere, and falls into
recognisable piles:

- **Superseded generations.** Customisation sync exists in four overlapping
  forms: `usePluginSettings`, `usePluginSync` / `autoSweepPlugins` /
  `autoSweepPluginsPeriodic` / `showOwnPlugins`, `usePluginSyncV2` /
  `usePluginEtc`, and `settingSyncFile` / `writeCredentialsForSettingSync` /
  `notifyAllSettingSyncFile`. Chunking similarly: `enableChunkSplitterV2` is
  superseded by `chunkSplitterVersion`. "Eden" (`useEden`, `maxChunksInEden`,
  `maxTotalLengthInEden`, `maxAgeInEden`) is a retired caching experiment.
- **Performance knobs that should be automatic** (~20): `batch_size`,
  `batches_limit`, `hashCacheMaxCount`, `hashCacheMaxAmount`,
  `concurrencyOfReadChunksOnline`, `minimumIntervalOfReadChunksOnline`,
  `savingDelay`, `gcDelay`, `sendChunksBulk*`, `syncMinimumInterval`,
  `batchSave*`. Upstream already ships known-good values as
  `TweakValuesRecommendedTemplate` — apply those and stop asking.
- **Platform detection masquerading as configuration**:
  `useCustomRequestHandler`, `useRequestAPI`, `disableRequestURI`,
  `useIndexedDBAdapter`. The correct value is a function of the platform.
- **Ad-hoc tiering**: `useAdvancedMode`, `usePowerUserMode`, `useEdgeCaseMode`,
  `enableDebugTools`. These are a tier system built as four booleans. A single
  `tier` field per setting replaces all of them.
- **Eight booleans for one question.** `liveSync`, `syncOnSave`, `syncOnStart`,
  `syncOnFileOpen`, `syncOnEditorSave`, `periodicReplication` (+interval),
  `keepReplicationActiveInBackground` all answer "when do we sync?" and can be
  set to mutually contradictory combinations. This is one enum.

Realistic target for the default pane: **8 settings**. Advanced: ~25. Everything
else internal.

## Do not reinvent: the mismatch metadata already exists

`commonlib/common/models/tweak.definition.js` already exports exactly the
metadata proposed as a new "schema table":

- `TweakValuesShouldMatchedTemplate` — 18 keys that must agree across devices:
  `minimumChunkSize`, `longLineThreshold`, `encrypt`, `usePathObfuscation`,
  `enableCompression`, `useEden`, `customChunkSize`, `useDynamicIterationCount`,
  `hashAlg`, `enableChunkSplitterV2`, `maxChunksInEden`, `maxTotalLengthInEden`,
  `maxAgeInEden`, `usePluginSyncV2`, `handleFilenameCaseSensitive`,
  `useSegmenter`, `E2EEAlgorithm`, `chunkSplitterVersion`
- `IncompatibleChanges` — changing these requires a rebuild: `encrypt`,
  `usePathObfuscation`, `useDynamicIterationCount`, `handleFilenameCaseSensitive`
- `CompatibleButLossyChanges` — changing these silently loses dedup: `hashAlg`,
  `customChunkSize`, `chunkSplitterVersion`
- `TweakValuesRecommendedTemplate` — upstream's known-good tuning values

The data is present. What is missing is a UI that **names the offending key**.
The current failure mode is the string "Some mismatches have been detected in the
configuration between devices", which is undiagnosable. Rendering a diff of these
18 keys is a small, high-value first change.

## Open thread

`customChunkSize` is `60` locally against a schema default of `0`, and sits in
`CompatibleButLossyChanges`. Prime suspect for the live mismatch warning between
macbook-pro and macbook-air-m2. Diff pending — the Air was asleep at time of
writing. Local snapshot of all 18 keys is recorded above the fold in the session
scratchpad.

## CouchDB capability gaps (server-side, no fork required)

Ranked. Items 1, 2, 4, 5, 6 need no plugin change at all.

1. `validate_doc_update` — currently unused. The server accepts any document from
   any client. ~50 lines of JS buys schema-version enforcement, doc-size caps and
   rejection of clients below a minimum version.
2. Per-device `_users` accounts — one shared credential today. Per-device
   accounts give per-device revocation. Combined with (1), stamping
   `userCtx.name` into documents gives server-verified authorship;
   `deviceAndVaultName` is client-asserted and forgeable. Note `useJWT` /
   `jwtAlgorithm` / `jwtKey` / `jwtKid` / `jwtSub` / `jwtExpDuration` already
   exist in settings — JWT is the cleaner path to per-device credentials.
3. Filtered replication — the whole database goes to every device today. CouchDB
   supports selector-based replication natively; it is simply unwired. Biggest
   mobile win.
4. `_replicator` database — server-driven continuous replication to a second
   CouchDB gives a live backup replica with zero client involvement.
5. `_purge` and compaction — deleted notes leave tombstones and orphaned chunks
   forever; the current answer is a full rebuild.
6. `_security` objects and roles — read-only devices, isolated multi-vault.

Skipped: Nouveau full-text search. Obsidian already searches locally.

## Order of work

1. Server-side hardening on ubuntu-server. No fork involved, immediate value.
2. Mismatch diff UI that names the offending key.
3. Drop P2P and S3 from the UI and from the build.
4. Settings tiering over the existing commonlib type.
