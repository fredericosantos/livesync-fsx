import { App, Component, PluginSettingTab, SettingGroup } from "@/deps.ts";
import {
    type ObsidianLiveSyncSettings,
    type RemoteDBSettings,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    FLAGMD_REDFLAG2_HR,
    FLAGMD_REDFLAG3_HR,
    REMOTE_COUCHDB,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { delay, isObjectDifferent } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { Logger } from "@vrtmrz/livesync-commonlib/compat/common/logger";
import { checkSyncInfo } from "@vrtmrz/livesync-commonlib/compat/pouchdb/negotiation";
import { testCrypt } from "octagonal-wheels/encryption/encryption";
import ObsidianLiveSyncPlugin from "@/main.ts";
import { scheduleTask } from "@/common/utils.ts";
import { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import {
    type AllSettingItemKey,
    type AllStringItemKey,
    type AllNumericItemKey,
    type AllBooleanItemKey,
    type AllSettings,
    OnDialogSettingsDefault,
    type OnDialogSettings,
    getConfName,
} from "./settingConstants.ts";
import { $msg } from "@/common/translation";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { fireAndForget, yieldNextAnimationFrame } from "octagonal-wheels/promises";
import { EVENT_REQUEST_RELOAD_SETTING_TAB, eventHub } from "@/common/events.ts";
import {
    enableOnly,
    // findAttrFromParent,
    // getLevelStr,
    setStyle,
    visibleOnly,
    type OnSavedHandler,
    type OnSavedHandlerFunc,
    type OnUpdateFunc,
    type OnUpdateResult,
    type UpdateFunction,
} from "./SettingPane.ts";
import { sectionsFor } from "./settingsCatalogue.ts";
import { renderSection } from "./renderSection.ts";
import { SECTION_EXTRAS } from "./sectionExtras.ts";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { closeObsidianSettings } from "@/common/obsidianSettings.ts";

// For creating a document
// const toc = new Set<string>();

export class ObsidianLiveSyncSettingTab extends PluginSettingTab {
    plugin: ObsidianLiveSyncPlugin;
    private _lifetimeComponent: Component = new Component();
    get lifetimeComponent(): Component {
        return this._lifetimeComponent;
    }
    get core() {
        return this.plugin.core;
    }
    get services() {
        return this.core.services;
    }
    selectedScreen = "";

    _editingSettings?: AllSettings;
    // Buffered Settings for editing
    get editingSettings(): AllSettings {
        if (!this._editingSettings) {
            this.reloadAllSettings();
        }
        return this._editingSettings!;
    }
    set editingSettings(v) {
        if (!this._editingSettings) {
            this.reloadAllSettings();
        }
        this._editingSettings = v;
    }

    // Buffered Settings for comparing.
    initialSettings?: typeof this.editingSettings;

    private copySettingValue(target: object | undefined, source: object, key: AllSettingItemKey): void {
        if (!target) {
            throw new Error("Initial settings have not been loaded");
        }
        const value: unknown = Reflect.get(source, key);
        Reflect.set(target, key, value);
    }

    /**
     * Apply editing setting to the plug-in.
     * @param keys setting keys for applying
     */
    applySetting(keys: AllSettingItemKey[]) {
        for (const k of keys) {
            if (!this.isDirty(k)) continue;
            if (k in OnDialogSettingsDefault) {
                // //@ts-ignore
                // this.initialSettings[k] = this.editingSettings[k];
                continue;
            }
            this.copySettingValue(this.core.settings, this.editingSettings, k);
            this.copySettingValue(this.initialSettings, this.core.settings, k);
        }
        keys.forEach((e) => this.refreshSetting(e));
    }
    applyAllSettings() {
        const changedKeys = (Object.keys(this.editingSettings ?? {}) as AllSettingItemKey[]).filter((e) =>
            this.isDirty(e)
        );
        this.applySetting(changedKeys);
        this.reloadAllSettings();
    }

    async saveLocalSetting(key: keyof typeof OnDialogSettingsDefault) {
        if (key == "configPassphrase") {
            compatGlobal.localStorage.setItem("ls-fsx-setting-passphrase", this.editingSettings?.[key] ?? "");
            return await Promise.resolve();
        }
        if (key == "deviceAndVaultName") {
            this.services.setting.setDeviceAndVaultName(this.editingSettings?.[key] ?? "");
            this.services.setting.saveDeviceAndVaultName();
            return await Promise.resolve();
        }
    }
    /**
     * Apply and save setting to the plug-in.
     * @param keys setting keys for applying
     */
    async saveSettings(keys: AllSettingItemKey[]) {
        let hasChanged = false;
        const appliedKeys = [] as AllSettingItemKey[];
        for (const k of keys) {
            if (!this.isDirty(k)) continue;
            appliedKeys.push(k);
            if (k in OnDialogSettingsDefault) {
                await this.saveLocalSetting(k as keyof OnDialogSettings);
                this.copySettingValue(this.initialSettings, this.editingSettings, k);
                continue;
            }
            this.copySettingValue(this.core.settings, this.editingSettings, k);
            this.copySettingValue(this.initialSettings, this.core.settings, k);
            hasChanged = true;
        }

        if (hasChanged) {
            await this.services.setting.saveSettingData();
        }

        // if (runOnSaved) {
        const handlers = this.onSavedHandlers
            .filter((e) => appliedKeys.indexOf(e.key) !== -1)
            .map((e) => Promise.resolve(e.handler(this.editingSettings[e.key])));
        await Promise.all(handlers);
        // }
        keys.forEach((e) => this.refreshSetting(e));
    }

    /**
     * Apply all editing setting to the plug-in.
     * @param keys setting keys for applying
     */
    async saveAllDirtySettings() {
        const changedKeys = (Object.keys(this.editingSettings ?? {}) as AllSettingItemKey[]).filter((e) =>
            this.isDirty(e)
        );
        await this.saveSettings(changedKeys);
        this.reloadAllSettings();
    }

    /**
     * Invalidate buffered value and fetch the latest.
     */
    requestUpdate() {
        scheduleTask("update-setting", 10, () => {
            for (const setting of this.settingComponents) {
                setting._onUpdate();
            }
            for (const func of this.controlledElementFunc) {
                func();
            }
        });
    }

    reloadAllLocalSettings() {
        const ret = { ...OnDialogSettingsDefault };
        ret.configPassphrase = compatGlobal.localStorage.getItem("ls-fsx-setting-passphrase") || "";
        ret.preset = "";
        ret.deviceAndVaultName = this.services.setting.getDeviceAndVaultName();
        return ret;
    }
    computeAllLocalSettings(): Partial<OnDialogSettings> {
        const syncMode = this.editingSettings?.liveSync
            ? "LIVESYNC"
            : this.editingSettings?.periodicReplication
              ? "PERIODIC"
              : "ONEVENTS";
        return {
            syncMode,
        };
    }
    /**
     * Reread all settings and request invalidate
     */
    reloadAllSettings(skipUpdate: boolean = false) {
        const localSetting = this.reloadAllLocalSettings();
        this._editingSettings = { ...this.core.settings, ...localSetting };
        this._editingSettings = { ...this.editingSettings, ...this.computeAllLocalSettings() };
        this.initialSettings = { ...this.editingSettings };
        if (!skipUpdate) this.requestUpdate();
    }

    /**
     * Reread each setting and request invalidate
     */
    refreshSetting(key: AllSettingItemKey) {
        const localSetting = this.reloadAllLocalSettings();
        if (key in this.core.settings) {
            if (key in localSetting) {
                this.copySettingValue(this.initialSettings, localSetting, key);
                this.copySettingValue(this.editingSettings, localSetting, key);
            } else {
                this.copySettingValue(this.initialSettings, this.core.settings, key);
                this.copySettingValue(this.editingSettings, this.initialSettings ?? {}, key);
            }
        }
        this.editingSettings = { ...this.editingSettings, ...this.computeAllLocalSettings() };
        // this.initialSettings = { ...this.initialSettings };
        this.requestUpdate();
    }

    isDirty(key: AllSettingItemKey) {
        return isObjectDifferent(this.editingSettings[key], this.initialSettings?.[key]);
    }
    isSomeDirty(keys: AllSettingItemKey[]) {
        // if (debug) {
        //     console.dir(keys);
        //     console.dir(keys.map(e => this.isDirty(e)));
        // }
        return keys.some((e) => this.isDirty(e));
    }

    isConfiguredAs(key: AllStringItemKey, value: string): boolean;
    isConfiguredAs(key: AllNumericItemKey, value: number): boolean;
    isConfiguredAs(key: AllBooleanItemKey, value: boolean): boolean;
    isConfiguredAs(key: AllSettingItemKey, value: AllSettings[typeof key]) {
        if (!this.editingSettings) {
            return false;
        }
        return this.editingSettings[key] == value;
    }
    // UI Element Wrapper -->
    settingComponents = [] as Setting[];
    controlledElementFunc = [] as UpdateFunction[];
    onSavedHandlers = [] as OnSavedHandler<AllSettingItemKey>[];

    inWizard: boolean = false;

    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        Setting.env = this;
        eventHub.onEvent(EVENT_REQUEST_RELOAD_SETTING_TAB, () => {
            this.requestReload();
        });
    }

    closeSetting() {
        closeObsidianSettings(this.plugin.app);
    }

    handleElement(element: HTMLElement, func: OnUpdateFunc) {
        const updateFunc = ((element, func) => {
            const prev = {} as OnUpdateResult;
            return () => {
                const newValue = func();
                const keys = Object.keys(newValue) as [keyof OnUpdateResult];
                for (const k of keys) {
                    if (prev[k] !== newValue[k]) {
                        if (k == "visibility") {
                            element.toggleClass("lsfsx-setting-hidden", !(newValue[k] || false));
                        }
                        //@ts-ignore
                        prev[k] = newValue[k];
                    }
                }
            };
        })(element, func);
        this.controlledElementFunc.push(updateFunc);
        updateFunc();
    }

    createEl<T extends keyof HTMLElementTagNameMap>(
        el: HTMLElement,
        tag: T,
        o?: string | DomElementInfo,
        callback?: (el: HTMLElementTagNameMap[T]) => void,
        func?: OnUpdateFunc
    ) {
        const element = el.createEl(tag, o, callback);
        if (func) this.handleElement(element, func);
        return element;
    }

    addEl<T extends keyof HTMLElementTagNameMap>(
        el: HTMLElement,
        tag: T,
        o?: string | DomElementInfo,
        callback?: (el: HTMLElementTagNameMap[T]) => void,
        func?: OnUpdateFunc
    ) {
        const elm = this.createEl(el, tag, o, callback, func);
        return Promise.resolve(elm);
    }

    addOnSaved<T extends AllSettingItemKey>(key: T, func: OnSavedHandlerFunc<T>) {
        const newHandler = { key, handler: func } as OnSavedHandler<AllSettingItemKey>;
        this.onSavedHandlers.push(newHandler);
    }
    resetEditingSettings() {
        this._editingSettings = undefined;
        this.initialSettings = undefined;
    }

    override hide() {
        super.hide();
        this._lifetimeComponent.unload();
        this.isShown = false;
    }
    isShown: boolean = false;

    requestReload() {
        if (this.isShown) {
            const newConf = this.core.settings;
            const keys = Object.keys(newConf) as (keyof ObsidianLiveSyncSettings)[];
            let hasLoaded = false;
            for (const k of keys) {
                if (isObjectDifferent(newConf[k], this.initialSettings?.[k])) {
                    // Something has changed
                    if (this.isDirty(k as AllSettingItemKey)) {
                        // And modified.
                        this.core.confirm.askInPopup(
                            `config-reloaded-${k}`,
                            $msg("obsidianLiveSyncSettingTab.msgSettingModified", {
                                setting: getConfName(k as AllSettingItemKey),
                            }),
                            (anchor) => {
                                anchor.text = $msg("obsidianLiveSyncSettingTab.optionHere");
                                anchor.addEventListener("click", () => {
                                    this.refreshSetting(k as AllSettingItemKey);
                                    this.display();
                                });
                            }
                        );
                    } else {
                        // not modified
                        this.refreshSetting(k as AllSettingItemKey);
                        if (k in OnDialogSettingsDefault) {
                            continue;
                        }
                        hasLoaded = true;
                    }
                }
            }
            if (hasLoaded) {
                this.display();
            } else {
                this.requestUpdate();
            }
        } else {
            this.reloadAllSettings(true);
        }
    }

    /**
     * Kept because the settings page is a single scroll and there is nothing to
     * switch between; `enableMinimalSetup` used to drop the dialogue into a
     * cut-down wizard mode, which the setup flow now handles on its own.
     */
    isNeedRebuildLocal() {
        return this.isSomeDirty([
            "useIndexedDBAdapter",
            "handleFilenameCaseSensitive",
            "passphrase",
            "useDynamicIterationCount",
            "usePathObfuscation",
            "encrypt",
            // "remoteType",
        ]);
    }
    isNeedRebuildRemote() {
        return this.isSomeDirty([
            "handleFilenameCaseSensitive",
            "passphrase",
            "useDynamicIterationCount",
            "usePathObfuscation",
            "encrypt",
        ]);
    }
    isAnySyncEnabled() {
        if (this.isConfiguredAs("isConfigured", false)) return false;
        if (this.isConfiguredAs("liveSync", true)) return true;
        if (this.isConfiguredAs("periodicReplication", true)) return true;
        if (this.isConfiguredAs("syncOnFileOpen", true)) return true;
        if (this.isConfiguredAs("syncOnSave", true)) return true;
        if (this.isConfiguredAs("syncOnEditorSave", true)) return true;
        if (this.isConfiguredAs("syncOnStart", true)) return true;
        if (this.isConfiguredAs("syncAfterMerge", true)) return true;
        if (this.isConfiguredAs("syncOnFileOpen", true)) return true;
        if (this.core?.replicator?.syncStatus == "CONNECTED") return true;
        if (this.core?.replicator?.syncStatus == "PAUSED") return true;
        return false;
    }

    enableOnlySyncDisabled = enableOnly(() => !this.isAnySyncEnabled());

    onlyOnCouchDB = () =>
        ({
            visibility: this.isConfiguredAs("remoteType", REMOTE_COUCHDB),
        }) as OnUpdateResult;
    // E2EE Function
    checkWorkingPassphrase = async (): Promise<boolean> => {
        const settingForCheck: RemoteDBSettings = {
            ...this.editingSettings,
        };
        const replicator = this.services.replicator.getNewReplicator(settingForCheck);
        if (!(replicator instanceof LiveSyncCouchDBReplicator)) return true;

        const db = await replicator.connectRemoteCouchDBWithSetting(
            settingForCheck,
            this.services.API.isMobile(),
            true
        );
        if (typeof db === "string") {
            Logger(`Could not check the passphrase against the server: ${db}`, LOG_LEVEL_NOTICE);
            return false;
        } else {
            if (await checkSyncInfo(db.db)) {
                // Logger($msg("obsidianLiveSyncSettingTab.logDatabaseConnected"), LOG_LEVEL_NOTICE);
                return true;
            } else {
                Logger("This passphrase cannot read what is already on the server.", LOG_LEVEL_NOTICE);
                return false;
            }
        }
    };
    isPassphraseValid = async () => {
        if (this.editingSettings.encrypt && this.editingSettings.passphrase == "") {
            Logger("Encryption needs a passphrase.", LOG_LEVEL_NOTICE);
            return false;
        }
        if (this.editingSettings.encrypt && !(await testCrypt())) {
            Logger("This device cannot encrypt: its browser engine has no Web Crypto support.", LOG_LEVEL_NOTICE);
            return false;
        }
        return true;
    };

    rebuildDB = async (method: "localOnly" | "remoteOnly" | "rebuildBothByThisDevice" | "localOnlyWithChunks") => {
        if (this.editingSettings.encrypt && this.editingSettings.passphrase == "") {
            Logger("Encryption needs a passphrase.", LOG_LEVEL_NOTICE);
            return;
        }
        if (this.editingSettings.encrypt && !(await testCrypt())) {
            Logger("This device cannot encrypt: its browser engine has no Web Crypto support.", LOG_LEVEL_NOTICE);
            return;
        }
        if (!this.editingSettings.encrypt) {
            this.editingSettings.passphrase = "";
        }
        this.applyAllSettings();
        await this.services.setting.suspendAllSync();
        await this.services.setting.suspendExtraSync();
        this.reloadAllSettings();
        this.editingSettings.isConfigured = true;
        Logger("Syncing is paused while the database is rebuilt.", LOG_LEVEL_INFO);
        await this.saveAllDirtySettings();
        this.closeSetting();
        await delay(2000);
        await this.core.rebuilder.$performRebuildDB(method);
    };
    /**
     * Applies a change that cannot take effect without rebuilding a database.
     *
     * This used to be a four-button dialogue whose message embedded a markdown
     * table legend — "| ⇔ | Up to Date |", "At a glance: 📄 ⇒¹ 💻 ⇒² 🛰️ ⇢ⁿ 💻 ⇄ⁿ⁺¹ 📄" —
     * and one of the four, "(Danger) Save Only Settings", was described in its
     * own help text as possibly leading to data corruption.
     *
     * The question it asked has an answer the plug-in can work out. Only
     * encryption reaches here, and `checkWorkingPassphrase` already tests the
     * new passphrase against the server: if the server's contents can be read
     * with it, this device is joining something that already exists and should
     * take it; if they cannot, this device holds the only readable copy and the
     * server has to be rebuilt from it.
     */
    async confirmRebuild() {
        if (!(await this.isPassphraseValid())) {
            Logger("That passphrase cannot be used. Correct it and try again.", LOG_LEVEL_NOTICE);
            return;
        }

        const serverIsReadable = await this.checkWorkingPassphrase();
        const PROCEED = serverIsReadable ? "Replace files on this device" : "Replace files on server";
        const CANCEL = $msg("obsidianLiveSyncSettingTab.optionCancel");
        const message = serverIsReadable
            ? "The remote vault can be read with these settings, so it will overwrite this vault. " +
              "Any changes made here that have not synced to the server are kept as a second copy of the file."
            : "The remote vault cannot be read with these settings, so this vault will overwrite it. " +
              "Any changes made on other devices that have not synced to this device will be lost, " +
              "and each of them will download the result.";

        const result = await this.core.confirm.confirmWithMessage(
            "This change rebuilds the database",
            message,
            [PROCEED, CANCEL],
            CANCEL
        );
        if (result !== PROCEED) return;

        if (!this.editingSettings.encrypt) {
            this.editingSettings.passphrase = "";
        }
        await this.saveAllDirtySettings();
        await Promise.resolve(this.applyAllSettings());
        await this.core.storageAccess.writeFileAuto(
            serverIsReadable ? FLAGMD_REDFLAG3_HR : FLAGMD_REDFLAG2_HR,
            ""
        );
        this.services.appLifecycle.scheduleRestart();
        this.closeSetting();
    }

    override display(): void {
        // Make sure lifetime component is loaded for markdown rendering in panes.
        this._lifetimeComponent.load();
        const { containerEl } = this;
        this.settingComponents.length = 0;
        this.controlledElementFunc.length = 0;
        this.onSavedHandlers.length = 0;
        if (this._editingSettings == undefined || this.initialSettings == undefined) {
            this.reloadAllSettings();
        }
        if (this.editingSettings === undefined || this.initialSettings == undefined) {
            return;
        }
        this.isShown = true;

        containerEl.empty();

        containerEl.addClass("lsfsx-setting");
        containerEl.removeClass("isWizard");

        setStyle(containerEl, "menu-setting-poweruser", () => this.isConfiguredAs("usePowerUserMode", true));
        setStyle(containerEl, "menu-setting-advanced", () => this.isConfiguredAs("useAdvancedMode", true));
        setStyle(containerEl, "menu-setting-edgecase", () => this.isConfiguredAs("useEdgeCaseMode", true));

        // One page. Tabs exist to manage volume; once the volume is cut, they
        // only hide things a reader could otherwise scan past in a second.
        // The banner below is attached directly: the wrapper it used to live in
        // survived the rail's removal as an empty div, and upstream's stylesheet
        // — loaded alongside ours whenever both plugins are enabled — made it a
        // sticky, blurred bar that smeared the content scrolling under it.

        this.createEl(
            containerEl,
            "div",
            { cls: "lsfsx-setting-menu-buttons" },
            (el) => {
                el.addClass("wizardHidden");
                el.createEl("label", { text: $msg("obsidianLiveSyncSettingTab.msgChangesNeedToBeApplied") });
                void this.addEl(
                    el,
                    "button",
                    { text: $msg("obsidianLiveSyncSettingTab.optionApply"), cls: "mod-warning" },
                    (buttonEl) => {
                        buttonEl.addEventListener("click", () =>
                            fireAndForget(async () => await this.confirmRebuild())
                        );
                    }
                );
            },
            visibleOnly(() => this.isNeedRebuildLocal() || this.isNeedRebuildRemote())
        );

        // The whole page: one `SettingGroup` per catalogue section, appended in
        // catalogue order. `SettingGroup` is Obsidian's own primitive (API
        // 1.11+) — it renders the heading above a single rounded card, puts
        // hairline rules between the items, and carries the same vertical
        // rhythm as every other settings page in the app.
        //
        // The groups must be *direct siblings* of one another. Obsidian spaces
        // them with `.setting-group + .setting-group`, so wrapping each one in
        // a div of our own — which is what a per-section visibility hook
        // tempted us into — silently removes every gap on the page.
        for (const section of sectionsFor(this.editingSettings.isConfigured === true)) {
            const group = new SettingGroup(containerEl);
            if (section.title) group.setHeading(section.title);
            renderSection(this, group.listEl, section);
            SECTION_EXTRAS[section.extra ?? ""]?.(this, group.listEl);
            if (section.shownWhen) {
                const groupEl = group.listEl.closest(".setting-group");
                if (groupEl instanceof HTMLElement) {
                    this.handleElement(
                        groupEl,
                        visibleOnly(() =>
                            this.isConfiguredAs(section.shownWhen!.key as never, section.shownWhen!.is as never)
                        )
                    );
                }
            }
        }

        void yieldNextAnimationFrame().then(() => this.requestUpdate());
    }

}
