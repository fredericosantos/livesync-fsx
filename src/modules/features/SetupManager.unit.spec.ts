import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_SETTINGS,
    REMOTE_COUCHDB,
    REMOTE_P2P,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { SettingService } from "@vrtmrz/livesync-commonlib/compat/services/base/SettingService";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";


vi.mock("@vrtmrz/livesync-commonlib/compat/API/processSetting", () => ({
    decodeSettingsFromQRCodeData: vi.fn(),
}));

import { decodeSettingsFromQRCodeData } from "@vrtmrz/livesync-commonlib/compat/API/processSetting";
import { SetupManager, UserMode } from "./SetupManager";

class TestSettingService extends SettingService<ServiceContext> {
    protected setItem(_key: string, _value: string): void {}
    protected getItem(_key: string): string {
        return "";
    }
    protected deleteItem(_key: string): void {}
    protected saveData(_setting: ObsidianLiveSyncSettings): Promise<void> {
        return Promise.resolve();
    }
    protected loadData(): Promise<ObsidianLiveSyncSettings | undefined> {
        return Promise.resolve(undefined);
    }
}

function createLegacyRemoteSetting(): ObsidianLiveSyncSettings {
    return {
        ...DEFAULT_SETTINGS,
        remoteConfigurations: {},
        activeConfigurationId: "",
        remoteType: REMOTE_COUCHDB,
        couchDB_URI: "http://localhost:5984",
        couchDB_USER: "user",
        couchDB_PASSWORD: "password",
        couchDB_DBNAME: "vault",
    };
}

function createSetupManager() {
    const setting = new TestSettingService(new ServiceContext(), {
        APIService: {
            getSystemVaultName: vi.fn(() => "vault"),
            getAppID: vi.fn(() => "app"),
            confirm: {
                askString: vi.fn(() => Promise.resolve("")),
            },
            addLog: vi.fn(),
            addCommand: vi.fn(),
            registerWindow: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
        } as any,
    });
    setting.settings = {
        ...DEFAULT_SETTINGS,
        remoteConfigurations: {},
        activeConfigurationId: "",
    };
    vi.spyOn(setting, "saveSettingData").mockResolvedValue();

    const dialogManager = {
        openWithExplicitCancel: vi.fn(),
        open: vi.fn(),
    };
    // Setup asks the server what it holds before proposing a plan; an empty
    // one means the plan is to upload, which is what these tests exercise.
    const remoteStatus = { doc_count: 0 };
    const replicator = {
        getNewReplicator: vi.fn(() =>
            Promise.resolve({
                isMobile: () => false,
                connectRemoteCouchDBWithSetting: vi.fn(() => Promise.resolve({ db: {}, info: {} })),
                getRemoteStatus: vi.fn(() => Promise.resolve(remoteStatus)),
            })
        ),
    };
    const services = {
        API: {
            addLog: vi.fn(),
            addCommand: vi.fn(),
            registerWindow: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
        },
        UI: {
            dialogManager,
        },
        replicator,
        setting,
    } as any;
    const core: any = {
        _services: services,
        storageAccess: {
            getFiles: vi.fn(() => Promise.resolve([])),
        },
        rebuilder: {
            scheduleRebuild: vi.fn(async (prepareBeforeRestart?: () => Promise<void>) => {
                await prepareBeforeRestart?.();
                return true;
            }),
            scheduleFetch: vi.fn(async (prepareBeforeRestart?: () => Promise<void>) => {
                await prepareBeforeRestart?.();
                return true;
            }),
        },
    };
    Object.defineProperty(core, "services", {
        get() {
            return services;
        },
    });
    Object.defineProperty(core, "settings", {
        get() {
            return setting.settings;
        },
        set(value: ObsidianLiveSyncSettings) {
            setting.settings = value;
        },
    });

    return {
        manager: new SetupManager(core),
        remoteStatus,
        setting,
        dialogManager,
        core,
    };
}

