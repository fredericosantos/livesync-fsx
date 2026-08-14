import { describe, expect, it, vi } from "vitest";
import {
    type DocumentID,
    LOG_LEVEL_NOTICE,
    type FilePath,
    type FilePathWithPrefix,
    type MetaEntry,
    type UXFileInfo,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {},
}));
vi.mock("@/features/LiveSyncCommands.ts", () => ({
    LiveSyncCommands: class LiveSyncCommands {
        plugin!: { app: unknown };
        core!: { services: unknown; settings: unknown };
        get app() {
            return this.plugin.app;
        }
        get services() {
            return this.core.services;
        }
        get settings() {
            return this.core.settings;
        }
    },
}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({
    configureHiddenFileSyncMode: vi.fn(),
}));

import { HiddenFileSync } from "./CmdHiddenFileSync.ts";
import { configureHiddenFileSyncMode } from "./configureHiddenFileSyncMode.ts";
import { restartToApplySettings } from "@/common/pendingRestart.ts";

function createHiddenRevisionOperation() {
    const path = ".obsidian/plugins/example/data.json" as FilePath;
    const file = {
        path,
        name: "data.json",
        isInternal: true,
        body: new Blob(['{"value":"vault"}']),
        stat: {
            ctime: 1,
            mtime: 2,
            size: 17,
            type: "file",
        },
    } as UXFileInfo;
    const selected = {
        _id: "i:example" as DocumentID,
        _rev: "2-selected",
        path: `i:${path}` as FilePathWithPrefix,
        ctime: 1,
        mtime: 2,
        size: 17,
        type: "plain",
        datatype: "plain",
        children: [],
        eden: {},
        deleted: false,
    } as MetaEntry;
    const winner = {
        ...selected,
        _rev: "3-winner",
    } as MetaEntry;
    const databaseFileAccess = {
        fetchEntryMeta: vi.fn(async (_path: unknown, revision?: string) =>
            revision === selected._rev ? selected : winner
        ),
        getConflictedRevs: vi.fn(async () => [selected._rev]),
        fetchEntryFromMeta: vi.fn(async () => ({ ...selected, data: '{"value":"database"}' })),
        storeWithBaseRevision: vi.fn(async () => "3-vault-child"),
    };
    const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
    Object.assign(hiddenFileSync, {
        core: {
            services: {
                vault: {
                    isIgnoredByIgnoreFile: vi.fn(async () => false),
                },
            },
            databaseFileAccess,
        },
        loadFileWithInfo: vi.fn(async () => file),
        updateLastProcessed: vi.fn(),
        _log: vi.fn(),
    });
    return {
        hiddenFileSync,
        path,
        file,
        selected,
        winner,
        databaseFileAccess,
    };
}

describe("HiddenFileSync configuration-change notices", () => {
    it("offers one hidden-file repair, and only once the feature and runtime are ready", () => {
        const commands: Array<{
            id: string;
            checkCallback?: (checking: boolean) => boolean | void;
        }> = [];
        const settings = {
            syncInternalFiles: false,
        };
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            core: {
                settings,
                services: {
                    API: {
                        addCommand: vi.fn((command) => commands.push(command)),
                    },
                },
            },
            _isMainReady: vi.fn(() => true),
            _isMainSuspended: vi.fn(() => false),
            _isDatabaseReady: vi.fn(() => true),
        });

        hiddenFileSync.onload();

        // The three "scan…" commands are gone. Each performed one half of what
        // the periodic processor and the start-up scan already do in full,
        // unprompted, and no reader could have chosen between them on the
        // evidence their names gave.
        expect(commands.map(({ id }) => id)).toEqual(["livesync-sync-internal"]);

        const command = commands[0];
        expect(command.checkCallback?.(true)).toBe(false);

        settings.syncInternalFiles = true;
        expect(command.checkCallback?.(true)).toBe(true);
    });

    it("does not report Hidden File Sync as ready before the main runtime is ready", () => {
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            core: {
                settings: {
                    syncInternalFiles: true,
                },
            },
            _isMainReady: vi.fn(() => false),
            _isMainSuspended: vi.fn(() => false),
        });

        expect(hiddenFileSync.isReady()).toBe(false);
    });

    // It used to ask, per plug-in, per change: "Files in Iconic were updated."
    // with a "Reload Iconic" button. Somebody who switched plug-in sync on and
    // then chose that plug-in in the list has already answered.
    it("reloads a plug-in whose files arrived, without asking", async () => {
        const plugin = {
            manifest: { id: "livesync-fsx" },
            app: {
                plugins: {
                    manifests: {
                        alpha: { id: "alpha", name: "Alpha", dir: ".obsidian/plugins/alpha" },
                        self: { id: "livesync-fsx", name: "LiveSync", dir: ".obsidian/plugins/livesync-fsx" },
                        off: { id: "off", name: "Off", dir: ".obsidian/plugins/off" },
                    },
                    enabledPlugins: new Set(["alpha", "livesync-fsx"]),
                    unloadPlugin: vi.fn(async () => undefined),
                    loadPlugin: vi.fn(async () => undefined),
                },
            },
        };
        const core = {
            confirm: { askInPopup: vi.fn() },
            services: {
                context: { noticeGroups: { setItem: vi.fn(), finish: vi.fn(), removeItem: vi.fn() } },
                API: { getSystemConfigDir: vi.fn(() => ".obsidian") },
                appLifecycle: { isReloadingScheduled: vi.fn(() => false), scheduleRestart: vi.fn() },
            },
        };
        restartToApplySettings.value = false;
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            plugin,
            core,
            queuedNotificationFiles: new Set([
                ".obsidian/plugins/alpha",
                ".obsidian/plugins/livesync-fsx",
                ".obsidian/plugins/off",
            ]),
            _log: vi.fn(),
        });

        hiddenFileSync.notifyConfigChange();

        await vi.waitFor(() => {
            expect(plugin.app.plugins.unloadPlugin).toHaveBeenCalledWith("alpha");
            expect(plugin.app.plugins.loadPlugin).toHaveBeenCalledWith("alpha");
        });
        // Never itself: unloading the plug-in mid-replication would unload the
        // thing doing the replicating. Never one that is switched off here.
        expect(plugin.app.plugins.unloadPlugin).toHaveBeenCalledTimes(1);
        expect(core.services.context.noticeGroups.setItem).not.toHaveBeenCalled();
        expect(core.confirm.askInPopup).not.toHaveBeenCalled();
    });

    // Obsidian read its own preferences when it opened, so only a restart
    // applies them — and a restart takes the window away, which makes it the
    // reader's decision rather than a replication's.
    it("waits in the status icon when Obsidian's own settings arrive", () => {
        const core = {
            confirm: { askInPopup: vi.fn() },
            services: {
                context: { noticeGroups: { setItem: vi.fn(), finish: vi.fn(), removeItem: vi.fn() } },
                API: { getSystemConfigDir: vi.fn(() => ".obsidian") },
                appLifecycle: { isReloadingScheduled: vi.fn(() => false), scheduleRestart: vi.fn() },
            },
        };
        restartToApplySettings.value = false;
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            plugin: { manifest: { id: "livesync-fsx" }, app: { plugins: undefined } },
            core,
            queuedNotificationFiles: new Set([".obsidian"]),
            _log: vi.fn(),
        });

        hiddenFileSync.notifyConfigChange();

        expect(restartToApplySettings.value).toBe(true);
        expect(core.services.appLifecycle.scheduleRestart).not.toHaveBeenCalled();
        expect(core.services.context.noticeGroups.setItem).not.toHaveBeenCalled();
    });

    it("keeps subordinate initialisation phases below Notice level so one progress Notice owns the scan", async () => {
        const progress = {
            log: vi.fn(),
            once: vi.fn(),
            done: vi.fn(),
        };
        const rebuildMerging = vi.fn(async () => []);
        const adoptCurrentStorageFilesAsProcessed = vi.fn(async () => undefined);
        const adoptCurrentDatabaseFilesAsProcessed = vi.fn(async () => undefined);
        const scanAllStorageChanges = vi.fn(async () => undefined);
        const scanAllDatabaseChanges = vi.fn(async () => undefined);
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            _progress: vi.fn(() => progress),
            rebuildMerging,
            adoptCurrentStorageFilesAsProcessed,
            adoptCurrentDatabaseFilesAsProcessed,
            scanAllStorageChanges,
            scanAllDatabaseChanges,
        });

        await hiddenFileSync.initialiseInternalFileSync("safe", true);

        expect(rebuildMerging).toHaveBeenCalledWith(false, false);
        expect(scanAllStorageChanges).toHaveBeenCalledWith(false, true, false);
        expect(scanAllDatabaseChanges).toHaveBeenCalledWith(false, true, false);
        expect(progress.done).toHaveBeenCalledOnce();
    });

    it("retirement guard: does not restore separate gathering and restart Notices", async () => {
        vi.mocked(configureHiddenFileSyncMode).mockImplementation(async (_mode, handlers) => {
            await handlers.enable();
            await handlers.initialise("safe");
            return "enabled";
        });
        const events: string[] = [];
        const progress = {
            log: vi.fn((message: string) => {
                events.push(`progress:${message}`);
            }),
            once: vi.fn(),
            done: vi.fn(),
        };
        const createProgress = vi.fn(() => progress);
        const applyPartial = vi.fn(async () => {
            events.push("apply-settings");
        });
        const initialiseInternalFileSync = vi.fn(async () => undefined);
        const log = vi.fn();
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            core: {
                services: {
                    setting: { applyPartial },
                },
            },
            initialiseInternalFileSync,
            _progress: createProgress,
            _log: log,
        });

        await hiddenFileSync.configureHiddenFileSync("MERGE");

        expect(createProgress).toHaveBeenCalledWith("[Initialise]\n", LOG_LEVEL_NOTICE);
        expect(events[0]).toBe("progress:Preparing Hidden File Sync...");
        expect(initialiseInternalFileSync).toHaveBeenCalledWith("safe", true, false, progress);
        expect(log).not.toHaveBeenCalledWith("Gathering files for enabling Hidden File Sync", LOG_LEVEL_NOTICE);
        expect(log).not.toHaveBeenCalledWith("Done! Restarting the app is strongly recommended!", LOG_LEVEL_NOTICE);
        expect(log).toHaveBeenCalledWith("Hidden File Sync initialisation completed.", expect.any(Number));
    });

    it("closes the preparation Notice when enabling Hidden File Sync fails", async () => {
        vi.mocked(configureHiddenFileSyncMode).mockImplementation(async (_mode, handlers) => {
            await handlers.enable();
            return "enabled";
        });
        const error = new Error("setting persistence failed");
        const progress = {
            log: vi.fn(),
            once: vi.fn(),
            done: vi.fn(),
        };
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            core: {
                services: {
                    setting: {
                        applyPartial: vi.fn(async () => {
                            throw error;
                        }),
                    },
                },
            },
            _progress: vi.fn(() => progress),
            _log: vi.fn(),
        });

        await expect(hiddenFileSync.configureHiddenFileSync("MERGE")).rejects.toBe(error);

        expect(progress.done).toHaveBeenCalledWith("Failed");
    });
});

