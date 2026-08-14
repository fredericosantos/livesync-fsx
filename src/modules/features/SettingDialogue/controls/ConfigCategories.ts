/**
 * What travels, in five rows.
 *
 * There were eight, one per category the classifier knows about: app,
 * appearance, themes and snippets, hotkeys, active core plug-ins, core plug-in
 * settings, active community plug-ins, community plug-in settings. That is the
 * shape of the *implementation* — the categories a path is sorted into — and it
 * leaked onto the page as eight adjacent switches, three of which split a thing
 * nobody thinks of as two.
 *
 * Nobody wants a theme without its snippets, or a core plug-in switched on but
 * its settings left behind. So the pairs are one switch each, and the order is
 * the one a reader would look for rather than the one the classifier uses.
 *
 * The eight settings underneath are unchanged: they are the classifier's
 * vocabulary, they come from the shared settings type, and a device that syncs
 * with an older one must still agree with it about what a path means.
 */

import { LiveSyncSetting as Setting } from "@/modules/features/SettingDialogue/LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "@/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/settings";
import { renderPluginSyncTable } from "./PluginSyncTable.ts";
import { HiddenFileSync } from "@/features/HiddenFileSync/CmdHiddenFileSync.ts";

type CategoryKey = keyof ObsidianLiveSyncSettings;

export interface CategoryGroup {
    readonly name: string;
    readonly desc?: string;
    /** Every setting the row governs. All on, or all off. */
    readonly keys: readonly CategoryKey[];
}

export const GROUPS: readonly CategoryGroup[] = [
    {
        name: "Appearance",
        desc: "Theme, snippets, and how the app looks.",
        keys: ["syncConfigAppearance", "syncConfigThemesAndSnippets"],
    },
    { name: "Hotkeys", keys: ["syncConfigHotkeys"] },
    {
        name: "Core plugins",
        desc: "Which of Obsidian's own plugins are on, and how they are set up.",
        keys: ["syncConfigCorePluginList", "syncConfigCorePluginSettings"],
    },
    {
        name: "App settings",
        desc: "Editor, files and links, and the rest of Obsidian's own preferences.",
        keys: ["syncConfigApp"],
    },
    {
        name: "Community plugins",
        desc: "Which plugins are installed and enabled, and their settings. Choose them below.",
        keys: ["syncConfigCommunityPluginList", "syncConfigCommunityPluginSettings"],
    },
];

/**
 * A group is on only when everything under it is. A half-on group would be a
 * switch that does not describe its own state, so the first press of a
 * partially-on group turns the rest on rather than turning it off.
 */
export function isGroupOn(tab: ObsidianLiveSyncSettingTab, group: CategoryGroup): boolean {
    return group.keys.every((key) => tab.editingSettings[key] === true);
}

/**
 * Turning this on has to *do* something, which is the part that was missing.
 *
 * Storing `syncInternalFiles: true` only tells the file watcher to stop
 * ignoring the configuration folder from now on. The files already sitting in
 * it — every theme, hotkey and plug-in setting that existed before the switch
 * was flipped — are enumerated by a separate initialisation, and nothing was
 * calling it. So the switch went on, stayed on, and synchronised nothing until
 * one of those files happened to be edited.
 *
 * `MERGE` is the direction, and it is not offered as a choice: it keeps both
 * sides and takes the newer of each file, which is the answer that cannot lose
 * anything. "Take the server's" and "take mine" both discard a device's
 * settings, and the reader enabling a switch called "Sync app settings and
 * plugins" has not been told they are about to choose that.
 */
export function renderMasterSwitch(tab: ObsidianLiveSyncSettingTab, el: HTMLElement): void {
    new Setting(el)
        .setName("Sync app settings and plugins")
        .setDesc("Choose what travels below. Window layout always stays on the device it belongs to.")
        .addToggle((toggle) =>
            toggle.setValue(tab.editingSettings.syncInternalFiles === true).onChange(async (value) => {
                const hiddenFileSync = tab.core.addOns.find((addOn) => addOn instanceof HiddenFileSync);
                if (!hiddenFileSync) return;
                await hiddenFileSync.configureHiddenFileSync(value ? "MERGE" : "DISABLE_HIDDEN");
                tab.editingSettings.syncInternalFiles = tab.core.settings.syncInternalFiles;
                // Redrawn outright rather than nudged: everything below this
                // switch appears and disappears with it. `update()` rather than
                // `display()`, which the declarative page never calls.
                tab.update();
            })
        );
}

export function renderConfigCategories(tab: ObsidianLiveSyncSettingTab, el: HTMLElement): void {
    renderMasterSwitch(tab, el);
    if (!tab.editingSettings.syncInternalFiles) return;

    for (const group of GROUPS) {
        const setting = new Setting(el).setName(group.name);
        if (group.desc) setting.setDesc(group.desc);
        setting.addToggle((toggle) =>
            toggle.setValue(isGroupOn(tab, group)).onChange(async (value) => {
                for (const key of group.keys) {
                    (tab.editingSettings[key] as boolean) = value;
                }
                await tab.saveAllDirtySettings();
            })
        );
    }

    renderPluginSyncTable(tab, el);
}
