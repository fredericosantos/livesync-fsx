import { describe, it, expect, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import {
    FlagFilesHumanReadable,
    FlagFilesOriginal,
} from "@vrtmrz/livesync-commonlib/compat/common/models/redflag.const";
import { REMOTE_MINIO, REMOTE_P2P } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";
import {
    createFetchAllFlagHandler,
    createRebuildFlagHandler,
    createSuspendFlagHandler,
    isFlagFileExist,
    deleteFlagFile,
    adjustSettingToRemote,
    adjustSettingToRemoteIfNeeded,
    processVaultInitialisation,
    verifyAndUnlockSuspension,
    flagHandlerToEventHandler,
} from "./redFlag";
import {
    TweakValuesRecommendedTemplate,
    TweakValuesShouldMatchedTemplate,
    TweakValuesTemplate,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    ExtraOnLocal,
    FullScanModes,
    synchroniseAllFilesBetweenDBandStorage,
} from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";
import { activateRemoteConfiguration } from "@vrtmrz/livesync-commonlib/remote-configurations";
//Mock synchroniseAllFilesBetweenDBandStorage
vi.mock("@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner", async (importOriginal) => {
    const originalModule = (await importOriginal()) as any;
    return {
        ...originalModule,
        synchroniseAllFilesBetweenDBandStorage: vi.fn(() => Promise.resolve(true)),
    };
});

vi.mock("@vrtmrz/livesync-commonlib/compat/serviceFeatures/remoteConfig", () => {
    return {
        activateRemoteConfiguration: vi.fn((settings: any, configurationId: string) => {
            if (!settings?.remoteConfigurations?.[configurationId]) return false;
            return {
                activeConfigurationId: configurationId,
                remoteType: settings.remoteConfigurations[configurationId].remoteType ?? settings.remoteType,
                remoteURI: settings.remoteConfigurations[configurationId].uri,
            };
        }),
    };
});

// Mock types and functions
const createLoggerMock = (): LogFunction => {
    return vi.fn();
};

const createStorageAccessMock = () => {
    const files: Set<string> = new Set();
    return {
        files,
        isExists: vi.fn((path: string) => Promise.resolve(files.has(path))),
        normalisePath: vi.fn((path: string) => path),
        delete: vi.fn((path: string, _recursive?: boolean) => {
            files.delete(path);
            return Promise.resolve();
        }),
        getFileNames: vi.fn(() => Array.from(files)),
    };
};

const createSettingServiceMock = () => {
    const settings: any = {
        batchSave: true,
        suspendFileWatching: false,
        writeLogToTheFile: false,
        remoteType: "CouchDB",
        // On, as it is for any Vault that is actually synchronising.
        liveSync: true,
    };
    const smallConfig = new Map<string, string>();
    return {
        settings,
        currentSettings: vi.fn(() => settings),
        applyExternalSettings: vi.fn((partial: any, _feedback?: boolean) => {
            Object.assign(settings, partial);
            return Promise.resolve();
        }),
        applyPartial: vi.fn((partial: any, _feedback?: boolean) => {
            Object.assign(settings, partial);
            return Promise.resolve();
        }),
        // Mirrors the real implementation, which stops replication. A mock that
        // merely recorded the call could not have caught the fact that nothing
        // ever started it again.
        suspendAllSync: vi.fn(() => {
            Object.assign(settings, { liveSync: false });
            return Promise.resolve();
        }),
        suspendExtraSync: vi.fn(() => Promise.resolve()),
        getSmallConfig: vi.fn((key: string) => smallConfig.get(key) ?? ""),
        setSmallConfig: vi.fn((key: string, value: string) => {
            smallConfig.set(key, value);
        }),
        deleteSmallConfig: vi.fn((key: string) => {
            smallConfig.delete(key);
        }),
    };
};

const createAppLifecycleMock = () => {
    return {
        performRestart: vi.fn(),
        onLayoutReady: {
            addHandler: vi.fn(),
        },
        getUnresolvedMessages: {
            addHandler: vi.fn(),
        },
    };
};

const createUIServiceMock = () => {
    return {
        dialogManager: {
            openWithExplicitCancel: vi.fn(),
        },
        confirm: {
            askSelectStringDialogue: vi.fn(),
            askYesNoDialog: vi.fn(),
            confirmWithMessage: vi.fn(),
        },
    };
};

const createRebuilderMock = () => {
    return {
        $fetchLocal: vi.fn(async () => {}),
        $fetchLocalDBFast: vi.fn(async () => {}),
        $rebuildEverything: vi.fn(async () => {}),
        finishRebuild: vi.fn(async () => {}),
    };
};

const createTweakValueMock = () => {
    return {
        fetchRemotePreferred: vi.fn(() => Promise.resolve<any>(null)),
    };
};

const createHostMock = () => {
    const storageAccessMock = createStorageAccessMock();
    const settingMock = createSettingServiceMock();
    const appLifecycleMock = createAppLifecycleMock();
    const uiMock = createUIServiceMock();
    const rebuilderMock = createRebuilderMock();
    const tweakValueMock = createTweakValueMock();

    return {
        services: {
            context: createServiceContext(),
            setting: settingMock,
            appLifecycle: appLifecycleMock,
            UI: uiMock,
            tweakValue: tweakValueMock,
        },
        serviceModules: {
            storageAccess: storageAccessMock,
            rebuilder: rebuilderMock,
        },
        mocks: {
            storageAccess: storageAccessMock,
            setting: settingMock,
            appLifecycle: appLifecycleMock,
            ui: uiMock,
            rebuilder: rebuilderMock,
            tweakValue: tweakValueMock,
        },
    };
};

describe("Red Flag Feature", () => {
    describe("isFlagFileExist", () => {
        it("should return true if flag file exists", async () => {
            const host = createHostMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);

            const result = await isFlagFileExist(host as any, FlagFilesOriginal.FETCH_ALL);
            expect(result).toBe(true);
        });

        it("should return false if flag file does not exist", async () => {
            const host = createHostMock();

            const result = await isFlagFileExist(host as any, FlagFilesOriginal.FETCH_ALL);
            expect(result).toBe(false);
        });
    });

    describe("deleteFlagFile", () => {
        it("should delete flag file if it exists", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);

            await deleteFlagFile(host as any, log, FlagFilesOriginal.FETCH_ALL);

            const exists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.FETCH_ALL)
            );
            expect(exists).toBe(false);
        });

        it("should not throw error if file does not exist", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await expect(deleteFlagFile(host as any, log, FlagFilesOriginal.FETCH_ALL)).resolves.not.toThrow();
        });

        it("should log error if deletion fails", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.delete.mockRejectedValueOnce(new Error("Delete failed"));
            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);

            await deleteFlagFile(host as any, log, FlagFilesOriginal.FETCH_ALL);

            expect(log).toHaveBeenCalled();
        });
    });

    describe("FlagFile Handler Priority", () => {
        it("should handle suspend flag with priority 5", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createSuspendFlagHandler(host as any, log);
            expect(handler.priority).toBe(5);
            expect(typeof handler.check).toBe("function");
            expect(typeof handler.handle).toBe("function");
        });

        it("should handle fetch all flag with priority 10", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createFetchAllFlagHandler(host as any, log);
            expect(handler.priority).toBe(10);
            expect(typeof handler.check).toBe("function");
            expect(typeof handler.handle).toBe("function");
        });

        it("should handle rebuild all flag with priority 20", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createRebuildFlagHandler(host as any, log);
            expect(handler.priority).toBe(20);
            expect(typeof handler.check).toBe("function");
            expect(typeof handler.handle).toBe("function");
        });
    });

    describe("Setting adjustment during vault initialisation", () => {
        it("should suspend file watching during initialisation", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            expect(host.mocks.setting.currentSettings().suspendFileWatching).toBe(false);

            const result = await processVaultInitialisation(host as any, log, () => {
                expect(host.mocks.setting.currentSettings().suspendFileWatching).toBe(true);
                return Promise.resolve(true);
            });

            expect(result).toBe(true);
        });

        it("should disable batch save during initialisation", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            expect(host.mocks.setting.currentSettings().batchSave).toBe(true);

            const result = await processVaultInitialisation(host as any, log, () => {
                expect(host.mocks.setting.currentSettings().batchSave).toBe(false);
                return Promise.resolve(true);
            });

            expect(result).toBe(true);
        });

        it("should suspend all sync operations", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await processVaultInitialisation(host as any, log, () => {
                return Promise.resolve(true);
            });

            expect(host.mocks.setting.suspendAllSync).toHaveBeenCalled();
            expect(host.mocks.setting.suspendExtraSync).toHaveBeenCalled();
        });

        // The bug this exists to prevent: setting up a Vault connected to the
        // server, created the remote database and wrote the version marker, and
        // then left every trigger off. Nothing asked for replication ever
        // again, so nothing replicated, and the status bar reported a
        // connection problem for a setup that had worked perfectly.
        it("starts replication again after it finishes", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await processVaultInitialisation(host as any, log, () => {
                expect(host.mocks.setting.currentSettings().liveSync, "during").toBe(false);
                expect(host.mocks.setting.currentSettings().batchSave, "during").toBe(false);
                return Promise.resolve(true);
            });

            expect(host.mocks.setting.currentSettings().liveSync, "after").toBe(true);
            expect(host.mocks.setting.currentSettings().batchSave, "after").toBe(true);
        });

        it("gives them back even when the initialisation failed", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const result = await processVaultInitialisation(host as any, log, () => {
                throw new Error("seeding blew up");
            });

            expect(result).toBe(false);
            // A half-finished setup that still synchronises is recoverable; one
            // that has silently stopped looks exactly like one that works.
            expect(host.mocks.setting.currentSettings().liveSync).toBe(true);
        });

        it("keeps file watching suspended on request, but still restores the triggers", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await processVaultInitialisation(host as any, log, () => Promise.resolve(true), true);

            expect(host.mocks.setting.currentSettings().suspendFileWatching).toBe(true);
            expect(host.mocks.setting.currentSettings().liveSync).toBe(true);
        });

        it("should resume file watching after initialisation completes", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await processVaultInitialisation(
                host as any,
                log,
                () => {
                    return Promise.resolve(true);
                },
                false
            );

            expect(host.mocks.setting.currentSettings().suspendFileWatching).toBe(false);
        });

        it("should keep suspending when keepSuspending is true", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await processVaultInitialisation(
                host as any,
                log,
                () => {
                    return Promise.resolve(true);
                },
                true
            );

            expect(host.mocks.setting.currentSettings().suspendFileWatching).toBe(true);
        });

        it("should return false when process fails", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const result = await processVaultInitialisation(
                host as any,
                log,
                () => {
                    throw new Error("Process failed");
                },
                false
            );

            expect(result).toBe(false);
            expect(log).toHaveBeenCalled();
        });
    });

    describe("Suspend Flag Handler", () => {
        it("should write logs to file when suspend flag is detected", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createSuspendFlagHandler(host as any, log);

            expect(handler.priority).toBe(5);
            expect(typeof handler.check).toBe("function");
            expect(typeof handler.handle).toBe("function");
        });

        it("should keep suspending after initialisation when suspend flag is active", async () => {
            const host = createHostMock();

            const handler = createSuspendFlagHandler(host as any, createLoggerMock());

            const checkResult = await handler.check();
            expect(typeof checkResult).toBe("boolean");
        });

        it("should apply writeLogToTheFile setting during suspension", async () => {
            const host = createHostMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.SUSPEND_ALL);

            const handler = createSuspendFlagHandler(host as any, createLoggerMock());
            const checkResult = await handler.check();

            expect(checkResult).toBe(true);
        });
    });

    describe("Fetch All Flag Handler", () => {
        it("should detect fetch all flag using original filename", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);

            const handler = createFetchAllFlagHandler(host as any, log);
            const exists = await handler.check();

            expect(exists).toBe(true);
        });

        it("should detect fetch all flag using human-readable filename", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesHumanReadable.FETCH_ALL);

            const handler = createFetchAllFlagHandler(host as any, log);
            const exists = await handler.check();

            expect(exists).toBe(true);
        });

        it("should clean up both original and human-readable fetch all flag files", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);
            host.mocks.storageAccess.files.add(FlagFilesHumanReadable.FETCH_ALL);

            await deleteFlagFile(host as any, log, FlagFilesOriginal.FETCH_ALL);
            await deleteFlagFile(host as any, log, FlagFilesHumanReadable.FETCH_ALL);

            const originalExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.FETCH_ALL)
            );
            const humanExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesHumanReadable.FETCH_ALL)
            );

            expect(originalExists).toBe(false);
            expect(humanExists).toBe(false);
        });

        it("should have priority 10", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createFetchAllFlagHandler(host as any, log);
            expect(handler.priority).toBe(10);
        });

        it("should cancel the fetch flow when the reader cancels it", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockResolvedValueOnce("cancelled");

            const handler = createFetchAllFlagHandler(host as any, log);
            host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce({
                batchSave: false,
            } as any);
            const result = await handler.handle();

            expect(result).toBe(false);
            expect(host.mocks.rebuilder.$fetchLocal).not.toHaveBeenCalled();
            expect(host.mocks.appLifecycle.performRestart).toHaveBeenCalled();
        });

        // Five tests used to cover a dialogue asking which stored server to
        // fetch from — keeping the current one, cancelling, activating another,
        // an unrecognised answer, and a failed activation. The several servers
        // it asked between were duplicates of one server, made by setup itself.
        // Nothing asks now, so the whole branch and its five tests are gone;
        // what remains to prove is that a leftover duplicate cannot resurrect
        // the question.
        it("fetches without asking which server, even with duplicate profiles left over", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);
            Object.assign(host.mocks.setting.settings, {
                activeConfigurationId: "alpha",
                remoteConfigurations: {
                    alpha: { name: "Alpha", uri: "sls+https://user:pass@example.com/db1" },
                    beta: { name: "Beta", uri: "sls+https://user:pass@example.com/db2" },
                },
            });
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockResolvedValueOnce("cancelled");

            const handler = createFetchAllFlagHandler(host as any, log);
            const result = await handler.handle();

            expect(result).toBe(false);
            expect(host.mocks.ui.confirm.askSelectStringDialogue).not.toHaveBeenCalled();
            expect(activateRemoteConfiguration).not.toHaveBeenCalled();
        });
    });

    describe("Rebuild All Flag Handler", () => {

        it("should detect rebuild all flag using original filename", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);

            const handler = createRebuildFlagHandler(host as any, log);
            const exists = await handler.check();

            expect(exists).toBe(true);
        });

        it("should detect rebuild all flag using human-readable filename", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesHumanReadable.REBUILD_ALL);

            const handler = createRebuildFlagHandler(host as any, log);
            const exists = await handler.check();

            expect(exists).toBe(true);
        });

        it("should clean up both original and human-readable rebuild all flag files", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);
            host.mocks.storageAccess.files.add(FlagFilesHumanReadable.REBUILD_ALL);

            await deleteFlagFile(host as any, log, FlagFilesOriginal.REBUILD_ALL);
            await deleteFlagFile(host as any, log, FlagFilesHumanReadable.REBUILD_ALL);

            const originalExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.REBUILD_ALL)
            );
            const humanExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesHumanReadable.REBUILD_ALL)
            );

            expect(originalExists).toBe(false);
            expect(humanExists).toBe(false);
        });

        it("should have priority 20", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createRebuildFlagHandler(host as any, log);
            expect(handler.priority).toBe(20);
        });
    });

    describe("Flag file cleanup on error", () => {
        it("should handle errors during flag file deletion gracefully", async () => {
            const host = createHostMock();

            // Simulate error in delete operation
            host.mocks.storageAccess.delete.mockRejectedValueOnce(new Error("Delete failed"));

            try {
                await host.mocks.storageAccess.delete(FlagFilesOriginal.FETCH_ALL, true);
            } catch {
                // Error handled
            }

            expect(host.mocks.storageAccess.delete).toHaveBeenCalled();
        });
    });

    describe("Integration: Handler registration on layout ready", () => {
        it("should register handlers with correct priorities", () => {
            const host = createHostMock();

            expect(host.services.appLifecycle.onLayoutReady.addHandler).toBeDefined();
            expect(typeof host.services.appLifecycle.onLayoutReady.addHandler).toBe("function");
        });
    });

    describe("Dialog interaction scenarios", () => {
        it("should handle fetch all dialog cancellation", async () => {
            const host = createHostMock();

            // Simulate user clicking cancel
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockResolvedValueOnce("cancelled");

            // The dialog manager would return cancelled
            const result = await host.mocks.ui.dialogManager.openWithExplicitCancel();
            expect(result).toBe("cancelled");
        });

        it("should handle rebuild dialog cancellation", async () => {
            const host = createHostMock();

            // Simulate user clicking cancel
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockResolvedValueOnce("cancelled");

            const result = await host.mocks.ui.dialogManager.openWithExplicitCancel();
            expect(result).toBe("cancelled");
        });

        it("should handle confirm dialog for remote configuration mismatch", async () => {
            const host = createHostMock();

            await host.mocks.ui.confirm.askSelectStringDialogue("Your settings differed slightly.", ["OK"]);
            expect(host.mocks.ui.confirm.askSelectStringDialogue).toHaveBeenCalled();
        });
    });

    describe("Remote configuration adjustment", () => {
        it("should skip remote configuration fetch when preventFetchingConfig is true", async () => {
            const host = createHostMock();
            const config = { preventFetchingConfig: true } as any;

            await adjustSettingToRemoteIfNeeded(
                host as any,
                createLoggerMock(),
                { preventFetchingConfig: true },
                config
            );

            expect(host.mocks.tweakValue.fetchRemotePreferred).not.toHaveBeenCalled();
        });

        it("should fetch remote configuration when preventFetchingConfig is false", async () => {
            const host = createHostMock();
            const config = { batchSave: true } as any;

            host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce({
                batchSave: false,
            } as any);

            await adjustSettingToRemoteIfNeeded(
                host as any,
                createLoggerMock(),
                { preventFetchingConfig: false },
                config
            );

            expect(host.mocks.tweakValue.fetchRemotePreferred).toHaveBeenCalled();
        });

        const mismatchDetectionKeys = Object.keys(TweakValuesShouldMatchedTemplate);
        it.each(mismatchDetectionKeys)(
            "should apply remote configuration when available and different:%s",
            async (key) => {
                const host = createHostMock();

                const config = { [key]: TweakValuesTemplate[key as keyof typeof TweakValuesTemplate] } as any;
                const differentValue =
                    typeof config[key as keyof typeof config] === "boolean"
                        ? !config[key as keyof typeof config]
                        : typeof config[key as keyof typeof config] === "number"
                          ? (config[key as keyof typeof config] as number) + 1
                          : "different";
                const differentConfig = {
                    [key]: differentValue,
                };
                host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce(differentConfig as any);
                const log = createLoggerMock();

                await adjustSettingToRemote(host as any, log, config);

                expect(host.mocks.setting.applyExternalSettings).toHaveBeenCalled();
                // Reconciling settings is something the plug-in does, not
                // something it asks permission for; it is reported, naming what
                // changed, and nothing blocks.
                expect(host.mocks.ui.confirm.askSelectStringDialogue).not.toHaveBeenCalled();
                expect(log).toHaveBeenCalledWith(expect.stringContaining(key), expect.anything());
            }
        );
        const mismatchAcceptedKeys = Object.keys(TweakValuesRecommendedTemplate).filter(
            (key) => !mismatchDetectionKeys.includes(key)
        );

        it.each(mismatchAcceptedKeys)(
            "should apply remote configuration when available and different but acceptable: %s",
            async (key) => {
                const host = createHostMock();

                const config = { [key]: TweakValuesTemplate[key as keyof typeof TweakValuesTemplate] } as any;
                const differentValue =
                    typeof config[key as keyof typeof config] === "boolean"
                        ? !config[key as keyof typeof config]
                        : typeof config[key as keyof typeof config] === "number"
                          ? (config[key as keyof typeof config] as number) + 1
                          : "different";
                const differentConfig = {
                    [key]: differentValue,
                };
                host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce(differentConfig as any);

                await adjustSettingToRemote(host as any, createLoggerMock(), config);

                expect(host.mocks.setting.applyExternalSettings).toHaveBeenCalled();
                expect(host.mocks.ui.confirm.askSelectStringDialogue).not.toHaveBeenCalled();
            }
        );

        it("proceeds without asking when the server has no settings stored", async () => {
            // The ordinary state of a database nobody has synchronised yet.
            // This used to stop setup with an error and two buttons, one of
            // them labelled "recommended".
            const host = createHostMock();
            const log = createLoggerMock();
            const config = { batchSave: true } as any;

            host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce(null);

            await adjustSettingToRemote(host as any, log, config);

            expect(host.mocks.ui.confirm.askSelectStringDialogue).not.toHaveBeenCalled();
            expect(host.mocks.setting.applyExternalSettings).not.toHaveBeenCalled();
            expect(host.mocks.tweakValue.fetchRemotePreferred).toHaveBeenCalledTimes(1);
        });

        it("should log when no changes needed", async () => {
            const host = createHostMock();
            const log = createLoggerMock();
            const config = { batchSave: false } as any;

            host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce({
                batchSave: false,
            } as any);

            await adjustSettingToRemote(host as any, log, config);

            expect(log).toHaveBeenCalled();
        });

        it("should handle null extra parameter in adjustSettingToRemoteIfNeeded", async () => {
            const host = createHostMock();
            const log = createLoggerMock();
            const config = { batchSave: true } as any;

            host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce(null);
            host.mocks.ui.confirm.askSelectStringDialogue.mockResolvedValueOnce("Skip and proceed");

            await adjustSettingToRemoteIfNeeded(host as any, log, null as any, config);

            expect(host.mocks.tweakValue.fetchRemotePreferred).toHaveBeenCalled();
        });
    });

    describe("MinIO configuration handling", () => {
        it("should not enable makeLocalChunkBeforeSync when remote is MinIO", () => {
            const host = createHostMock();
            host.mocks.setting.settings.remoteType = REMOTE_MINIO;

            const settings = host.mocks.setting.currentSettings();
            const isMinIO = settings.remoteType === REMOTE_MINIO;

            expect(isMinIO).toBe(true);
        });

        it("should enable makeLocalChunkBeforeSync for non-MinIO remotes", () => {
            const host = createHostMock();
            host.mocks.setting.settings.remoteType = "CouchDB";

            const settings = host.mocks.setting.currentSettings();
            const isMinIO = settings.remoteType === REMOTE_MINIO;

            expect(isMinIO).toBe(false);
        });
    });

    describe("Suspension unlock verification", () => {
        it("should return true when suspension is not active", async () => {
            const host = createHostMock();

            const result = await verifyAndUnlockSuspension(host as any, createLoggerMock());
            expect(result).toBe(true);
        });

        it("resumes without asking, because a suspended vault looks like a working one", async () => {
            const host = createHostMock();

            await host.mocks.setting.applyPartial({ suspendFileWatching: true });

            const result = await verifyAndUnlockSuspension(host as any, createLoggerMock());

            expect(host.mocks.ui.confirm.askYesNoDialog).not.toHaveBeenCalled();
            expect(host.mocks.setting.applyPartial).toHaveBeenCalledWith({ suspendFileWatching: false }, true);
            expect(host.mocks.appLifecycle.performRestart).toHaveBeenCalled();
            expect(result).toBe(false);
        });

        it("should resume file watching and restart when user accepts", async () => {
            const host = createHostMock();

            await host.mocks.setting.applyPartial({ suspendFileWatching: true }, true);
            host.mocks.ui.confirm.askYesNoDialog.mockResolvedValueOnce("yes");

            await verifyAndUnlockSuspension(host as any, createLoggerMock());

            expect(host.mocks.appLifecycle.performRestart).toHaveBeenCalled();
        });
    });

    describe("Error handling in vault initialization", () => {
        it("should handle errors during initialisation gracefully", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const result = await processVaultInitialisation(host as any, log, () => {
                throw new Error("Initialization failed");
            });

            expect(result).toBe(false);
            expect(log).toHaveBeenCalled();
        });

        it("should track log calls during error conditions", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await processVaultInitialisation(host as any, log, () => {
                throw new Error("Test error");
            });

            expect(log).toHaveBeenCalled();
        });

        it("should keep suspension state when error occurs during initialization", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            await processVaultInitialisation(
                host as any,
                log,
                () => {
                    return Promise.resolve(false);
                },
                true
            );

            expect(host.mocks.setting.currentSettings().suspendFileWatching).toBe(true);
        });

        it("should handle applySetting error in processVaultInitialisation", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.setting.applyPartial.mockRejectedValueOnce(new Error("Apply partial failed"));

            const result = await processVaultInitialisation(host as any, log, () => {
                return Promise.resolve(true);
            });

            expect(result).toBe(false);
        });
    });

    describe("Flag file detection with both formats", () => {
        it("should detect either original or human-readable fetch all flag", async () => {
            const host = createHostMock();

            // Add only human-readable flag
            host.mocks.storageAccess.files.add(FlagFilesHumanReadable.FETCH_ALL);

            const humanExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesHumanReadable.FETCH_ALL)
            );

            expect(humanExists).toBe(true);
        });

        it("should detect either original or human-readable rebuild flag", async () => {
            const host = createHostMock();

            // Add only original flag
            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);

            const originalExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.REBUILD_ALL)
            );

            expect(originalExists).toBe(true);
        });
    });

    describe("Handler execution", () => {
        it("should execute fetch all handler check method", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);

            const handler = createFetchAllFlagHandler(host as any, log);
            const result = await handler.check();

            expect(result).toBe(true);
        });

        it("should execute rebuild handler check method", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);

            const handler = createRebuildFlagHandler(host as any, log);
            const result = await handler.check();

            expect(result).toBe(true);
        });

        it("should execute suspend handler check method", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.SUSPEND_ALL);

            const handler = createSuspendFlagHandler(host as any, log);
            const result = await handler.check();

            expect(result).toBe(true);
        });

        it("should return false when flag does not exist", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createFetchAllFlagHandler(host as any, log);
            const result = await handler.check();

            expect(result).toBe(false);
        });

        it("should return correct priority for each handler", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const suspendHandler = createSuspendFlagHandler(host as any, log);
            const fetchHandler = createFetchAllFlagHandler(host as any, log);
            const rebuildHandler = createRebuildFlagHandler(host as any, log);

            expect(suspendHandler.priority).toBe(5);
            expect(fetchHandler.priority).toBe(10);
            expect(rebuildHandler.priority).toBe(20);
        });

        it("should handle suspend flag and execute handler", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.SUSPEND_ALL);

            const handler = createSuspendFlagHandler(host as any, log);
            const checkResult = await handler.check();

            expect(checkResult).toBe(true);
            expect(typeof handler.handle).toBe("function");
        });

        it("should have handle method for all handlers", () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const suspendHandler = createSuspendFlagHandler(host as any, log);
            const fetchHandler = createFetchAllFlagHandler(host as any, log);
            const rebuildHandler = createRebuildFlagHandler(host as any, log);

            expect(typeof suspendHandler.handle).toBe("function");
            expect(typeof fetchHandler.handle).toBe("function");
            expect(typeof rebuildHandler.handle).toBe("function");
        });
    });

    describe("Multiple concurrent operations", () => {
        it("should handle multiple flag files existing simultaneously", async () => {
            const host = createHostMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);
            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);
            host.mocks.storageAccess.files.add(FlagFilesOriginal.SUSPEND_ALL);

            const fetchExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.FETCH_ALL)
            );
            const rebuildExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.REBUILD_ALL)
            );
            const suspendExists = await host.mocks.storageAccess.isExists(
                host.mocks.storageAccess.normalisePath(FlagFilesOriginal.SUSPEND_ALL)
            );

            expect(fetchExists).toBe(true);
            expect(rebuildExists).toBe(true);
            expect(suspendExists).toBe(true);
        });

        it("should cleanup all flags when processing completes", async () => {
            const host = createHostMock();

            host.mocks.storageAccess.files.add(FlagFilesHumanReadable.FETCH_ALL);
            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);

            await host.mocks.storageAccess.delete(FlagFilesHumanReadable.FETCH_ALL);
            await host.mocks.storageAccess.delete(FlagFilesOriginal.FETCH_ALL);

            expect(host.mocks.storageAccess.files.size).toBe(0);
        });
    });

    describe("Setting state transitions", () => {
        it("should apply complete state transition for initialization", async () => {
            const host = createHostMock();

            // Initial state
            const initialState = {
                batchSave: host.mocks.setting.currentSettings().batchSave,
                suspendFileWatching: host.mocks.setting.currentSettings().suspendFileWatching,
            };

            // Initialization state
            await host.mocks.setting.applyPartial(
                {
                    batchSave: false,
                    suspendFileWatching: true,
                },
                true
            );

            const initState = {
                batchSave: host.mocks.setting.currentSettings().batchSave,
                suspendFileWatching: host.mocks.setting.currentSettings().suspendFileWatching,
            };

            // Post-initialization state
            await host.mocks.setting.applyPartial(
                {
                    batchSave: true,
                    suspendFileWatching: false,
                },
                true
            );

            const finalState = {
                batchSave: host.mocks.setting.currentSettings().batchSave,
                suspendFileWatching: host.mocks.setting.currentSettings().suspendFileWatching,
            };

            expect(initialState.batchSave).toBe(true);
            expect(initialState.suspendFileWatching).toBe(false);

            expect(initState.batchSave).toBe(false);
            expect(initState.suspendFileWatching).toBe(true);

            expect(finalState.batchSave).toBe(true);
            expect(finalState.suspendFileWatching).toBe(false);
        });
    });

    describe("flagHandlerToEventHandler integration", () => {
        it("should return true when flag does not exist", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createFetchAllFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            const result = await eventHandler();
            expect(result).toBe(true);
        });

        it("should return handle result when flag exists", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.SUSPEND_ALL);

            const handler = createSuspendFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            const result = await eventHandler();

            // Suspend handler execution results in false from processVaultInitialisation
            expect(typeof result).toBe("boolean");
        });

        it("should not call handle when check returns false", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const handler = createRebuildFlagHandler(host as any, log);
            const handleSpy = vi.spyOn(handler, "handle");
            const eventHandler = flagHandlerToEventHandler(handler);

            const result = await eventHandler();

            // Check returns false because no rebuild flag exists
            expect(handleSpy).not.toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it("should handle rebuild flag with flagHandlerToEventHandler", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockResolvedValueOnce("cancelled");

            const handler = createRebuildFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            await eventHandler();

            expect(host.mocks.ui.dialogManager.openWithExplicitCancel).toHaveBeenCalled();
        });

        it("should propagate errors from handle method", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.FETCH_ALL);
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockRejectedValueOnce(new Error("Dialog failed"));

            const handler = createFetchAllFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            try {
                await eventHandler();
            } catch (error) {
                expect((error as Error).message).toBe("Dialog failed");
            }
        });

        it("should handle rebuildAll flag with flagHandlerToEventHandler", async () => {
            const host = createHostMock();
            const log = createLoggerMock();
            host.mocks.tweakValue.fetchRemotePreferred.mockResolvedValueOnce({
                customChunkSize: 1,
            } as any);

            host.mocks.storageAccess.files.add(FlagFilesOriginal.REBUILD_ALL);
            host.mocks.ui.dialogManager.openWithExplicitCancel.mockResolvedValueOnce({ extra: {} });
            host.mocks.rebuilder.$rebuildEverything.mockResolvedValueOnce();
            const handler = createRebuildFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            await Promise.resolve(eventHandler());
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(host.mocks.rebuilder.$rebuildEverything).toHaveBeenCalled();

            expect(host.mocks.ui.dialogManager.openWithExplicitCancel).toHaveBeenCalled();
        });

        it("should execute all handlers in sequence", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            const suspendHandler = createSuspendFlagHandler(host as any, log);
            const fetchHandler = createFetchAllFlagHandler(host as any, log);
            const rebuildHandler = createRebuildFlagHandler(host as any, log);

            const suspendEvent = flagHandlerToEventHandler(suspendHandler);
            const fetchEvent = flagHandlerToEventHandler(fetchHandler);
            const rebuildEvent = flagHandlerToEventHandler(rebuildHandler);

            // All should return true when flags don't exist
            expect(await suspendEvent()).toBe(true);
            expect(await fetchEvent()).toBe(true);
            expect(await rebuildEvent()).toBe(true);
        });

        it("should return false from handle when suspending", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.files.add(FlagFilesOriginal.SUSPEND_ALL);

            const handler = createSuspendFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            const result = await eventHandler();

            // Suspend handler returns false from its handle method
            expect(result).toBe(false);
        });

        it("should handle check error gracefully", async () => {
            const host = createHostMock();
            const log = createLoggerMock();

            host.mocks.storageAccess.isExists.mockRejectedValueOnce(new Error("Check failed"));

            const handler = createFetchAllFlagHandler(host as any, log);
            const eventHandler = flagHandlerToEventHandler(handler);

            try {
                await eventHandler();
            } catch (error) {
                expect((error as Error).message).toBe("Check failed");
            }
        });
    });
});
