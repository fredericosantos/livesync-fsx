import { $msg } from "@/common/translation";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import {
    EVENT_REQUEST_COPY_SETUP_URI,
    EVENT_REQUEST_OPEN_SETUP_URI,
    EVENT_REQUEST_SHOW_SETUP_QR,
    eventHub,
} from "@/common/events.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
import { SetupManager } from "@/modules/features/SetupManager.ts";
import { TIERS, TIER_DESCRIPTIONS, TIER_LABELS, modeFlagsForTier, type SettingTier } from "./settingsCatalogue.ts";
import {
    createCoreSettingsAfterFullReset,
    createEditingSettingsAfterFullReset,
} from "@/serviceFeatures/setupObsidian/settingsReset.ts";

/** Where this vault syncs, in the form a person would say it. */
function describeConnection(uri: string, database: string): string {
    if (!uri) return "No server configured.";
    try {
        return `${database || "vault"} on ${new URL(uri).host}`;
    } catch {
        return database || uri;
    }
}

export function paneSetup(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    const unconfigured = visibleOnly(() => !this.isConfiguredAs("isConfigured", true));
    const configured = visibleOnly(() => this.isConfiguredAs("isConfigured", true));

    // An unconfigured vault has exactly one decision, so it gets exactly one
    // row. The three ways of reaching that decision are three buttons on it,
    // not three cards competing for the same attention.
    void addPanel(paneEl, "", undefined, unconfigured).then((el) => {
        new Setting(el)
            .setName("This vault is not syncing")
            .setDesc("Connect it to a CouchDB server. Nothing is uploaded or downloaded until you confirm.")
            .addButton((button) =>
                button.setButtonText("Paste link").onClick(() => {
                    this.closeSetting();
                    eventHub.emitEvent(EVENT_REQUEST_OPEN_SETUP_URI);
                })
            )
            .addButton((button) =>
                button.setButtonText("Scan QR").onClick(async () => {
                    await this.core.getModule(SetupManager).onPromptQRCodeInstruction();
                })
            )
            .addButton((button) =>
                button
                    .setButtonText("Set up")
                    .setCta()
                    .onClick(async () => {
                        await this.core.getModule(SetupManager).startOnBoarding();
                    })
            );
    });

    void addPanel(paneEl, "", undefined, configured).then((el) => {
        new Setting(el)
            .setName("Server")
            .setDesc(describeConnection(this.editingSettings.couchDB_URI, this.editingSettings.couchDB_DBNAME))
            .addButton((button) =>
                button.setButtonText("Reconfigure").onClick(async () => {
                    await this.core.getModule(SetupManager).startOnBoarding();
                })
            );

        new Setting(el)
            .setName("Add another device")
            .setDesc("Send this connection to a second device instead of typing it there.")
            .addButton((button) =>
                button.setButtonText("Copy link").onClick(() => eventHub.emitEvent(EVENT_REQUEST_COPY_SETUP_URI))
            )
            .addButton((button) =>
                button.setButtonText("Show QR").onClick(() => eventHub.emitEvent(EVENT_REQUEST_SHOW_SETUP_QR))
            );
    });
}

/**
 * The end of the page: how much of it to show, and how to throw it all away.
 * Rendered last so that a destructive action is never above something ordinary.
 */
export function paneSetupFooter(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel }: PageFunctions
): void {
    void addPanel(paneEl, "").then((el) => {
        // Upstream had three independent switches — Advanced, Power user, Edge
        // case — which the reader had to combine correctly to find a setting.
        // One ordered question replaces them; the three booleans are still what
        // gets stored, so nothing has to migrate.
        const current = this.viewingTier;
        new Setting(el)
            .setName("Settings shown")
            .setDesc(TIER_DESCRIPTIONS[current])
            .addDropdown((dropdown) => {
                for (const tier of TIERS) dropdown.addOption(tier, TIER_LABELS[tier]);
                dropdown.setValue(current).onChange(async (value) => {
                    this.editingSettings = { ...this.editingSettings, ...modeFlagsForTier(value as SettingTier) };
                    await this.saveAllDirtySettings();
                    this.display();
                });
            });

        new Setting(el)
            .setName($msg("obsidianLiveSyncSettingTab.nameDiscardSettings"))
            .setDesc("Forgets the server and deletes the local database. Your notes are not touched.")
            .addOnUpdate(visibleOnly(() => this.isConfiguredAs("isConfigured", true)))
            .addButton((button) =>
                button
                    .setButtonText($msg("obsidianLiveSyncSettingTab.btnDiscard"))
                    .setWarning()
                    .onClick(async () => {
                        if (
                            (await this.core.confirm.askYesNoDialog(
                                $msg("obsidianLiveSyncSettingTab.msgDiscardConfirmation"),
                                { defaultOption: "No" }
                            )) != "yes"
                        ) {
                            return;
                        }
                        this.editingSettings = createEditingSettingsAfterFullReset(this.editingSettings);
                        await this.saveAllDirtySettings();
                        this.core.settings = createCoreSettingsAfterFullReset();
                        await this.services.setting.saveSettingData();
                        await this.services.database.resetDatabase();
                        this.services.appLifecycle.askRestart();
                    })
            );
    });
}
