/**
 * The rows that are not a switch and a label.
 *
 * Each one is declared with a real name and description — search indexes those,
 * so a size-chip row is as findable as a toggle — and drawn by the renderer it
 * already had. `render` receives the `Setting` Obsidian made for the row and
 * the `SettingGroup` it sits in; controls that *are* one row populate the
 * `Setting`, and controls that are a block of their own (the plug-in list, the
 * chips) draw into the group and hide the row they were given.
 */

import type { SettingDefinitionRender } from "obsidian";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { SettingKey } from "./settingsCatalogue.ts";
import { renderPassphrase } from "./controls/Passphrase.ts";
import { renderIgnoreFileList } from "./controls/IgnoreFileList.ts";
import { renderFileSizeLimit } from "./controls/FileSizeLimit.ts";
import { renderConfigCategories } from "./controls/ConfigCategories.ts";
import { renderSyncStatusLine } from "./controls/SyncStatusLine.ts";
import { visibleOnly } from "./SettingPane.ts";
import { $msg } from "@/common/translation";
import {
    EVENT_REQUEST_COPY_SETUP_URI,
    EVENT_REQUEST_OPEN_SETUP_URI,
    EVENT_REQUEST_SHOW_SETUP_QR,
    eventHub,
} from "@/common/events.ts";
import { SetupManager } from "@/modules/features/SetupManager.ts";
import { HiddenFileSync } from "@/features/HiddenFileSync/CmdHiddenFileSync.ts";
import { yieldNextAnimationFrame } from "octagonal-wheels/promises";
import {
    createCoreSettingsAfterFullReset,
    createEditingSettingsAfterFullReset,
} from "@/serviceFeatures/setupObsidian/settingsReset.ts";
// Obsidian's own `Setting`, not the plug-in's subclass: `render` is handed
// the row Obsidian made, so the auto-wiring helpers are not on it.
import type { Setting, SettingGroup } from "obsidian";

type KeyDefinition = (tab: ObsidianLiveSyncSettingTab) => SettingDefinitionRender;
type ExtraDefinitions = (tab: ObsidianLiveSyncSettingTab) => SettingDefinitionRender[];

/**
 * A row whose content is a block rather than a control.
 *
 * The `Setting` Obsidian created is emptied and hidden, and the renderer draws
 * into the group instead. The row still exists as a definition, which is what
 * keeps it in the search index.
 */
function block(
    name: string,
    desc: string,
    draw: (tab: ObsidianLiveSyncSettingTab, el: HTMLElement) => void,
    tab: ObsidianLiveSyncSettingTab
): SettingDefinitionRender {
    return {
        name,
        desc,
        render: (setting: Setting, group: SettingGroup) => {
            setting.settingEl.addClass("lsfsx-hidden");
            draw(tab, group.listEl);
        },
    };
}

async function leaveSettings(tab: ObsidianLiveSyncSettingTab): Promise<void> {
    tab.closeSetting();
    await yieldNextAnimationFrame();
}

