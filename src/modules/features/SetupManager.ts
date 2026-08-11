import {
    type EncryptionSettings,
    type ObsidianLiveSyncSettings,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    REMOTE_COUCHDB,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";
import { upsertRemoteConfigurationInPlace } from "@vrtmrz/livesync-commonlib/remote-configurations";
import { isObjectDifferent } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import ScanQRCode from "./SetupWizard/dialogs/ScanQRCode.svelte";
import UseSetupURI from "./SetupWizard/dialogs/UseSetupURI.svelte";
import ConfirmSetupPlan from "./SetupWizard/dialogs/ConfirmSetupPlan.svelte";
import {
    SETUP_RECONNECT,
    SETUP_SEED,
    isRemoteInitialised,
    planSetup,
    type RemoteObservation,
    type SetupAction,
} from "./SetupWizard/setupPlan.ts";
import { probeCouchDBConnection } from "./SetupWizard/dialogs/couchDBConnectionProbe.ts";
import SetupRemoteCouchDB from "./SetupWizard/dialogs/SetupRemoteCouchDB.svelte";
import SetupRemoteE2EE from "./SetupWizard/dialogs/SetupRemoteE2EE.svelte";
import { decodeSettingsFromQRCodeData } from "@vrtmrz/livesync-commonlib/compat/API/processSetting";
import { AbstractModule } from "@/modules/AbstractModule.ts";
import type {
    ScanQRCodeResultType,
    SetupPlanResultType,
    SetupRemoteCouchDBResultType,
    SetupRemoteCouchDBInitialData,
    SetupRemoteE2EEResultType,
    UseSetupURIResultType,
} from "./SetupWizard/dialogs/setupDialogTypes.ts";
import {
    applySettingsAndFetchOnActivation,
    applySettingsWithScheduledInitialisation,
} from "@/serviceFeatures/setupObsidian/setupActivationLifecycle.ts";

function copySettingsForRemoteProfileUpdate(settings: ObsidianLiveSyncSettings): ObsidianLiveSyncSettings {
    return {
        ...settings,
        remoteConfigurations: { ...(settings.remoteConfigurations ?? {}) },
    };
}

/**
 * User modes for onboarding and setup
 */
export const enum UserMode {
    /**
     * New User Mode - for users who are new to the plugin
     */
    NewUser = "new-user",
    /**
     * Existing User Mode - for users who have used the plugin before, or just configuring again
     */
    ExistingUser = "existing-user",
    /**
     * Unknown User Mode - for cases where the user mode is not determined
     */
    Unknown = "unknown",
    /**
     * Update User Mode - for users who are updating configuration. May be `existing-user` as well, but possibly they want to treat it differently.
     */
    // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values -- Update is a semantic alias for the unknown setup mode.
    Update = "unknown", // Alias for Unknown for better readability
}

/**
 * Setup Manager to handle onboarding and configuration setup
 */
export class SetupManager extends AbstractModule {
    // /**
    //  * Dialog manager for handling Svelte dialogs
    //  */
    // private dialogManager: SvelteDialogManager = new SvelteDialogManager(this.plugin);
    get dialogManager() {
        return this.services.UI.dialogManager;
    }

    /**
     * Setup, in three questions: where the server is, whether to encrypt, and
     * what to do about the files that already exist.
     *
     * The last one used to be asked twice, in the user's own words — "are you a
     * new user or an existing user?" — before and after the connection details.
     * Neither asking was necessary: once the server has answered, the plugin can
     * see which case it is in. It now looks, and states what it will do.
     */
    async startOnBoarding(): Promise<boolean> {
        const isConfigured = this.settings.isConfigured === true;
        const startingPoint = isConfigured ? this.core.settings : createNewVaultSettings();

        const couchConf = await this.dialogManager.openWithExplicitCancel<
            SetupRemoteCouchDBResultType,
            SetupRemoteCouchDBInitialData
        >(SetupRemoteCouchDB, {
            settings: startingPoint,
            mode: isConfigured ? "settings" : "create-or-connect",
        });
        if (couchConf === "cancelled") {
            this._log("Setup cancelled.", LOG_LEVEL_VERBOSE);
            return false;
        }

        const e2eeConf = await this.dialogManager.openWithExplicitCancel<SetupRemoteE2EEResultType, EncryptionSettings>(
            SetupRemoteE2EE,
            { ...startingPoint, ...couchConf }
        );
        if (e2eeConf === "cancelled") {
            this._log("Setup cancelled.", LOG_LEVEL_VERBOSE);
            return false;
        }

        const newSetting = {
            ...copySettingsForRemoteProfileUpdate(startingPoint),
            ...couchConf,
            ...e2eeConf,
            remoteType: REMOTE_COUCHDB,
        } as ObsidianLiveSyncSettings;
        upsertRemoteConfigurationInPlace(newSetting, "couchdb", { activate: true });

        const plan = planSetup(await this.observeRemote(newSetting), {
            fileCount: await this.countLocalFiles(),
            wasConfigured: isConfigured,
        });
        const confirmed = await this.dialogManager.openWithExplicitCancel<SetupPlanResultType, typeof plan>(
            ConfirmSetupPlan,
            plan
        );
        if (confirmed !== "apply") {
            this._log("Setup was not applied.", LOG_LEVEL_NOTICE);
            return false;
        }

        return await this.applyPlannedSetup(newSetting, plan.action);
    }

    /**
     * Files in this vault, as the user would count them. Used only to say what
     * is at stake, so a failure to count must not block setup.
     */
    private async countLocalFiles(): Promise<number> {
        try {
            return (await this.core.storageAccess.getFiles()).length;
        } catch {
            return 0;
        }
    }

    /**
     * Asks the server what it already holds.
     *
     * By document count, not by size. An empty CouchDB database is not zero
     * bytes — a fresh one reports about 16 kB of its own bookkeeping — so a
     * size test called every database initialised, the "server is empty" plan
     * was unreachable, and a first setup was told it was joining a vault that
     * did not exist.
     *
     * `doc_count` counts chunks as well as files, so it is deliberately not
     * reported to the user as a file count. It is used only to tell an empty
     * database from one that must not be seeded over.
     */
    private async observeRemote(settings: ObsidianLiveSyncSettings): Promise<RemoteObservation> {
        const replicator = await this.services.replicator.getNewReplicator(settings);
        if (!replicator) {
            return { reachable: false, initialised: false, unreachableReason: "No replicator is available." };
        }
        const probe = await probeCouchDBConnection(replicator, settings, false);
        if (!probe.ok) {
            return { reachable: false, initialised: false, unreachableReason: probe.reason };
        }
        const status = await replicator.getRemoteStatus(settings);
        return { reachable: true, initialised: isRemoteInitialised(status) };
    }

    /**
     * Commits the plan. Seeding rebuilds the remote from this vault; joining
     * fetches it; reconnecting writes the settings and leaves both sides alone.
     */
    private async applyPlannedSetup(newConf: ObsidianLiveSyncSettings, action: SetupAction): Promise<boolean> {
        const settled = await this.services.setting.adjustSettings({ ...this.settings, ...newConf });
        if (action === SETUP_RECONNECT) {
            await this.applySetting(settled, UserMode.ExistingUser);
            this._log("Connection settings saved.", LOG_LEVEL_NOTICE);
            return true;
        }
        // The initialisation must be reserved before the new settings are
        // enabled, so the running plugin cannot start ordinary processing first.
        await applySettingsWithScheduledInitialisation(
            this.core.rebuilder,
            action === SETUP_SEED ? "rebuild" : "fetch",
            async () => {
                await this.applySetting(settled, action === SETUP_SEED ? UserMode.NewUser : UserMode.ExistingUser);
            }
        );
        return true;
    }

    /**
     * Handles setup using a setup URI
     * @param userMode
     * @param setupURI
     * @returns Promise that resolves to true if onboarding completed successfully, false otherwise
     */
    async onUseSetupURI(userMode: UserMode, setupURI: string = ""): Promise<boolean> {
        const newSetting = await this.dialogManager.openWithExplicitCancel<UseSetupURIResultType, string>(
            UseSetupURI,
            setupURI
        );
        if (newSetting === "cancelled") {
            this._log("Setup URI dialog cancelled.", LOG_LEVEL_NOTICE);
            return false;
        }
        this._log("Setup URI dialog closed.", LOG_LEVEL_VERBOSE);
        return await this.onConfirmApplySettingsFromWizard(newSetting, userMode);
    }

    /**
     * Handles manual setup for CouchDB
     * @param userMode
     * @param currentSetting
     * @param activate  Whether to activate the CouchDB as remote type
     * @returns Promise that resolves to true if setup completed successfully, false otherwise
     */
    async onCouchDBManualSetup(
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate = true
    ): Promise<boolean> {
        const couchConf = await this.dialogManager.openWithExplicitCancel<
            SetupRemoteCouchDBResultType,
            SetupRemoteCouchDBInitialData
        >(SetupRemoteCouchDB, {
            settings: currentSetting,
            mode:
                userMode === UserMode.NewUser
                    ? "create-or-connect"
                    : userMode === UserMode.ExistingUser
                      ? "connect-existing"
                      : "settings",
        });
        if (couchConf === "cancelled") {
            this._log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return false;
        }
        const newSetting = {
            ...copySettingsForRemoteProfileUpdate(currentSetting),
            ...couchConf,
        } as ObsidianLiveSyncSettings;
        if (activate) {
            newSetting.remoteType = REMOTE_COUCHDB;
        }
        upsertRemoteConfigurationInPlace(newSetting, "couchdb", { activate });
        return await this.onConfirmApplySettingsFromWizard(newSetting, userMode, activate);
    }



    /**
     * Handles only E2EE configuration
     * @param userMode
     * @param currentSetting
     * @returns
     */
    async onlyE2EEConfiguration(userMode: UserMode, currentSetting: ObsidianLiveSyncSettings): Promise<boolean> {
        const e2eeConf = await this.dialogManager.openWithExplicitCancel<SetupRemoteE2EEResultType, EncryptionSettings>(
            SetupRemoteE2EE,
            currentSetting
        );
        if (e2eeConf === "cancelled") {
            this._log("E2EE configuration cancelled.", LOG_LEVEL_NOTICE);
            return false;
        }
        const newSetting = {
            ...currentSetting,
            ...e2eeConf,
        } as ObsidianLiveSyncSettings;
        return await this.onConfirmApplySettingsFromWizard(newSetting, userMode);
    }

    /**
     * Handles manual configuration flow (E2EE + select server)
     * @param originalSetting
     * @param userMode
     * @returns
     */
    async onConfigureManually(originalSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean> {
        const e2eeConf = await this.dialogManager.openWithExplicitCancel<SetupRemoteE2EEResultType, EncryptionSettings>(
            SetupRemoteE2EE,
            originalSetting
        );
        if (e2eeConf === "cancelled") {
            this._log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return false;
        }
        const currentSetting = {
            ...originalSetting,
            ...e2eeConf,
        } as ObsidianLiveSyncSettings;
        return await this.onSelectServer(currentSetting, userMode);
    }

    /**
     * Handles server selection during manual configuration
     * @param currentSetting
     * @param userMode
     * @returns
     */
    async onSelectServer(currentSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean> {
        // CouchDB is the only supported remote, so there is nothing to choose.
        return await this.onCouchDBManualSetup(userMode, currentSetting, true);
    }
    /**
     * Confirms and applies settings obtained from the wizard
     * @param newConf
     * @param _userMode
     * @param activate Whether to activate the remote type in the new settings
     * @param extra  Extra function to run before applying settings
     * @returns Promise that resolves to true if settings applied successfully, false otherwise
     */
    async onConfirmApplySettingsFromWizard(
        newConf: ObsidianLiveSyncSettings,
        _userMode: UserMode,
        activate: boolean = true,
        extra: () => void = () => {}
    ): Promise<boolean> {
        newConf = await this.services.setting.adjustSettings({
            ...this.settings,
            ...newConf,
        });

        if (isObjectDifferent(this.settings, newConf, true) === false) {
            this._log("No changes in settings detected. Skipping applying settings from wizard.", LOG_LEVEL_NOTICE);
            return true;
        }
        if (!activate) {
            extra();
            const applied = await this.applySettingAndScheduleFetchOnActivation(newConf, UserMode.ExistingUser);
            if (applied) this._log("Setting Applied", LOG_LEVEL_NOTICE);
            return applied;
        }
        // A change that alters no stored value cannot need the database rebuilt.
        if (isObjectDifferent({ ...this.settings }, { ...newConf }, true) === false) {
            extra();
            const applied = await this.applySettingAndScheduleFetchOnActivation(newConf, UserMode.ExistingUser);
            if (applied) this._log("Settings from wizard applied.", LOG_LEVEL_NOTICE);
            return applied;
        }

        // The wizard used to ask the reader to classify themselves here: new
        // server, joining device, or "the configuration is compatible (or got
        // compatible by this operation)" — a sentence nobody outside this
        // codebase can evaluate, with data loss as the penalty for guessing.
        // It is the same question setup answers by looking at the server, so it
        // is answered the same way, whether the settings arrived by hand, by
        // link, or by QR code.
        const plan = planSetup(await this.observeRemote(newConf), {
            fileCount: await this.countLocalFiles(),
            wasConfigured: this.settings.isConfigured === true,
        });
        const confirmed = await this.dialogManager.openWithExplicitCancel<SetupPlanResultType, typeof plan>(
            ConfirmSetupPlan,
            plan
        );
        if (confirmed !== "apply") {
            this._log("Setup was not applied.", LOG_LEVEL_NOTICE);
            return false;
        }
        extra();
        return await this.applyPlannedSetup(newConf, plan.action);
    }

    /**
     * Prompts the user with QR code scanning instructions
     * @returns Promise that resolves to false as QR code instruction dialog does not yield settings directly
     */

    async onPromptQRCodeInstruction(): Promise<boolean> {
        const qrResult = await this.dialogManager.open<ScanQRCodeResultType>(ScanQRCode);
        this._log("QR Code dialog closed.", LOG_LEVEL_VERBOSE);
        // Result is not used, but log it for debugging.
        this._log(qrResult, LOG_LEVEL_VERBOSE);
        // QR Code instruction dialog never yields settings directly.
        return false;
    }

    /**
     * Decodes settings from a QR code string and applies them
     * @param qr QR code string containing encoded settings
     * @returns Promise that resolves to true if settings applied successfully, false otherwise
     */
    async decodeQR(qr: string) {
        const newSettings = decodeSettingsFromQRCodeData(qr);
        return await this.onConfirmApplySettingsFromWizard(newSettings, UserMode.Unknown);
    }

    /**
     * Applies the new settings to the core settings and saves them
     * @param newConf
     * @param userMode
     * @returns Promise that resolves to true if settings applied successfully, false otherwise
     */
    async applySetting(newConf: ObsidianLiveSyncSettings, userMode: UserMode) {
        this.services.setting.clearUsedPassphrase();
        await this.services.setting.applyExternalSettings(newConf, true);
        return true;
    }

    private async applySettingAndScheduleFetchOnActivation(
        newConf: ObsidianLiveSyncSettings,
        userMode: UserMode
    ): Promise<boolean> {
        const wasConfigured = this.settings.isConfigured;
        return await applySettingsAndFetchOnActivation(
            this.core.rebuilder,
            wasConfigured,
            newConf.isConfigured,
            async () => {
                await this.applySetting(newConf, userMode);
            }
        );
    }
}
