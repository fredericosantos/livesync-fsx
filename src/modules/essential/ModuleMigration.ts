import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    Logger,
} from "@vrtmrz/livesync-commonlib/compat/common/logger";
import {
    EVENT_REQUEST_RUN_DOCTOR,
    EVENT_REQUEST_RUN_FIX_INCOMPLETE,
    eventHub,
} from "@/common/events.ts";
import { AbstractModule } from "@/modules/AbstractModule.ts";
import { HOLD_INSECURE_CHUNKS, syncHold } from "@/common/syncHold.ts";
import { performDoctorConsultation, RebuildOptions } from "@vrtmrz/livesync-commonlib/compat/common/configForDoc";
import { isValidPath } from "@/common/utils.ts";
import { isMetaEntry } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    isDeletedEntry,
    isDocContentSame,
    isLoadedEntry,
    readAsBlob,
} from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { countCompromisedChunks } from "@vrtmrz/livesync-commonlib/compat/pouchdb/negotiation";
import type { LiveSyncCore } from "@/main.ts";
import { SetupManager } from "@/modules/features/SetupManager.ts";
import { showOnboardingInvitation } from "@/serviceFeatures/setupObsidian/setupManagerHandlers.ts";
import {
    runConfiguredStartupLifecycle,
    runStartupEntryLifecycle,
} from "@/serviceFeatures/configuredStartupLifecycle.ts";

type ErrorInfo = {
    path: string;
    recordedSize: number;
    actualSize: number;
    storageSize: number;
    contentMatched: boolean;
    isConflicted?: boolean;
};

const INCOMPLETE_DOCUMENT_NOTICE_GROUP = "startup-integrity-check";

export class ModuleMigration extends AbstractModule<LiveSyncCore> {
    constructor(
        core: LiveSyncCore,
        private readonly waitForCompatibilityReview: () => Promise<void> = () => Promise.resolve()
    ) {
        super(core);
    }

    async migrateUsingDoctor(skipRebuild: boolean = false, activateReason = "updated", forceRescan = false) {
        const { shouldRebuild, shouldRebuildLocal, isModified, settings } = await performDoctorConsultation(
            {
                confirm: this.core.confirm,
                translate: this.services.context.translate,
            },
            this.settings,
            {
                localRebuild: skipRebuild ? RebuildOptions.SkipEvenIfRequired : RebuildOptions.AutomaticAcceptable,
                remoteRebuild: skipRebuild ? RebuildOptions.SkipEvenIfRequired : RebuildOptions.AutomaticAcceptable,
                activateReason,
                forceRescan,
            }
        );
        if (isModified) {
            this.settings = settings;
            await this.saveSettings();
        }
        if (!skipRebuild) {
            if (shouldRebuild) {
                await this.core.rebuilder.scheduleRebuild();
                this.services.appLifecycle.performRestart();
                return false;
            } else if (shouldRebuildLocal) {
                await this.core.rebuilder.scheduleFetch();
                this.services.appLifecycle.performRestart();
                return false;
            }
        }
        return true;
    }

    async migrateDisableBulkSend() {
        if (this.settings.sendChunksBulk) {
            this._log("Bulk chunk sending has been switched off: it is not reliable.", LOG_LEVEL_INFO);
            this.settings.sendChunksBulk = false;
            this.settings.sendChunksBulkMaxSize = 1;
            await this.saveSettings();
        }
    }

    initialMessage() {
        const manager = this.core.getModule(SetupManager);
        showOnboardingInvitation(this.core, manager);
    }