/**
 * Where this vault syncs: two values and the word between them.
 *
 * As one run of grey text, "notes on db.example.com" reads as a sentence, and
 * the two things in it that are actually *values* are indistinguishable from
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
        el.setText(database || uri);
        return;
    }
    el.createSpan({ cls: "lsfsx-chip", text: database || "vault" });
    el.createSpan({ cls: "lsfsx-chip__joiner", text: "on" });
    el.createSpan({ cls: "lsfsx-chip", text: host });
}

const connect: ExtraDefinitions = (tab) => [
    {
        // One decision, so one row. The three ways of reaching it are three
        // buttons on that row, not three cards competing for attention.
        name: "This vault is not syncing",
        desc: "Connect it to a CouchDB server. Nothing is uploaded or downloaded until you confirm.",
        render: (setting) => {
            setting
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
        },
    },
];

const server: ExtraDefinitions = (tab) => [
    {
        name: "Server",
        desc: "Where this vault syncs, and how it is getting on.",
        render: (setting) => {
            // Before "Reconfigure", because it is the thing you came here to
            // press. Continuous replication normally makes it unnecessary, so
            // it is the button for when it has not: a stalled device, a server
            // that has just come back, a fresh setup that has not caught up.
            setting.addButton((button) =>
                button.setButtonText("Sync now").onClick(async () => {
                    button.setDisabled(true);
                    button.setButtonText("Syncing…");
                    try {
                        await tab.services.replication.replicate();
                    } finally {
                        // The status line above says how it went; this button
                        // only has to stop claiming to be busy.
                        button.setDisabled(false);
                        button.setButtonText("Sync now");
                    }
                })
            );
            setting.addButton((button) =>
                button.setButtonText("Reconfigure").onClick(async () => {
                    await leaveSettings(tab);
                    await tab.core.getModule(SetupManager).startOnBoarding();
                })
            );
            setting.descEl.empty();
            describeConnection(setting.descEl, tab.editingSettings.couchDB_URI, tab.editingSettings.couchDB_DBNAME);
            renderSyncStatusLine(tab, setting.descEl);
        },
    },
    {
        // Editable because the name is written onto every document this device
        // saves and shown as one side of a conflict: "Fred's MacBook" is a
        // useful thing to choose between, `DESKTOP-4KQ2P1` is not. Device-local
        // and never synchronised — the point is to tell this device from others.
        name: "This device is called",
        desc: "Used to say which device changed a file when two of them disagree.",
        render: (setting) => {
            setting.addText((text) =>
                text.setValue(tab.services.setting.getDeviceAndVaultName()).onChange((value) => {
                    // An empty box means "no name", not a device called "". The
                    // rename takes effect on the next document written.
                    tab.services.setting.setDeviceAndVaultName(value.trim());
                    tab.services.setting.saveDeviceAndVaultName();
                })
            );
        },
    },
    {
        name: "Add another device",
        desc: "Send this connection to a second device instead of typing it there.",
        render: (setting) => {
            setting
                .addButton((button) =>
                    button.setButtonText("Copy link").onClick(() => eventHub.emitEvent(EVENT_REQUEST_COPY_SETUP_URI))
                )
                .addButton((button) =>
                    button.setButtonText("Show QR").onClick(() => eventHub.emitEvent(EVENT_REQUEST_SHOW_SETUP_QR))
                );
        },
    },
];

const configCategories: ExtraDefinitions = (tab) => [
    block(
        "Sync app settings and plugins",
        "Appearance, hotkeys, core plugins, app settings, and which community plugins travel between devices.",
        renderConfigCategories,
        tab
    ),
];

const fileSizeLimit: ExtraDefinitions = (tab) => [
    block("Do not sync files over a specified size", "Skip anything larger than the size you choose.", renderFileSizeLimit, tab),
];

const replaceServer: ExtraDefinitions = (tab) => [
    {
        name: "Replace the server with this vault",
        desc: "Use when this device is right and the server is not. Other devices must download the vault again.",
        render: (setting) => {
            setting.addButton((button) =>
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
                        // Read before the rebuild, which switches it off: this
                        // is a preference the reader set, not a casualty of the
                        // repair.
                        const wasSyncingConfig = tab.core.settings.syncInternalFiles === true;
                        await leaveSettings(tab);
                        await tab.core.rebuilder.$rebuildRemote();
                        if (wasSyncingConfig) {
                            const hiddenFileSync = tab.core.addOns.find((addOn) => addOn instanceof HiddenFileSync);
                            await hiddenFileSync?.configureHiddenFileSync("MERGE");
                        }
                    })
            );
        },
    },
];

const discard: ExtraDefinitions = (tab) => [
    {
        name: $msg("obsidianLiveSyncSettingTab.nameDiscardSettings"),
        desc: "Forgets the server and deletes the local database. Your notes are not touched.",
        render: (setting) => {
            setting.addButton((button) =>
                button
                    .setButtonText($msg("obsidianLiveSyncSettingTab.btnDiscard"))
                    .setWarning()
                    .onClick(async () => {
                        const confirmed = await tab.core.confirm.askYesNoDialog(
                            $msg("obsidianLiveSyncSettingTab.msgDiscardConfirmation"),
                            { defaultOption: "No" }
                        );
                        if (confirmed != "yes") return;
                        tab.editingSettings = createEditingSettingsAfterFullReset(tab.editingSettings);
                        await tab.saveAllDirtySettings();
                        tab.core.settings = createCoreSettingsAfterFullReset();
                        await tab.services.setting.saveSettingData();
                        await tab.services.database.resetDatabase();
                        tab.services.appLifecycle.askRestart();
                    })
            );
        },
    },
];

export const SECTION_DEFINITIONS: {
    readonly keys: Partial<Record<SettingKey, KeyDefinition>>;
    readonly extras: Record<string, ExtraDefinitions>;
} = {
    keys: {
        // Meaningless while encryption is off, so it is not shown then. A
        // disabled field would still invite the reader to wonder what it is for.
        passphrase: (tab) => ({
            name: "Passphrase",
            desc: "The passphrase every device must share.",
            visible: () => tab.isConfiguredAs("encrypt", true),
            render: (setting: Setting, group: SettingGroup) => {
                setting.settingEl.addClass("lsfsx-hidden");
                renderPassphrase(tab, group.listEl, visibleOnly(() => tab.isConfiguredAs("encrypt", true)));
            },
        }),
        ignoreFiles: (tab) => ({
            name: "Ignore files",
            desc: "The gitignore-style files consulted when deciding what to skip.",
            render: (setting: Setting, group: SettingGroup) => {
                setting.settingEl.addClass("lsfsx-hidden");
                renderIgnoreFileList(tab, group.listEl);
            },
        }),
    },
    extras: {
        connect,
        server,
        "config-categories": configCategories,
        "file-size-limit": fileSizeLimit,
        "replace-server": replaceServer,
        discard,
    },
};
