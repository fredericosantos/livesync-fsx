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
import { renderConfigCategories } from "./controls/ConfigCategories.ts";
import { renderFileSizeLimit } from "./controls/FileSizeLimit.ts";
import { renderSyncStatusLine } from "./controls/SyncStatusLine.ts";
import { HiddenFileSync } from "@/features/HiddenFileSync/CmdHiddenFileSync.ts";
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

/**
 * Where this vault syncs: two values and the word between them.
 *
 * As one run of grey text, "notes on db.example.com" reads as a sentence, and
 * the two things in it that are actually *values* — the ones you would check
 * against another device, or read aloud to someone — are indistinguishable from
 * the preposition joining them. Setting each in a chip says which parts are
 * data.
 */
function describeConnection(el: HTMLElement, uri: string, database: string): void {
    if (!uri) {
        el.setText("No server configured.");
        return;
    }
    let host: string;
    try {
        host = new URL(uri).host;
    } catch {
        // Not a URL we can read: show what is stored rather than nothing, but
        // do not dress a broken value up as two tidy facts.
        el.setText(database || uri);
        return;
    }
    el.createSpan({ cls: "lsfsx-chip", text: database || "vault" });
    el.createSpan({ cls: "lsfsx-chip__joiner", text: "on" });
    el.createSpan({ cls: "lsfsx-chip", text: host });
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
    const connection = new Setting(el).setName("Server").addButton((button) =>
        button.setButtonText("Reconfigure").onClick(async () => {
            await leaveSettings(tab);
            await tab.core.getModule(SetupManager).startOnBoarding();
        })
    );
    describeConnection(connection.descEl, tab.editingSettings.couchDB_URI, tab.editingSettings.couchDB_DBNAME);
    // Inside the row's own description, under the two chips: it is a fact about
    // that connection, not a section of its own. Set smaller than the chips for
    // the same reason — where the vault syncs is the heading, how it is getting
    // on is the footnote.
    renderSyncStatusLine(tab, connection.descEl);

    // This device already has a name — it gives itself one at first launch, so
    // nothing here is ever blank and nothing has to be filled in. It is
    // editable because the name is now written onto every document this device
    // saves, and appears as one side of a conflict: "Fred's MacBook" is a
    // useful thing to be asked to choose between, `DESKTOP-4KQ2P1` is not.
    //
    // Device-local, never synchronised: the whole point is to tell this device
    // apart from the others.
    new Setting(el)
        .setName("This device is called")
        .setDesc("Used to say which device changed a file when two of them disagree.")
        .addText((text) =>
            text.setValue(tab.services.setting.getDeviceAndVaultName()).onChange((value) => {
                const name = value.trim();
                // An empty box means "no name", not a device called "". The
                // rename takes effect on the next document written; revisions
                // already saved keep the name they were saved under, because
                // that is who wrote them.
                tab.services.setting.setDeviceAndVaultName(name);
                tab.services.setting.saveDeviceAndVaultName();
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
// maintenance mode — there are now five switches and a list of the plug-ins
// installed here, each with a checkbox. The pane existed because the model
// needed one: with a copy stored per device, something had to let you choose
// between them.
const configCategories: Extra = (tab, el) => renderConfigCategories(tab, el);

/**
 * Make the server match this device.
 *
 * Everything else in this plug-in merges: two devices that disagree end up with
 * both versions, and the reader picks. That is right almost always and useless
 * in the one case where a device is simply *correct* — a half-finished fetch, a
 * server rebuilt from the wrong machine, a vault restored from backup. Without
 * this the only route back was to discard the connection and set it up again.
 *
 * The confirmation names the real hazard, which is not the server. Replacing it
 * leaves every *other* device holding a database that no longer matches, and
 * each must download the vault again before it syncs; anything a device had
 * changed but not yet uploaded is gone. "This cannot be undone" would not have
 * told anyone that.
 */
const replaceServer: Extra = (tab, el) => {
    new Setting(el)
        .setName("Replace the server with this vault")
        .setDesc("Use when this device is right and the server is not. Other devices must download the vault again.")
        .addButton((button) =>
            button
                .setButtonText("Replace")
                .setWarning()
                .onClick(async () => {
                    const confirmed = await tab.core.confirm.askYesNoDialog(
                        "Everything on the server will be deleted and replaced with the files on this device.\n\n" +
                            "Your other devices will have to download the vault again. Anything changed on them and " +
                            "not yet uploaded will be lost.\n\nReplace the server?",
                        { defaultOption: "No" }
                    );
                    if (confirmed !== "yes") return;
                    // Read before the rebuild, which switches it off: this is a
                    // preference the reader set, not a casualty of the repair.
                    const wasSyncingConfig = tab.core.settings.syncInternalFiles === true;
                    await leaveSettings(tab);
                    await tab.core.rebuilder.$rebuildRemote();
                    if (wasSyncingConfig) {
                        // MERGE re-enables it *and* re-enumerates the folder, so
                        // the settings land on the freshly emptied server rather
                        // than waiting for someone to edit a hotkey.
                        const hiddenFileSync = tab.core.addOns.find((addOn) => addOn instanceof HiddenFileSync);
                        await hiddenFileSync?.configureHiddenFileSync("MERGE");
                    }
                })
        );
};

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
                        (await tab.core.confirm.askYesNoDialog(
                            $msg("obsidianLiveSyncSettingTab.msgDiscardConfirmation"),
                            {
                                defaultOption: "No",
                            }
                        )) != "yes"
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
    "replace-server": replaceServer,
    "config-categories": configCategories,
    "file-size-limit": (tab, el) => renderFileSizeLimit(tab, el),
    discard,
};
