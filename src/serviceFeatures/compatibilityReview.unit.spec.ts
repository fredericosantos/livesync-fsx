import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    COMPATIBILITY_PAUSE_SETTING_MESSAGE,
    DATABASE_COMPATIBILITY_VERSION_KEY,
    legacyDatabaseCompatibilityVersionKey,
} from "@/common/databaseCompatibility.ts";
import {
    CompatibilityReviewController,
    type CompatibilityReviewUi,
    useCompatibilityReview,
} from "./compatibilityReview.ts";
import { HOLD_COMPATIBILITY, syncHold } from "@/common/syncHold.ts";

function migrationState(overrides: Record<string, unknown> = {}) {
    return {
        sourceVersion: 2,
        targetVersion: 2,
        isNewVault: false,
        isFromFutureSchema: false,
        changed: false,
        requiresSyncReview: false,
        reviewReasons: [],
        ...overrides,
    };
}

function createFixture(
    options: {
        marker?: string | null;
        legacyMarker?: string | null;
        versionUpFlash?: string;
        isConfigured?: boolean;
        migration?: Record<string, unknown>;
    } = {}
) {
    const local = new Map<string, string>();
    if (options.marker !== undefined && options.marker !== null) {
        local.set(DATABASE_COMPATIBILITY_VERSION_KEY, options.marker);
    }
    const legacyKey = legacyDatabaseCompatibilityVersionKey("Test Vault");
    if (options.legacyMarker !== undefined && options.legacyMarker !== null) {
        local.set(legacyKey, options.legacyMarker);
    }
    const settings = {
        versionUpFlash: options.versionUpFlash ?? "",
        isConfigured: options.isConfigured ?? true,
    };
    const saveSettingData = vi.fn().mockResolvedValue(undefined);
    const applySettings = vi.fn().mockResolvedValue(true);
    const setting = {
        currentSettings: () => settings,
        getSettingsMigrationState: () => migrationState(options.migration),
        getSmallConfig: (key: string) => local.get(key) ?? "",
        setSmallConfig: (key: string, value: string) => local.set(key, value),
        getDeviceLocalConfig: (key: string) => local.get(key) ?? null,
        deleteDeviceLocalConfig: (key: string) => local.delete(key),
        saveSettingData,
    };
    const core = {
        services: {
            setting,
            vault: { getVaultName: () => "Test Vault" },
            control: { applySettings },
        },
    } as never;
    const ui: CompatibilityReviewUi = {
        showSummary: vi.fn().mockResolvedValue("keep-paused"),
        showDetails: vi.fn().mockResolvedValue(false),
        clearReminder: vi.fn(),
    };
    const controller = new CompatibilityReviewController(core, ui, 12);
    return { controller, ui, local, legacyKey, settings, saveSettingData, applySettings };
}

