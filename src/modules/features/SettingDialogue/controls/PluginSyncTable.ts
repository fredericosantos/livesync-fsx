/**
 * Which community plug-ins travel between devices.
 *
 * This is the one thing here that Obsidian's own Sync does not offer: it has a
 * single switch for all community plug-ins and their settings, so a plug-in you
 * want only on the desktop obliges you to turn the whole category off. The
 * table below is that switch, per plug-in.
 *
 * It lists what is *installed on this device*, which is the only list a device
 * can honestly show. A plug-in installed elsewhere and not yet arrived here has
 * no row, so the answer for it is the one stated once at the foot of the table
 * rather than guessed per plug-in.
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
        // A future Obsidian could stop exposing this. The categories above still
        // work; only the per-plug-in refinement is unavailable, and saying so is
        // better than showing an empty table that looks like "none installed".
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

        if (!tab.editingSettings.syncInternalFiles || !tab.editingSettings.syncConfigCommunityPluginSettings) {
            return;
        }

        const rows = installedPlugins(tab);
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

        const head = container.createDiv({ cls: "lsfsx-plugins__head" });
        head.createSpan({ text: "Plugin" });
        head.createSpan({ cls: "lsfsx-plugins__count", text: `${rows.length}` });

        for (const row of rows) {
            const line = container.createDiv({ cls: "lsfsx-plugins__row" });
            const label = line.createEl("label", { cls: "lsfsx-plugins__label" });
            const box = label.createEl("input", { type: "checkbox", cls: "lsfsx-plugins__check" });
            box.checked = isPluginSelected(tab.editingSettings, row.id);
            label.createSpan({ cls: "lsfsx-plugins__name", text: row.name });
            // Obsidian's own list dims what is installed but switched off, and a
            // reader comparing the two lists should not have to work out why one
            // has more entries.
            if (!row.enabled) {
                line.addClass("lsfsx-plugins__row--disabled");
                label.createSpan({ cls: "lsfsx-plugins__state", text: "Disabled here" });
            }
            box.addEventListener("change", () => {
                void commit(row.id, box.checked);
            });
        }

        new Setting(container)
            .setName("Plugins installed later")
            .setDesc("Applies to plugins that appear on another device and have no row above yet.")
            .addToggle((toggle) => {
                toggle.setValue(tab.editingSettings.syncConfigNewPlugins ?? true).onChange(async (value) => {
                    tab.editingSettings.syncConfigNewPlugins = value;
                    await tab.saveSettings(["syncConfigNewPlugins"]);
                    draw();
                });
            });
    };

    draw();
    tab.addOnSaved("syncInternalFiles", () => draw());
    tab.addOnSaved("syncConfigCommunityPluginSettings", () => draw());
}