    async hasIncompleteDocs(force: boolean = false): Promise<boolean> {
        const incompleteDocsChecked = (await this.core.kvDB.get<boolean>("checkIncompleteDocs")) || false;
        if (incompleteDocsChecked && !force) {
            this._log("Incomplete docs check already done, skipping.", LOG_LEVEL_VERBOSE);
            return Promise.resolve(true);
        }

        const noticeGroups = this.core.services.context.noticeGroups;
        noticeGroups.setItem(INCOMPLETE_DOCUMENT_NOTICE_GROUP, "checking", {
            message: "Checking for incomplete documents...",
        });
        this._log("Checking for incomplete documents...", LOG_LEVEL_VERBOSE);

        try {
            const errorFiles = [] as ErrorInfo[];
            for await (const metaDoc of this.localDatabase.findAllNormalDocs({ conflicts: true })) {
                const path = this.getPath(metaDoc);

                if (!isValidPath(path)) {
                    continue;
                }
                if (!(await this.services.vault.isTargetFile(path))) {
                    continue;
                }
                if (!isMetaEntry(metaDoc)) {
                    continue;
                }

                const doc = await this.localDatabase.getDBEntryFromMeta(metaDoc);
                if (!doc || !isLoadedEntry(doc)) {
                    continue;
                }
                if (isDeletedEntry(doc)) {
                    continue;
                }
                const isConflicted = metaDoc?._conflicts && metaDoc._conflicts.length > 0;

                let storageFileContent;
                try {
                    storageFileContent = await this.core.storageAccess.readHiddenFileBinary(path);
                } catch (e) {
                    Logger(`Failed to read file ${path}: Possibly unprocessed or missing`);
                    Logger(e, LOG_LEVEL_VERBOSE);
                    continue;
                }
                // const storageFileBlob = createBlob(storageFileContent);
                const sizeOnStorage = storageFileContent.byteLength;
                const recordedSize = doc.size;
                const docBlob = readAsBlob(doc);
                const actualSize = docBlob.size;
                if (
                    recordedSize !== actualSize ||
                    sizeOnStorage !== actualSize ||
                    sizeOnStorage !== recordedSize ||
                    isConflicted
                ) {
                    const contentMatched = await isDocContentSame(doc.data, storageFileContent);
                    errorFiles.push({
                        path,
                        recordedSize,
                        actualSize,
                        storageSize: sizeOnStorage,
                        contentMatched,
                        isConflicted,
                    });
                    Logger(
                        `Size mismatch for ${path}: ${recordedSize} (DB Recorded) , ${actualSize} (DB Stored) , ${sizeOnStorage} (Storage Stored), ${contentMatched ? "Content Matched" : "Content Mismatched"} ${isConflicted ? "Conflicted" : "Not Conflicted"}`
                    );
                }
            }
            if (errorFiles.length == 0) {
                Logger("No size mismatches found", LOG_LEVEL_INFO);
                noticeGroups.setItem(INCOMPLETE_DOCUMENT_NOTICE_GROUP, "result", {
                    message: "No size mismatches found",
                });
                await this.core.kvDB.set("checkIncompleteDocs", true);
                return Promise.resolve(true);
            }
            Logger(`Found ${errorFiles.length} size mismatches`, LOG_LEVEL_INFO);
            noticeGroups.setItem(INCOMPLETE_DOCUMENT_NOTICE_GROUP, "result", {
                message: `Found ${errorFiles.length} size mismatches`,
            });
            // We have to repair them following rules and situations:
            // A. DB Recorded != DB Stored
            //   A.1. DB Recorded == Storage Stored
            //        Possibly recoverable from storage. Just overwrite the DB content with storage content.
            //   A.2. Neither
            //        Probably it cannot be resolved on this device. Even if the storage content is larger than DB Recorded, it possibly corrupted.
            //        We do not fix it automatically. Leave it as is. Possibly other device can do this.
            // B. DB Recorded == DB Stored ,  < Storage Stored
            //   Very fragile, if DB Recorded size is less than Storage Stored size, we possibly repair the content (The issue was `unexpectedly shortened file`).
            //   We do not fix it automatically, but it will be automatically overwritten in other process.
            // C. DB Recorded == DB Stored ,  > Storage Stored
            //   Probably restored by the user by resolving A or B on other device, We should overwrite the storage
            //   Also do not fix it automatically. It should be overwritten by replication.
            const recoverable = errorFiles.filter((e) => {
                return e.recordedSize === e.storageSize && !e.isConflicted;
            });
            const unrecoverable = errorFiles.filter((e) => {
                return e.recordedSize !== e.storageSize || e.isConflicted;
            });
            // Repaired, not reported. The "recoverable" filter above is the
            // plug-in's own proof that overwriting is safe — the database and
            // the file agree on size and nothing is conflicted — so a dialogue
            // listing `(M: 1234, A: 1234, S: 1234)` for each file asked the
            // reader to re-derive a conclusion already reached, in units only
            // this codebase uses.
            let restored = 0;
            for (const file of recoverable) {
                const stubFile = await this.core.storageAccess.getFileStub(file.path);
                if (stubFile == null) {
                    Logger(`Could not find ${file.path} to repair it`, LOG_LEVEL_INFO);
                    continue;
                }
                stubFile.stat.mtime = Date.now();
                const result = await this.core.fileHandler.storeFileToDB(stubFile, true, false);
                if (result) {
                    restored++;
                    Logger(`Repaired ${file.path} from the copy in the vault`, LOG_LEVEL_INFO);
                } else {
                    Logger(`Could not repair ${file.path}`, LOG_LEVEL_INFO);
                }
            }
            if (restored > 0) {
                Logger(`Repaired ${restored} file(s) whose database record was incomplete.`, LOG_LEVEL_NOTICE);
            }
            if (unrecoverable.length > 0) {
                // Left alone deliberately: these are resolved by replication
                // from whichever device still holds the content.
                Logger(
                    `${unrecoverable.length} file(s) could not be repaired here and will be resolved by synchronisation.`,
                    LOG_LEVEL_INFO
                );
            }

            return Promise.resolve(true);
        } catch (error) {
            noticeGroups.setItem(INCOMPLETE_DOCUMENT_NOTICE_GROUP, "result", {
                message: "The incomplete document check could not be completed.",
            });
            throw error;
        } finally {
            noticeGroups.finish(INCOMPLETE_DOCUMENT_NOTICE_GROUP);
        }
    }

