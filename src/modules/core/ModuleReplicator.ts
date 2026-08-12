import type PouchDB from "pouchdb-core";
import { fireAndForget } from "octagonal-wheels/promises";
import { AbstractModule } from "@/modules/AbstractModule";
import { Logger, LOG_LEVEL_NOTICE, LOG_LEVEL_INFO } from "octagonal-wheels/common/logger";
import { HOLD_REMOTE_REBUILT, syncHold } from "@/common/syncHold.ts";
import {
    type EntryDoc,
    type ObsidianLiveSyncSettings,
    type RemoteType,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { EVENT_FILE_SAVED, EVENT_SETTING_SAVED, eventHub } from "@/common/events";

import { $msg } from "@/common/translation";
import type { LiveSyncCore } from "@/main";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";
import { UnresolvedErrorManager } from "@vrtmrz/livesync-commonlib/compat/services/base/UnresolvedErrorManager";
import { clearHandlers } from "@vrtmrz/livesync-commonlib/compat/replication/SyncParamsHandler";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { MARK_LOG_NETWORK_ERROR } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";

function isOnlineAndCanReplicate(
    errorManager: UnresolvedErrorManager,
    host: NecessaryServices<"API", never>,
    showMessage: boolean
): Promise<boolean> {
    const errorMessage = "Network is offline";
    if (!host.services.API.isOnline) {
        errorManager.showError(errorMessage, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        return Promise.resolve(false);
    }
    errorManager.clearError(errorMessage);
    return Promise.resolve(true);
}
async function canReplicateWithPBKDF2(
    errorManager: UnresolvedErrorManager,
    host: NecessaryServices<"replicator" | "setting", never>,
    showMessage: boolean
): Promise<boolean> {
    const currentSettings = host.services.setting.currentSettings();
    // TODO: check using PBKDF2 salt?
    const errorMessage = $msg("Replicator.Message.InitialiseFatalError");
    const replicator = host.services.replicator.getActiveReplicator();
    if (!replicator) {
        errorManager.showError(errorMessage, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        return false;
    }
    errorManager.clearError(errorMessage);
    // Showing message is false: that because be shown here. (And it is a fatal error, no way to hide it).
    // tagged as network error at beginning for error filtering with NetworkWarningStyles
    const ensureMessage = `${MARK_LOG_NETWORK_ERROR}Failed to initialise the encryption key, preventing replication.`;
    // A remote database rebuild replaces the Security Seed while this process may still hold the previous one.
    const ensureResult = await replicator.ensurePBKDF2Salt(currentSettings, showMessage, false);
    if (!ensureResult) {
        errorManager.showError(ensureMessage, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        return false;
    }
    errorManager.clearError(ensureMessage);
    return ensureResult; // is true.
}

export class ModuleReplicator extends AbstractModule {
    _replicatorType?: RemoteType;

    processor: ReplicateResultProcessor = new ReplicateResultProcessor(this);
    private _unresolvedErrorManager: UnresolvedErrorManager = new UnresolvedErrorManager(
        this.core.services.appLifecycle,
        this.core.services.context.events
    );

    clearErrors() {
        this._unresolvedErrorManager.clearErrors();
    }

    private _normalFileReflectionFilterSignature: string | undefined;

    private getNormalFileReflectionFilterSignature(
        settings: Pick<
            ObsidianLiveSyncSettings,
            | "handleFilenameCaseSensitive"
            | "ignoreFiles"
            | "maxMTimeForReflectEvents"
            | "syncInternalFiles"
            | "syncMaxSizeInMB"
            | "useIgnoreFiles"
        >
    ): string {
        return JSON.stringify({
            handleFilenameCaseSensitive: settings.handleFilenameCaseSensitive ?? false,
            ignoreFiles: settings.ignoreFiles ?? "",
            maxMTimeForReflectEvents: settings.maxMTimeForReflectEvents ?? 0,
            syncInternalFiles: settings.syncInternalFiles ?? false,
            syncMaxSizeInMB: settings.syncMaxSizeInMB ?? 0,
            useIgnoreFiles: settings.useIgnoreFiles ?? false,
        });
    }

    private _everyOnloadAfterLoadSettings(): Promise<boolean> {
        this._normalFileReflectionFilterSignature = this.getNormalFileReflectionFilterSignature(this.settings);
        eventHub.onEvent(EVENT_FILE_SAVED, () => {
            if (this.settings.syncOnSave && !this.core.services.appLifecycle.isSuspended()) {
                scheduleTask("perform-replicate-after-save", 250, () => this.services.replication.replicateByEvent());
            }
        });
        eventHub.onEvent(EVENT_SETTING_SAVED, (setting) => {
            const previousReflectionFilter = this._normalFileReflectionFilterSignature;
            const nextReflectionFilter = this.getNormalFileReflectionFilterSignature(setting);
            this._normalFileReflectionFilterSignature = nextReflectionFilter;
            if (this.core.settings.suspendParseReplicationResult) {
                this.processor.suspend();
            } else {
                this.processor.resume();
            }
            if (previousReflectionFilter !== undefined && previousReflectionFilter !== nextReflectionFilter) {
                fireAndForget(() => this.processor.reprocessStoredDocuments());
            }
        });

        return Promise.resolve(true);
    }

    _onReplicatorInitialised(): Promise<boolean> {
        // For now, we only need to clear the error related to replicator initialisation, but in the future, if there are more things to do when the replicator is initialised, we can add them here.
        clearHandlers();
        return Promise.resolve(true);
    }

    _everyOnDatabaseInitialized(showNotice: boolean): Promise<boolean> {
        fireAndForget(() => this.processor.restoreFromSnapshotOnce());
        return Promise.resolve(true);
    }

    async _everyBeforeReplicate(showMessage: boolean): Promise<boolean> {
        await this.processor.restoreFromSnapshotOnce();
        this.clearErrors();
        // Clear only what this module put there. If the server is still holding
        // this device back, the attempt about to run says so again; if it is
        // not, the status bar must stop claiming otherwise.
        if (syncHold.value === HOLD_REMOTE_REBUILT) syncHold.value = undefined;
        return true;
    }

    private async onReplicationFailed(showMessage: boolean = false): Promise<boolean> {
        const activeReplicator = this.services.replicator.getActiveReplicator();
        if (!activeReplicator) {
            Logger(`No active replicator found`, LOG_LEVEL_INFO);
            return false;
        }
        if (activeReplicator.tweakSettingsMismatched && activeReplicator.preferredTweakValue) {
            await this.services.tweakValue.askResolvingMismatched(activeReplicator.preferredTweakValue);
        } else {
            if (activeReplicator.remoteLockedAndDeviceNotAccepted) {
                // Another device replaced the files on the server. That is a
                // lasting condition, not a question to raise in the middle of a
                // replication the reader did not start: it used to open a modal
                // offering "Fetch", "Unlock" or "Dismiss", where "Unlock" means
                // "carry on and diverge" — an answer no one can give safely
                // without knowing what the other device did.
                //
                // The status bar carries it until it is dealt with, and the
                // repair command does the one thing that resolves it.
                syncHold.value = HOLD_REMOTE_REBUILT;
                this._log(
                    "Another device replaced the files on the server; this device is not synchronising until it takes that copy.",
                    LOG_LEVEL_INFO
                );
                return false;
            }
        }
        // TODO: Check again and true/false return. This will be the result for performReplication.
        return false;
    }

    // private async _replicateByEvent(): Promise<boolean | void> {
    //     const least = this.settings.syncMinimumInterval;
    //     if (least > 0) {
    //         return rateLimitedSharedExecution(KEY_REPLICATION_ON_EVENT, least, async () => {
    //             return await this.services.replication.replicate();
    //         });
    //     }
    //     return await shareRunningResult(`replication`, () => this.services.replication.replicate());
    // }

    _parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): Promise<boolean> {
        this.processor.enqueueAll(docs);
        return Promise.resolve(true);
    }

    // _everyBeforeSuspendProcess(): Promise<boolean> {
    //     this.core.replicator?.closeReplication();
    //     return Promise.resolve(true);
    // }

    // private async _replicateAllToServer(
    //     showingNotice: boolean = false,
    //     sendChunksInBulkDisabled: boolean = false
    // ): Promise<boolean> {
    //     if (!this.services.appLifecycle.isReady()) return false;
    //     if (!(await this.services.replication.onBeforeReplicate(showingNotice))) {
    //         Logger($msg("Replicator.Message.SomeModuleFailed"), LOG_LEVEL_NOTICE);
    //         return false;
    //     }
    //     if (!sendChunksInBulkDisabled) {
    //         if (this.core.replicator instanceof LiveSyncCouchDBReplicator) {
    //             if (
    //                 (await this.core.confirm.askYesNoDialog("Do you want to send all chunks before replication?", {
    //                     defaultOption: "No",
    //                     timeout: 20,
    //                 })) == "yes"
    //             ) {
    //                 await this.core.replicator.sendChunks(this.core.settings, undefined, true, 0);
    //             }
    //         }
    //     }
    //     const ret = await this.core.replicator.replicateAllToServer(this.settings, showingNotice);
    //     if (ret) return true;
    //     const checkResult = await this.services.replication.checkConnectionFailure();
    //     if (checkResult == "CHECKAGAIN") return await this.services.remote.replicateAllToRemote(showingNotice);
    //     return !checkResult;
    // }
    // async _replicateAllFromServer(showingNotice: boolean = false): Promise<boolean> {
    //     if (!this.services.appLifecycle.isReady()) return false;
    //     const ret = await this.core.replicator.replicateAllFromServer(this.settings, showingNotice);
    //     if (ret) return true;
    //     const checkResult = await this.services.replication.checkConnectionFailure();
    //     if (checkResult == "CHECKAGAIN") return await this.services.remote.replicateAllFromRemote(showingNotice);
    //     return !checkResult;
    // }

    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.replicator.onReplicatorInitialised.addHandler(this._onReplicatorInitialised.bind(this));
        services.databaseEvents.onDatabaseInitialised.addHandler(this._everyOnDatabaseInitialized.bind(this));
        services.appLifecycle.onSettingLoaded.addHandler(this._everyOnloadAfterLoadSettings.bind(this));
        services.replication.parseSynchroniseResult.addHandler(this._parseReplicationResult.bind(this));

        // --> These handlers can be separated.
        const isOnlineAndCanReplicateWithHost = isOnlineAndCanReplicate.bind(null, this._unresolvedErrorManager, {
            services: {
                context: services.context,
                API: services.API,
            },
            serviceModules: {},
        });
        const canReplicateWithPBKDF2WithHost = canReplicateWithPBKDF2.bind(null, this._unresolvedErrorManager, {
            services: {
                context: services.context,
                replicator: services.replicator,
                setting: services.setting,
            },
            serviceModules: {},
        });
        services.replication.onBeforeReplicate.addHandler(isOnlineAndCanReplicateWithHost, 10);
        services.replication.onBeforeReplicate.addHandler(canReplicateWithPBKDF2WithHost, 20);
        // <-- End of handlers that can be separated.
        services.replication.onBeforeReplicate.addHandler(this._everyBeforeReplicate.bind(this), 100);
        services.replication.onReplicationFailed.addHandler(this.onReplicationFailed.bind(this));
    }
}