describe("HiddenFileSync exact revision repair operations", () => {
    it("stores the current hidden Vault file as a child of the selected live revision", async () => {
        const { hiddenFileSync, file, selected, databaseFileAccess } = createHiddenRevisionOperation();

        await expect(hiddenFileSync.storeInternalFileToDatabaseWithBaseRevision(file, selected._rev!)).resolves.toBe(
            true
        );

        expect(databaseFileAccess.storeWithBaseRevision).toHaveBeenCalledWith(
            expect.objectContaining({
                path: file.path,
                body: file.body,
                isInternal: true,
            }),
            selected._rev,
            true
        );
        expect(hiddenFileSync.updateLastProcessed).toHaveBeenCalledWith(
            file.path,
            expect.objectContaining({ _rev: "3-vault-child" }),
            file.stat
        );
    });

    it("refuses to extend a hidden-file revision which is no longer live", async () => {
        const { hiddenFileSync, file, selected, databaseFileAccess } = createHiddenRevisionOperation();
        databaseFileAccess.getConflictedRevs.mockResolvedValue([]);

        await expect(hiddenFileSync.storeInternalFileToDatabaseWithBaseRevision(file, selected._rev!)).resolves.toBe(
            false
        );

        expect(databaseFileAccess.storeWithBaseRevision).not.toHaveBeenCalled();
        expect(hiddenFileSync.updateLastProcessed).not.toHaveBeenCalled();
    });

    it("does not create a hidden-file child when asked only to mark a revision which differs from the Vault", async () => {
        const { hiddenFileSync, file, selected, databaseFileAccess } = createHiddenRevisionOperation();

        await expect(
            hiddenFileSync.storeInternalFileToDatabaseWithBaseRevision(file, selected._rev!, false)
        ).resolves.toBe(false);

        expect(databaseFileAccess.storeWithBaseRevision).not.toHaveBeenCalled();
        expect(hiddenFileSync.updateLastProcessed).not.toHaveBeenCalled();
    });

    it("marks a matching hidden-file revision without creating a child", async () => {
        const { hiddenFileSync, file, selected, databaseFileAccess } = createHiddenRevisionOperation();
        databaseFileAccess.fetchEntryFromMeta.mockResolvedValue({
            ...selected,
            data: '{"value":"vault"}',
        });

        await expect(
            hiddenFileSync.storeInternalFileToDatabaseWithBaseRevision(file, selected._rev!, false)
        ).resolves.toBe(true);

        expect(databaseFileAccess.storeWithBaseRevision).not.toHaveBeenCalled();
        expect(hiddenFileSync.updateLastProcessed).toHaveBeenCalledWith(file.path, selected, file.stat);
    });

    it("applies the selected live hidden-file revision through the existing extraction path", async () => {
        const { hiddenFileSync, path, selected } = createHiddenRevisionOperation();
        const extract = vi.fn(async () => true);
        hiddenFileSync.extractInternalFileFromDatabase = extract;

        await expect(hiddenFileSync.extractInternalFileRevisionFromDatabase(path, selected._rev!, true)).resolves.toBe(
            true
        );

        expect(extract).toHaveBeenCalledWith(path, true, undefined, true, false, true, selected._rev);
    });

    it("does not apply a hidden-file revision which ceased to be live", async () => {
        const { hiddenFileSync, path, selected, databaseFileAccess } = createHiddenRevisionOperation();
        databaseFileAccess.getConflictedRevs.mockResolvedValue([]);

        await expect(hiddenFileSync.extractInternalFileRevisionFromDatabase(path, selected._rev!, true)).resolves.toBe(
            false
        );

        expect(databaseFileAccess.fetchEntryFromMeta).not.toHaveBeenCalled();
    });
});
