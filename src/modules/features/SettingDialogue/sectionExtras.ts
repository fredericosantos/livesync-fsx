/**
 * The parts of the page that are actions rather than settings.
 *
 * A catalogue section names one of these in its `extra` field; nothing else
 * appends to the page, so ordering and headings stay in the catalogue.
 */

import { $msg } from "@/common/translation";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import {
    EVENT_REQUEST_COPY_SETUP_URI,
    EVENT_REQUEST_OPEN_SETUP_URI,
    EVENT_REQUEST_SHOW_SETUP_QR,
    eventHub,
} from "@/common/events.ts";
import { renderPluginSyncTable } from "./controls/PluginSyncTable.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import { yieldNextAnimationFrame } from "octagonal-wheels/promises";
import { SetupManager } from "@/modules/features/SetupManager.ts";
import {
    createCoreSettingsAfterFullReset,
    createEditingSettingsAfterFullReset,
} from "@/serviceFeatures/setupObsidian/settingsReset.ts";

type Extra = (tab: ObsidianLiveSyncSettingTab, el: HTMLElement) => void;

/**
 * Leave the settings screen before opening a wizard.
 *
 * Obsidian 1.13 runs settings in a window of its own, and a dialogue opened
 * from it competes with that window for the foreground. A wizard is also not a
 * setting: once it starts, the page behind it is no longer the thing being
 * used. The yield lets the settings window finish closing first.
 */
async function leaveSettings(tab: ObsidianLiveSyncSettingTab): Promise<void> {
    tab.closeSetting();
    await yieldNextAnimationFrame();
}

/** Where this vault syncs, in the form a person would say it. */
function describeConnection(uri: string, database: string): string {
    if (!uri) return "No server configured.";
    try {
        return `${database || "vault"} on ${new URL(uri).host}`;
    } catch {
        return database || uri;
    }
}

const connect: Extra = (tab, el) => {
    // One decision, so one row. The three ways of reaching it are three
    // buttons on that row, not three cards competing for attention.
    new Setting(el)
        .setName("This vault is not syncing")
        .setDesc("Connect it to a CouchDB server. Nothing is uploaded or downloaded until you confirm.")
        .addButton((button) =>
            button.setButtonText("Paste link").onClick(async () => {
                await leaveSettings(tab);
                eventHub.emitEvent(EVENT_REQUEST_OPEN_SETUP_URI);
            })
        )
        .addButton((button) =>
            button.setButtonText("Scan QR").onClick(async () => {
                await leaveSettings(tab);
                await tab.core.getModule(SetupManager).onPromptQRCodeInstruction();
            })
        )
        .addButton((button) =>
            button
                .setButtonText("Set up")
                .setCta()
                .onClick(async () => {
                    await leaveSettings(tab);
                    await tab.core.getModule(SetupManager).startOnBoarding();
                })
        );
};

const server: Extra = (tab, el) => {
    new Setting(el)
        .setName("Server")
        .setDesc(describeConnection(tab.editingSettings.couchDB_URI, tab.editingSettings.couchDB_DBNAME))
        .addButton((button) =>
            button.setButtonText("Reconfigure").onClick(async () => {
                await leaveSettings(tab);
                await tab.core.getModule(SetupManager).startOnBoarding();
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
};

// Where a button used to open Customisation Sync's pane — a grid of devices,
// tri-state mode buttons, "Select All Shiny", "⚑ Select Flagged Shiny" and a
// maintenance mode — there is now a list of the plug-ins installed here, each
// with a checkbox. The pane existed because the model needed one: with a copy
// stored per device, something had to let you choose between them.
const pluginTable: Extra = (tab, el) => renderPluginSyncTable(tab, el);

const discard: Extra = (tab, el) => {
    new Setting(el)
        .setName($msg("obsidianLiveSyncSettingTab.nameDiscardSettings"))
        .setDesc("Forgets the server and deletes the local database. Your notes are not touched.")
        .addButton((button) =>
            button
                .setButtonText($msg("obsidianLiveSyncSettingTab.btnDiscard"))
                .setWarning()
                .onClick(async () => {
                    if (
                        (await tab.core.confirm.askYesNoDialog($msg("obsidianLiveSyncSettingTab.msgDiscardConfirmation"), {
                            defaultOption: "No",
                        })) != "yes"
                    ) {
                        return;
                    }
                    tab.editingSettings = createEditingSettingsAfterFullReset(tab.editingSettings);
                    await tab.saveAllDirtySettings();
                    tab.core.settings = createCoreSettingsAfterFullReset();
                    await tab.services.setting.saveSettingData();
                    await tab.services.database.resetDatabase();
                    tab.services.appLifecycle.askRestart();
                })
        );
};

export const SECTION_EXTRAS: Record<string, Extra> = {
    connect,
    server,
    "plugin-table": pluginTable,
    discard,
};
