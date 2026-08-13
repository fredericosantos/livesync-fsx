/**
 * Which community plug-ins travel between devices.
 *
 * This is the one thing here Obsidian's own Sync does not offer: it has a
 * single switch for all community plug-ins and their settings, so a plug-in you
 * want only on the desktop obliges you to turn the whole category off. Here it
 * is one switch per plug-in, over a list of what is installed.
 *
 * The list is of what is installed *on this device*, which is the only list a
 * device can honestly show. A plug-in installed elsewhere and not yet arrived
 * here has no row, so the answer for it is the one stated once at the foot of
 * the list rather than guessed per plug-in.
 */

import { LiveSyncSetting as Setting } from "@/modules/features/SettingDialogue/LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "@/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import { getObsidianCommunityPluginManager } from "@/common/obsidianCommunityPlugins.ts";
import { isPluginSelected } from "@/features/HiddenFileSync/configCategories.ts";

/**
 * This plug-in never carries itself: each device holds its own credentials, and
 * a plug-in that replaced its own code mid-replication would be replacing the
 * thing doing the replicating.
 *
 * Read from the manifest rather than written down. It was written down, as the
 * *upstream* id, so the row this is meant to suppress appeared anyway.
 */
function ownPluginId(tab: ObsidianLiveSyncSettingTab): string {
    return tab.plugin.manifest.id;
}

interface PluginRow {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
}

function installedPlugins(tab: ObsidianLiveSyncSettingTab): PluginRow[] {
    let manager;
    try {
        manager = getObsidianCommunityPluginManager(tab.plugin.app);
    } catch {
        // A future Obsidian could stop exposing this. Saying so is better than
        // an empty list that looks like "none installed".
        return [];
    }
    const self = ownPluginId(tab);
    return manager.manifests
        .filter((manifest) => manifest.id !== self)
        .map((manifest) => ({
            id: manifest.id,
            name: manifest.name,
            enabled: manager.enabledPlugins.has(manifest.id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function renderPluginSyncTable(tab: ObsidianLiveSyncSettingTab, el: HTMLElement): void {
    const container = el.createDiv({ cls: "lsfsx-plugins" });

    const draw = () => {
        container.empty();

        // Only the master switch hides this. It used to be hidden by the
        // community-plugin category as well, which is the switch this list is
        // supposed to replace: turning that off to exclude one plug-in removed
        // the very control that could have excluded it.
        if (!tab.editingSettings.syncInternalFiles) return;

        const rows = installedPlugins(tab);

        // Every plug-in, present and future, in one switch. Off means the list
        // below decides; on means it does not have to be maintained at all.
        const all = rows.length > 0 && rows.every((row) => isPluginSelected(tab.editingSettings, row.id));
        new Setting(container)
            .setName("All plugins")
            .setDesc("Sync every plugin below, and any installed later.")
            .addToggle((toggle) =>
                toggle.setValue(all && tab.editingSettings.syncConfigNewPlugins !== false).onChange(async (value) => {
                    tab.editingSettings.syncConfigNewPlugins = value;
                    // The per-plugin exceptions are cleared either way: after
                    // "all on" there is nothing to except, and after "all off"
                    // a stale exception would silently sync one plug-in.
                    tab.editingSettings.syncConfigPluginSelection = value
                        ? {}
                        : Object.fromEntries(rows.map((row) => [row.id, false]));
                    await tab.saveAllDirtySettings();
                    draw();
                })
            );

        if (rows.length === 0) {
            container.createDiv({
                cls: "lsfsx-plugins__empty",
                text: "No community plugins are installed on this device.",
            });
            return;
        }

        // Saved through the dirty-key sweep rather than by name: the selection
        // is a record, and `saveSettings` takes only the scalar setting keys.
        const commit = async (id: string, selected: boolean) => {
            tab.editingSettings.syncConfigPluginSelection = {
                ...tab.editingSettings.syncConfigPluginSelection,
                [id]: selected,
            };
            await tab.saveAllDirtySettings();
        };

        // A `Setting` per plug-in, so these rows are the same control as every
        // other switch on the page. They were checkboxes in a hand-built list,
        // which made the one part of this page that is not Obsidian's own idea
        // look like it belonged to a different program.
        for (const row of rows) {
            const setting = new Setting(container).setName(row.name);
            // Obsidian's own list dims what is installed but switched off, and
            // a reader comparing the two lists should not have to work out why
            // one has more entries.
            if (!row.enabled) {
                setting.setDesc("Disabled here");
                setting.settingEl.addClass("lsfsx-plugins__row--disabled");
            }
            setting.addToggle((toggle) =>
                toggle
                    .setValue(isPluginSelected(tab.editingSettings, row.id))
                    .onChange((value) => void commit(row.id, value))
            );
        }
    };

    draw();
    tab.addOnSaved("syncInternalFiles", () => draw());
    tab.addOnSaved("syncConfigNewPlugins", () => draw());
}
