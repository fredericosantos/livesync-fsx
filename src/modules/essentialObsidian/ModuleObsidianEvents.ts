import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
import { EVENT_FILE_RENAMED, EVENT_LEAF_ACTIVE_CHANGED, eventHub } from "@/common/events.js";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { scheduleTask } from "octagonal-wheels/concurrency/task";
import type { TFile } from "@/deps.ts";
import { fireAndForget } from "octagonal-wheels/promises";
import { type FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { reactive, reactiveSource, type ReactiveSource } from "octagonal-wheels/dataobject/reactive";
import {
    collectingChunks,
    pluginScanningCount,
    hiddenFilesEventCount,
    hiddenFilesProcessingCount,
} from "@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores";
import type { LiveSyncCore } from "@/main.ts";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

// The four types that used to be here described Obsidian's private command
// registry and CodeMirror's command table, so that the save command could be
// replaced at runtime. Nothing reaches into either any more.

export class ModuleObsidianEvents extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean> {
        // this.registerEvent(this.app.workspace.on("editor-change", ));
        this.plugin.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => {
                eventHub.emitEvent(EVENT_FILE_RENAMED, {
                    newPath: file.path as FilePathWithPrefix,
                    old: oldPath as FilePathWithPrefix,
                });
            })
        );
        this.plugin.registerEvent(
            this.app.workspace.on("active-leaf-change", () => eventHub.emitEvent(EVENT_LEAF_ACTIVE_CHANGED))
        );
        return Promise.resolve(true);
    }

    __performAppReload() {
        this.services.appLifecycle.performRestart();
    }

    /*
     * `swapSaveCommand` was here.
     *
     * It reached into Obsidian's internal command registry, replaced the
     * callback of `editor:save-file` with a wrapper, remembered the original so
     * it could put it back on unload, and separately reassigned
     * `CodeMirrorAdapter.commands.save`. All of it existed to notice the ⌘S
     * keystroke and start a replication — an approximation of continuous
     * replication for people who had turned continuous replication off.
     *
     * Monkey-patching another application's private command table is a large
     * thing to do for a small effect, and the effect is now free: continuous
     * replication is already watching the database when the save lands.
     */

    registerWatchEvents() {
        this.setHasFocus = this.setHasFocus.bind(this);
        this.watchWindowVisibility = this.watchWindowVisibility.bind(this);
        this.watchWorkspaceOpen = this.watchWorkspaceOpen.bind(this);
        this.watchOnline = this.watchOnline.bind(this);
        // Already bound
        // eslint-disable-next-line @typescript-eslint/unbound-method -- The handler is bound above before registration.
        this.plugin.registerEvent(this.app.workspace.on("file-open", this.watchWorkspaceOpen));
        // Already bound
        // eslint-disable-next-line @typescript-eslint/unbound-method -- The handler is bound above before registration.
        this.plugin.registerDomEvent(activeDocument, "visibilitychange", this.watchWindowVisibility);
        this.plugin.registerDomEvent(compatGlobal, "focus", () => this.setHasFocus(true));
        this.plugin.registerDomEvent(compatGlobal, "blur", () => this.setHasFocus(false));
        // Already bound
        // eslint-disable-next-line @typescript-eslint/unbound-method -- The handler is bound above before registration.
        this.plugin.registerDomEvent(compatGlobal, "online", this.watchOnline);
        // Already bound
        // eslint-disable-next-line @typescript-eslint/unbound-method -- The handler is bound above before registration.
        this.plugin.registerDomEvent(compatGlobal, "offline", this.watchOnline);
    }

    hasFocus = true;
    isLastHidden = false;
    private boundedActivityEndHandler?: (value: { readonly value: number }) => unknown;
    private deferredBoundedLifecycle?: "suspend-if-hidden" | "restart-continuous-if-visible";

    private get boundedActivityCounts(): ReactiveSource<number>[] {
        const replicator = this.services.replicator as typeof this.services.replicator & {
            boundedLocalApplicationActivityCount: ReactiveSource<number>;
        };
        return [replicator.boundedRemoteActivityCount, replicator.boundedLocalApplicationActivityCount];
    }

    private hasBoundedActivity() {
        return this.boundedActivityCounts.some((count) => count.value > 0);
    }

    private keepReplicationActiveInBackground() {
        return (
            this.settings.keepReplicationActiveInBackground && this.settings.liveSync && !this.services.API.isMobile()
        );
    }

    private async applyDeferredBoundedActivityLifecycle() {
        if (this.hasBoundedActivity()) {
            this.deferLifecycleUntilBoundedActivityEnds();
            return;
        }
        const deferredLifecycle = this.deferredBoundedLifecycle;
        this.deferredBoundedLifecycle = undefined;
        const keepActiveInBackground = this.keepReplicationActiveInBackground();
        if (deferredLifecycle === "suspend-if-hidden" && activeWindow.document.hidden) {
            if (!keepActiveInBackground) await this.services.appLifecycle.onSuspending();
            return;
        }
        if (
            deferredLifecycle === "restart-continuous-if-visible" &&
            !activeWindow.document.hidden &&
            keepActiveInBackground &&
            this.settings.liveSync
        ) {
            await this.services.appLifecycle.onSuspending();
            await this.services.appLifecycle.onResuming();
            await this.services.appLifecycle.onResumed();
        }
    }

    private deferLifecycleUntilBoundedActivityEnds() {
        if (this.boundedActivityEndHandler) return;
        const counts = this.boundedActivityCounts;
        const handler = () => {
            if (this.hasBoundedActivity()) return;
            for (const count of counts) count.offChanged(handler);
            this.boundedActivityEndHandler = undefined;
            fireAndForget(() => this.applyDeferredBoundedActivityLifecycle());
        };
        this.boundedActivityEndHandler = handler;
        for (const count of counts) count.onChanged(handler);
    }

    setHasFocus(hasFocus: boolean) {
        this.hasFocus = hasFocus;
        this.watchWindowVisibility();
    }

    watchWindowVisibility() {
        scheduleTask("watch-window-visibility", 100, () => fireAndForget(() => this.watchWindowVisibilityAsync()));
    }

    watchOnline() {
        scheduleTask("watch-online", 500, () => fireAndForget(() => this.watchOnlineAsync()));
    }
    async watchOnlineAsync() {
        // If some files were failed to retrieve, scan files again.
        // TODO:FIXME AT V0.17.31, this logic has been disabled.
        if (compatGlobal.navigator.onLine && this.localDatabase.needScanning) {
            this.localDatabase.needScanning = false;
            await this.services.vault.scanVault();
        }
    }

    async watchWindowVisibilityAsync() {
        if (this.settings.suspendFileWatching) {
            if (this.settings.isConfigured && this.services.appLifecycle.isReady() && this.hasBoundedActivity()) {
                const isHidden = activeWindow.document.hidden;
                this.isLastHidden = isHidden;
                this.deferredBoundedLifecycle = isHidden ? "suspend-if-hidden" : undefined;
                this.deferLifecycleUntilBoundedActivityEnds();
            }
            return;
        }
        if (!this.settings.isConfigured) return;
        if (!this.services.appLifecycle.isReady()) return;

        if (this.isLastHidden && !this.hasFocus) {
            // NO OP while non-focused after made hidden;
            return;
        }

        const isHidden = activeWindow.document.hidden;
        if (this.isLastHidden === isHidden) {
            return;
        }

        const boundedActivityInProgress = this.hasBoundedActivity();
        if (!isHidden && boundedActivityInProgress && this.deferredBoundedLifecycle === "suspend-if-hidden") {
            this.isLastHidden = false;
            this.deferredBoundedLifecycle = undefined;
            return;
        }
        this.isLastHidden = isHidden;

        await this.services.fileProcessing.commitPendingFileEvents();

        // Desktop opt-in (LiveSync/Periodic only): keep the background channel running while the
        // window is hidden, instead of suspending on hide. On hide we skip the suspend for both
        // modes (LiveSync's continuous replication and Periodic's timer both stall otherwise);
        // becoming visible reopens normally, and for LiveSync additionally forces a teardown first
        // (see the resume branch) so a stalled continuous channel is always replaced.
        const keepActiveInBackground = this.keepReplicationActiveInBackground();

        if (isHidden) {
            if (boundedActivityInProgress && !keepActiveInBackground) {
                this.deferredBoundedLifecycle = "suspend-if-hidden";
                this.deferLifecycleUntilBoundedActivityEnds();
            } else if (!keepActiveInBackground) {
                await this.services.appLifecycle.onSuspending();
            }
        } else {
            // suspend all temporary.
            if (this.services.appLifecycle.isSuspended()) return;
            if (boundedActivityInProgress && keepActiveInBackground && this.settings.liveSync) {
                this.deferredBoundedLifecycle = "restart-continuous-if-visible";
                this.deferLifecycleUntilBoundedActivityEnds();
                return;
            }
            // Only the continuous (LiveSync) channel can go stalled-but-not-terminated: PouchDB
            // emits paused/retry while the replicator keeps its AbortController set, so the reopen
            // below would no-op on exactly the channel that needs replacing. Force a teardown first
            // so becoming visible always re-establishes a fresh channel (restoring the default's
            // reset-on-visibility). Periodic mode has no such channel — its timer just resumes via
            // the normal path below — so this teardown is gated on liveSync to avoid needlessly
            // bouncing it. The teardown's closeReplication() aborts synchronously while the reopen is
            // deferred (fireAndForget + awaited isReplicationReady/initializeDatabaseForReplication),
            // so the aborted continuousReplication run (and its shareRunningResult lock) unwinds in
            // microtasks before the reopen runs: it neither double-opens nor gets swallowed by the
            // still-registered shared run.
            if (keepActiveInBackground && this.settings.liveSync) {
                await this.services.appLifecycle.onSuspending();
            }
            // Resume is not gated on focus in this branch, but note the top-of-handler check
            // (isLastHidden && !hasFocus) still defers the whole handler when the window becomes
            // visible again while unfocused; in that case recovery happens on the next focus.
            await this.services.appLifecycle.onResuming();
            await this.services.appLifecycle.onResumed();
        }
    }
    watchWorkspaceOpen(file: TFile | null) {
        if (this.settings.suspendFileWatching) return;
        if (!this.settings.isConfigured) return;
        if (!this.services.appLifecycle.isReady()) return;
        if (!file) return;
        scheduleTask("watch-workspace-open", 500, () => fireAndForget(() => this.watchWorkspaceOpenAsync(file)));
    }

    async watchWorkspaceOpenAsync(file: TFile) {
        if (this.settings.suspendFileWatching) return;
        if (!this.settings.isConfigured) return;
        if (!this.services.appLifecycle.isReady()) return;
        await this.services.fileProcessing.commitPendingFileEvents();
        if (file == null) {
            return;
        }
        // No replicate-on-open. Opening a file cannot make it fresher than a
        // connection that has been streaming changes the whole time.
        await this.services.conflict.queueCheckForIfOpen(file.path as FilePathWithPrefix);
    }

    _everyOnLayoutReady(): Promise<boolean> {
        this.registerWatchEvents();
        return Promise.resolve(true);
    }

    /**
     * Schedules the restart a settings change needs.
     *
     * This used to ask, with three answers: restart now, restart once things
     * settle, or "No, Leave it to me". Restarting immediately interrupts
     * whatever the reader is writing; leaving it means the change they just
     * made silently does not apply. The middle answer is the only one that is
     * always right, so it is what happens — and the status bar already shows
     * that a restart is pending, which is the part they needed to know.
     */
    private _askReload(message?: string) {
        if (this.services.appLifecycle.isReloadingScheduled()) {
            this._log(`Reloading is already scheduled`, LOG_LEVEL_VERBOSE);
            return;
        }
        scheduleTask("configReload", 250, () => {
            this._log(message || "Obsidian will restart once the current work has settled.", LOG_LEVEL_INFO);
            this.services.appLifecycle.scheduleRestart();
        });
    }

    // Process counting for app reload scheduling
    _totalProcessingCount?: ReactiveSource<number> = undefined;
    private _scheduleAppReload() {
        if (!this._totalProcessingCount) {
            const __tick = reactiveSource(0);
            this._totalProcessingCount = reactive(() => {
                const dbCount = this.services.replication.databaseQueueCount.value;
                const replicationCount = this.services.replication.replicationResultCount.value;
                const storageApplyingCount = this.services.replication.storageApplyingCount.value;
                const chunkCount = collectingChunks.value;
                const pluginScanCount = pluginScanningCount.value;
                const hiddenFilesCount = hiddenFilesEventCount.value + hiddenFilesProcessingCount.value;
                const conflictProcessCount = this.services.conflict.conflictProcessQueueCount.value;
                // Now no longer `pendingFileEventCount` and `processingFileEventCount` is used
                // const e = this.core.pendingFileEventCount.value;
                // const proc = this.core.processingFileEventCount.value;
                const e = 0;
                const proc = 0;
                // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Reading the tick establishes the reactive polling dependency.
                const __ = __tick.value;
                return (
                    dbCount +
                    replicationCount +
                    storageApplyingCount +
                    chunkCount +
                    pluginScanCount +
                    hiddenFilesCount +
                    conflictProcessCount +
                    e +
                    proc
                );
            });
            this.plugin.registerInterval(
                compatGlobal.setInterval(() => {
                    __tick.value++;
                }, 1000)
            );

            let stableCheck = 3;
            this._totalProcessingCount.onChanged((e) => {
                if (e.value == 0) {
                    if (stableCheck-- <= 0) {
                        this.__performAppReload();
                    }
                    this._log(
                        `Obsidian will be restarted soon! (Within ${stableCheck} seconds)`,
                        LOG_LEVEL_NOTICE,
                        "restart-notice"
                    );
                } else {
                    stableCheck = 3;
                }
            });
        }
    }
    _isReloadingScheduled(): boolean {
        return this._totalProcessingCount !== undefined;
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onLayoutReady.addHandler(this._everyOnLayoutReady.bind(this));
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
        services.appLifecycle.askRestart.setHandler(this._askReload.bind(this));
        services.appLifecycle.scheduleRestart.setHandler(this._scheduleAppReload.bind(this));
        services.appLifecycle.isReloadingScheduled.setHandler(this._isReloadingScheduled.bind(this));
    }
}