    async hasCompromisedChunks(): Promise<boolean> {
        Logger(`Checking for compromised chunks...`, LOG_LEVEL_VERBOSE);
        if (!this.settings.encrypt) {
            // If not encrypted, we do not need to check for compromised chunks.
            return true;
        }
        // Check local database for compromised chunks
        const localCompromised = await countCompromisedChunks(this.localDatabase.localDatabase);
        const remote = this.services.replicator.getActiveReplicator();
        const remoteCompromised = this.services.API.isOnline ? await remote?.countCompromisedChunks() : 0;
        if (localCompromised === false) {
            Logger(`Could not check this device for content encrypted with the old scheme.`, LOG_LEVEL_INFO);
            return false;
        }
        if (remoteCompromised === false) {
            Logger(`Could not check the server for content encrypted with the old scheme.`, LOG_LEVEL_INFO);
            return false;
        }
        if (remoteCompromised === 0 && localCompromised === 0) {
            return true;
        }
        Logger(
            `Found compromised chunks : ${localCompromised} in local, ${remoteCompromised} in remote`,
            LOG_LEVEL_NOTICE
        );
        // A lasting condition, so it is shown as one. This used to be a modal
        // at start-up offering "Rebuild", "Fetch" or "Later" — three answers to
        // a question about cryptography, raised in front of a vault the reader
        // had just opened to write in. The two repairs are the two commands
        // that already exist, and the status bar says which one is needed for
        // as long as it is needed.
        syncHold.value = HOLD_INSECURE_CHUNKS;
        return true;
    }

    async _everyOnFirstInitialize(): Promise<boolean> {
        return await runConfiguredStartupLifecycle({
            databaseReady: this.localDatabase.isReady,
            reportDatabaseNotReady: () => this._log("The local database is not ready.", LOG_LEVEL_NOTICE),
            hasCompromisedChunks: () => this.hasCompromisedChunks(),
            hasIncompleteDocuments: () => this.hasIncompleteDocs(),
            waitForCompatibilityReview: () => this.waitForCompatibilityReview(),
            runDoctor: () => this.migrateUsingDoctor(false),
            migrateBulkSend: () => this.migrateDisableBulkSend(),
        });
    }
    _everyOnLayoutReady(): Promise<boolean> {
        const shouldInitialiseDatabase = runStartupEntryLifecycle({
            configured: this.settings.isConfigured === true,
            inviteToOnboarding: () => this.initialMessage(),
        });
        if (!shouldInitialiseDatabase) return Promise.resolve(false);
        eventHub.onEvent(EVENT_REQUEST_RUN_DOCTOR, async (reason) => {
            await this.migrateUsingDoctor(false, reason, true);
        });
        eventHub.onEvent(EVENT_REQUEST_RUN_FIX_INCOMPLETE, async () => {
            await this.hasIncompleteDocs(true);
        });
        return Promise.resolve(true);
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        super.onBindFunction(core, services);
        services.appLifecycle.onLayoutReady.addHandler(this._everyOnLayoutReady.bind(this));
        services.appLifecycle.onFirstInitialise.addHandler(this._everyOnFirstInitialize.bind(this));
    }
}
