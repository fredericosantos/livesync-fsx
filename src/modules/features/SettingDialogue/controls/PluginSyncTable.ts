/**
 * Which community plug-ins travel between devices.
 *
 * This is the one thing here Obsidian's own Sync does not offer: it has a
 * single switch for all community plug-ins and their settings, so a plug-in you
 * want only on the desktop obliges you to turn the whole category off. Here it
 * is one switch per plug-in, over a list of what is installed.
 *
 * The list is of what the *vault* has, not what this device has. Those are the
 * same thing on the machine you set up first and nowhere else: a device that
 * has only just joined holds almost nothing, and building the list from its own
 * `app.plugins.manifests` offered a choice of one plug-in on the very screen
 * that decides what the other twenty do. So the installed manifests are merged
 * with the plug-ins the database already knows about, and a plug-in that has
 * not arrived here yet says so rather than being absent.
 */

import { LiveSyncSetting as Setting } from "@/modules/features/SettingDialogue/LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "@/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import { getObsidianCommunityPluginManager } from "@/common/obsidianCommunityPlugins.ts";
import { isPluginSelected } from "@/features/HiddenFileSync/configCategories.ts";
import { HiddenFileSync } from "@/features/HiddenFileSync/CmdHiddenFileSync.ts";

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
    /** Unpacked on this device. */
    readonly installed: boolean;
    /** Installed here, and switched on here. */
    readonly enabled: boolean;
}

function installedPlugins(tab: ObsidianLiveSyncSettingTab): PluginRow[] {
    let manager;
    try {
        manager = getObsidianCommunityPluginManager(tab.plugin.app);
    } catch {
        // A future Obsidian could stop exposing this. The database list below
        // still stands on its own, which is the point of having two sources.
        return [];
    }
    const self = ownPluginId(tab);
    return manager.manifests
        .filter((manifest) => manifest.id !== self)
        .map((manifest) => ({
            id: manifest.id,
            name: manifest.name,
            installed: true,
            enabled: manager.enabledPlugins.has(manifest.id),
        }));
}

/**
 * The installed plug-ins, plus every other one the database has heard of.
 *
 * A plug-in known only to the database has no manifest here, so there is no
 * name to show and its folder name is used instead. That is what the id is —
 * `obsidian-excalidraw-plugin` rather than "Excalidraw" — and it is still
 * recognisable enough to decide about, which a missing row is not.
 */
function mergeRows(installed: PluginRow[], knownIds: ReadonlySet<string>, self: string): PluginRow[] {
    const rows = [...installed];
    const seen = new Set(installed.map((row) => row.id));
    for (const id of knownIds) {
        if (seen.has(id) || id === self) continue;
        rows.push({ id, name: id, installed: false, enabled: false });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The name, and — only when there is one — the state, beside it.
 *
 * A fragment rather than two calls, because Obsidian's `Setting` has one slot
 * for the name and one for a description, and the description is a second line.
 * The state of a plug-in is an adjective on its name, not a sentence about it.
 */
function nameOf(row: PluginRow): DocumentFragment {
    const fragment = createFragment();
    fragment.appendText(row.name);
    const state = !row.installed ? "not installed" : !row.enabled ? "disabled" : undefined;
    if (state) {
        fragment.appendText(" ");
        fragment.createSpan({ cls: "lsfsx-plugins__tag", text: `(${state})` });
    }
    return fragment;
}

function pluginIdsInDatabase(tab: ObsidianLiveSyncSettingTab): Promise<Set<string>> {
    const hiddenFileSync = tab.core.addOns.find((addOn) => addOn instanceof HiddenFileSync);
    return hiddenFileSync ? hiddenFileSync.getPluginIdsInDatabase() : Promise.resolve(new Set<string>());
}

export function renderPluginSyncTable(tab: ObsidianLiveSyncSettingTab, el: HTMLElement): void {
    const container = el.createDiv({ cls: "lsfsx-plugins" });

    // Read once when the pane opens, then held: the table is drawn again on
    // every toggle, and re-scanning the database each time would make a switch
    // that answers instantly answer after a pause instead.
    let knownIds: ReadonlySet<string> = new Set<string>();

    const draw = () => {
        container.empty();

        // Only the master switch hides this. It used to be hidden by the
        // community-plugin category as well, which is the switch this list is
        // supposed to replace: turning that off to exclude one plug-in removed
        // the very control that could have excluded it.
        if (!tab.editingSettings.syncInternalFiles) return;

        const rows = mergeRows(installedPlugins(tab), knownIds, ownPluginId(tab));

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
                text: "No community plugins yet, here or on the server.",
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
            const setting = new Setting(container).setName(nameOf(row));
            setting.addToggle((toggle) =>
                toggle
                    .setValue(isPluginSelected(tab.editingSettings, row.id))
                    .onChange((value) => void commit(row.id, value))
            );
        }
    };

    draw();
    // Drawn twice: once with what this device knows, so the pane is never
    // blank while a database scan runs, and again when the scan lands.
    void pluginIdsInDatabase(tab).then((ids) => {
        knownIds = ids;
        draw();
    });
    tab.addOnSaved("syncInternalFiles", () => draw());
    tab.addOnSaved("syncConfigNewPlugins", () => draw());
}