describe("SetupManager", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    it("compatibility: normalises imported flat remote settings from a Setup URI before applying", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce(createLegacyRemoteSetting())
            .mockResolvedValueOnce("apply");

        const result = await manager.onUseSetupURI(UserMode.Unknown, "mock-config://settings");

        expect(result).toBe(true);
        expect(setting.currentSettings().remoteConfigurations["legacy-couchdb"]?.uri).toContain(
            "sls+http://user:password@localhost:5984"
        );
        expect(setting.currentSettings().activeConfigurationId).toBe("legacy-couchdb");
    });

    it("compatibility: normalises imported flat remote settings from QR data before applying", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        vi.mocked(decodeSettingsFromQRCodeData).mockReturnValue(createLegacyRemoteSetting());
        dialogManager.openWithExplicitCancel.mockResolvedValueOnce("apply");

        const result = await manager.decodeQR("qr-data");

        expect(result).toBe(true);
        expect(decodeSettingsFromQRCodeData).toHaveBeenCalledWith("qr-data");
        expect(setting.currentSettings().remoteConfigurations["legacy-couchdb"]?.uri).toContain(
            "sls+http://user:password@localhost:5984"
        );
        expect(setting.currentSettings().activeConfigurationId).toBe("legacy-couchdb");
    });

    it("reserves Rebuild before saving a new-user configuration", async () => {
        const { manager, setting, dialogManager, core } = createSetupManager();
        setting.settings = { ...setting.currentSettings(), isConfigured: false };
        const applyExternalSettings = vi.spyOn(setting, "applyExternalSettings");
        dialogManager.openWithExplicitCancel.mockResolvedValueOnce("apply");

        await manager.onConfirmApplySettingsFromWizard(
            { ...createLegacyRemoteSetting(), isConfigured: true },
            UserMode.NewUser
        );

        expect(core.rebuilder.scheduleRebuild).toHaveBeenCalledWith(expect.any(Function));
        expect(core.rebuilder.scheduleRebuild.mock.invocationCallOrder[0]).toBeLessThan(
            applyExternalSettings.mock.invocationCallOrder[0]
        );
        expect(setting.currentSettings().isConfigured).toBe(true);
    });

    it("reserves Fetch when compatible imported settings activate an unconfigured device", async () => {
        const { manager, setting, dialogManager, core, remoteStatus } = createSetupManager();
        setting.settings = { ...setting.currentSettings(), isConfigured: false };
        // The server already holds a vault, so the plan is to join it.
        remoteStatus.doc_count = 4200;
        const applyExternalSettings = vi.spyOn(setting, "applyExternalSettings");
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce({ ...createLegacyRemoteSetting(), isConfigured: true })
            .mockResolvedValueOnce("apply");

        await manager.onUseSetupURI(UserMode.Unknown, "mock-config://settings");

        expect(core.rebuilder.scheduleFetch).toHaveBeenCalledWith(expect.any(Function));
        expect(core.rebuilder.scheduleFetch.mock.invocationCallOrder[0]).toBeLessThan(
            applyExternalSettings.mock.invocationCallOrder[0]
        );
        expect(setting.currentSettings().isConfigured).toBe(true);
    });

    it("applies compatible settings to an already configured device without scheduling Fetch", async () => {
        const { manager, setting, dialogManager, core, remoteStatus } = createSetupManager();
        setting.settings = { ...setting.currentSettings(), isConfigured: true };
        remoteStatus.doc_count = 4200;
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce({ ...createLegacyRemoteSetting(), isConfigured: true })
            .mockResolvedValueOnce("apply");

        await manager.onUseSetupURI(UserMode.Unknown, "mock-config://settings");

        expect(core.rebuilder.scheduleFetch).not.toHaveBeenCalled();
        expect(setting.currentSettings().isConfigured).toBe(true);
    });

    it("does not enable imported settings when the initialisation flag cannot be reserved", async () => {
        const { manager, setting, dialogManager, core } = createSetupManager();
        setting.settings = { ...setting.currentSettings(), isConfigured: false };
        const applyExternalSettings = vi.spyOn(setting, "applyExternalSettings");
        core.rebuilder.scheduleRebuild.mockResolvedValueOnce(false);
        dialogManager.openWithExplicitCancel.mockResolvedValueOnce("apply");

        await manager.onConfirmApplySettingsFromWizard(
            { ...createLegacyRemoteSetting(), isConfigured: true },
            UserMode.NewUser
        );

        expect(core.rebuilder.scheduleRebuild).toHaveBeenCalledWith(expect.any(Function));
        expect(applyExternalSettings).not.toHaveBeenCalled();
        expect(setting.currentSettings().isConfigured).toBe(false);
    });

    it("keeps only the selected server from a Setup URI carrying several", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        const imported = {
            ...DEFAULT_SETTINGS,
            remoteConfigurations: {
                couch: {
                    id: "couch",
                    name: "Office CouchDB",
                    uri: "sls+https://alice:secret@couch.example/?db=notes",
                    isEncrypted: false,
                },
                archive: {
                    id: "archive",
                    name: "Archive bucket",
                    uri: "sls+s3://key:secret@storage.example/?endpoint=https%3A%2F%2Fstorage.example&bucket=archive&region=auto",
                    isEncrypted: false,
                },
            },
            activeConfigurationId: "archive",
        } as ObsidianLiveSyncSettings;
        dialogManager.openWithExplicitCancel.mockResolvedValueOnce(imported).mockResolvedValueOnce("apply");

        await manager.onUseSetupURI(UserMode.Unknown, "mock-config://modern-settings");

        // The sending device's other servers are not this vault's business: it
        // syncs with one, and a stored copy of somebody else's second server is
        // a duplicate waiting to be asked about.
        const current = setting.currentSettings();
        expect(Object.keys(current.remoteConfigurations)).toEqual(["archive"]);
        expect(current.remoteConfigurations.archive).toEqual(imported.remoteConfigurations.archive);
        expect(current.activeConfigurationId).toBe("archive");
        expect(Object.keys(current.remoteConfigurations).some((id) => id.startsWith("legacy-"))).toBe(false);
    });

    it("replaces the stored server when CouchDB is configured again, rather than adding one", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        setting.settings = {
            ...setting.currentSettings(),
            isConfigured: true,
            remoteConfigurations: {
                existing: {
                    id: "existing",
                    name: "Existing remote",
                    uri: "sls+http://old:secret@old.example/?db=old",
                    isEncrypted: false,
                },
            },
            activeConfigurationId: "existing",
        };
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce({
                couchDB_URI: "https://couch.example",
                couchDB_USER: "alice",
                couchDB_PASSWORD: "secret",
                couchDB_DBNAME: "notes",
                couchDB_CustomHeaders: "",
                useJWT: false,
                jwtAlgorithm: "",
                jwtKey: "",
                jwtKid: "",
                jwtSub: "",
                jwtExpDuration: 5,
                useRequestAPI: false,
            })
            // ...then the plan the wizard proposes for the server.
            .mockResolvedValueOnce("apply");

        await manager.onCouchDBManualSetup(UserMode.ExistingUser, setting.currentSettings());

        // Every run of setup used to allocate a fresh opaque id and keep the
        // previous profile, so reconfiguring three times left three copies of
        // one server and a dialogue asking which to fetch from. The id in use
        // is now reused, and its display name with it.
        const current = setting.currentSettings();
        expect(Object.keys(current.remoteConfigurations)).toEqual(["existing"]);
        expect(current.activeConfigurationId).toBe("existing");
        const activeProfile = current.remoteConfigurations.existing;
        expect(activeProfile?.name).toBe("Existing remote");
        expect(activeProfile?.uri).toContain("sls+https://alice:secret@couch.example");
    });

    it.each([
        [UserMode.NewUser, "create-or-connect"],
        [UserMode.ExistingUser, "connect-existing"],
        [UserMode.Update, "settings"],
    ] as const)(
        "passes the %s CouchDB database policy to the manual setup dialogue",
        async (userMode, expectedMode) => {
            const { manager, setting, dialogManager } = createSetupManager();
            const couchConf = {
                couchDB_URI: "https://couch.example",
                couchDB_USER: "alice",
                couchDB_PASSWORD: "secret",
                couchDB_DBNAME: "notes",
                couchDB_CustomHeaders: "",
                useJWT: false,
                jwtAlgorithm: "",
                jwtKey: "",
                jwtKid: "",
                jwtSub: "",
                jwtExpDuration: 5,
                useRequestAPI: false,
            };
            dialogManager.openWithExplicitCancel.mockResolvedValueOnce(couchConf).mockResolvedValueOnce("cancelled");

            await manager.onCouchDBManualSetup(userMode, setting.currentSettings());

            expect(dialogManager.openWithExplicitCancel).toHaveBeenNthCalledWith(1, expect.anything(), {
                settings: setting.currentSettings(),
                mode: expectedMode,
            });
        }
    );
});