describe("compatibility review controller", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("initialises the acknowledged version for a new Vault without showing a pause", async () => {
        const fixture = createFixture({ marker: null, isConfigured: false, migration: { isNewVault: true } });

        expect(fixture.controller.initialised).toBe(false);

        await expect(fixture.controller.initialise()).resolves.toBe(true);

        expect(fixture.controller.initialised).toBe(true);
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("12");
        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.saveSettingData).not.toHaveBeenCalled();
    });

    // The device this was reported from: a phone set up that afternoon, which
    // fetched the vault and was then told "Sync paused" over the top of five
    // other notices. There was no incompatibility — only the absence of a
    // marker it had never had the chance to write.
    it("records the marker and keeps syncing on a device that has never written one", async () => {
        const fixture = createFixture({ marker: null, isConfigured: true });

        await expect(fixture.controller.initialise()).resolves.toBe(true);

        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.settings.versionUpFlash).toBe("");
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("12");
        expect(fixture.ui.showSummary).not.toHaveBeenCalled();
    });

    it("preserves preferences and advances the marker only after an upgrade review is resumed", async () => {
        const fixture = createFixture({ marker: "11" });
        vi.mocked(fixture.ui.showSummary).mockResolvedValue("resume");

        await fixture.controller.initialise();

        expect(fixture.settings.versionUpFlash).toBe(COMPATIBILITY_PAUSE_SETTING_MESSAGE);
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("11");
        expect(fixture.saveSettingData).toHaveBeenCalledTimes(1);

        await fixture.controller.openReview();

        expect(fixture.settings.versionUpFlash).toBe("");
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("12");
        expect(fixture.saveSettingData).toHaveBeenCalledTimes(2);
        expect(fixture.applySettings).toHaveBeenCalledOnce();
        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.ui.clearReminder).toHaveBeenCalled();
    });

    it("does not allow a downgrade pause to be resumed", async () => {
        const fixture = createFixture({ marker: "13" });
        vi.mocked(fixture.ui.showSummary).mockResolvedValue("resume");

        await fixture.controller.initialise();
        await fixture.controller.openReview();

        expect(fixture.controller.pendingPause?.resumable).toBe(false);
        expect(fixture.settings.versionUpFlash).toBe(COMPATIBILITY_PAUSE_SETTING_MESSAGE);
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("13");
        expect(fixture.applySettings).not.toHaveBeenCalled();
        expect(syncHold.value).toBe(HOLD_COMPATIBILITY);
    });

    it("returns from details to the reason dialogue and keeps the pause showing", async () => {
        const fixture = createFixture({ marker: "11" });
        vi.mocked(fixture.ui.showSummary).mockResolvedValueOnce("details").mockResolvedValueOnce("keep-paused");
        vi.mocked(fixture.ui.showDetails).mockResolvedValue("back");

        await fixture.controller.initialise();
        await fixture.controller.openReview();

        expect(fixture.ui.showSummary).toHaveBeenCalledTimes(2);
        expect(fixture.ui.showDetails).toHaveBeenCalledOnce();
        // The pause stays visible in the status bar rather than as a Notice
        // the reader has to dismiss again.
        expect(syncHold.value).toBe(HOLD_COMPATIBILITY);
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("11");
    });

    it("migrates the old Vault-scoped marker to Commonlib device-local storage", async () => {
        const fixture = createFixture({ legacyMarker: "11" });

        await fixture.controller.initialise();

        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("11");
        expect(fixture.local.has(fixture.legacyKey)).toBe(false);
        expect(fixture.controller.pendingPause).toBeDefined();
    });

    it("restores the runtime gate if persisting an acknowledgement fails", async () => {
        const fixture = createFixture({ marker: "11" });
        vi.mocked(fixture.ui.showSummary).mockResolvedValue("resume");
        await fixture.controller.initialise();
        fixture.saveSettingData.mockRejectedValueOnce(new Error("save failed"));

        await expect(fixture.controller.openReview()).rejects.toThrow("save failed");

        expect(fixture.settings.versionUpFlash).toBe(COMPATIBILITY_PAUSE_SETTING_MESSAGE);
        expect(fixture.local.get(DATABASE_COMPATIBILITY_VERSION_KEY)).toBe("11");
        expect(fixture.applySettings).not.toHaveBeenCalled();
    });

    it("does not open a delayed review after the controller has been disposed", async () => {
        const fixture = createFixture({ marker: "11" });
        await fixture.controller.initialise();

        fixture.controller.dispose();
        await fixture.controller.openReview();

        expect(fixture.controller.pendingPause).toBeUndefined();
        expect(fixture.ui.showSummary).not.toHaveBeenCalled();
        expect(fixture.ui.clearReminder).toHaveBeenCalledOnce();
    });

    it("never opens the review on its own", () => {
        const onSettingLoaded = { addHandler: vi.fn() };
        const onLayoutReady = { addHandler: vi.fn() };
        const onUnload = { addHandler: vi.fn() };
        const addCommand = vi.fn();
        const core = {
            services: {
                appLifecycle: { onSettingLoaded, onLayoutReady, onUnload },
                API: { addCommand },
            },
        } as unknown as Parameters<typeof useCompatibilityReview>[0];
        const ui: CompatibilityReviewUi = {
            showSummary: vi.fn(),
            showDetails: vi.fn(),
            clearReminder: vi.fn(),
        };

        useCompatibilityReview(core, ui);

        // A pause is a state, not an interruption. It is shown in the status
        // bar and explained by a command, never by a dialogue at start-up.
        expect(onLayoutReady.addHandler).not.toHaveBeenCalled();
        expect(addCommand).toHaveBeenCalled();
    });
});
