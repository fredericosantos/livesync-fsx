# Fork analysis

Baseline: fork of `vrtmrz/obsidian-livesync` at `1.0.3` (`e9b2477b`), branch `fsx-main`.

Goal: CouchDB-only sync against a self-hosted server, with a settings surface a
human can actually hold in their head.

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
