/**
 * What a configuration file is, said the way its owner would say it.
 *
 * A conflict used to be headed `Conflicted Setting` over the literal path
 * `.obsidian/plugins/obsidian-excalidraw-plugin/data.json`, which asks the
 * reader to do the translation the plug-in could have done: that is Excalidraw,
 * and `data.json` is simply where it keeps things.
 *
 * Kept apart from Obsidian so it can be tested; the caller supplies the plug-in
 * names it happens to know.
 */

import { classifyConfigPath } from "@/features/HiddenFileSync/configCategories.ts";

export interface ConfigFileDescription {
    /** Headline: what needs a decision. */
    readonly title: string;
    /** The file itself, for the line beneath. */
    readonly file: string;
}

/** Obsidian's own files, in the words its settings screen uses for them. */
const OWN_FILES = new Map<string, string>([
    ["app.json", "Obsidian settings"],
    ["appearance.json", "Appearance settings"],
    ["hotkeys.json", "Hotkeys"],
    ["community-plugins.json", "Which plugins are enabled"],
    ["core-plugins.json", "Which core plugins are enabled"],
    ["graph.json", "Graph view settings"],
    ["daily-notes.json", "Daily notes settings"],
    ["bookmarks.json", "Bookmarks"],
]);

/**
 * @param relativePath path relative to the configuration folder
 * @param pluginNames plugin id to display name, for whatever is installed here
 */
export function describeConfigFile(
    relativePath: string,
    pluginNames: ReadonlyMap<string, string> = new Map()
): ConfigFileDescription {
    const file = relativePath.split("/").pop() || relativePath;

    const own = OWN_FILES.get(relativePath);
    if (own) return { title: `${own} need a decision`, file };

    const pluginId = classifyConfigPath(relativePath)?.pluginId;
    if (pluginId) {
        // The id when the plug-in is not installed here — which is a real case,
        // since a conflict can arrive for a plug-in this device has never had.
        // It is still recognisable, and inventing a prettier name would be a
        // guess presented as a fact.
        const name = pluginNames.get(pluginId) ?? pluginId;
        return { title: `${name} settings need a decision`, file };
    }

    // Something under the configuration folder we have no name for. Say the
    // path rather than call it "a setting" and make the reader go looking.
    return { title: `${relativePath} needs a decision`, file };
}

/**
 * One side of a conflict, named.
 *
 * The device is optional and permanently so: revisions written before devices
 * were recorded do not have one, and there is no way to work it out afterwards.
 * When it is missing the time still identifies the version, which is what the
 * reader is really choosing between.
 */
export function describeRevision(device: string | undefined, mtime: number, now = Date.now()): string {
    const when = new Date(mtime);
    const sameDay = new Date(now).toDateString() === when.toDateString();
    const time = sameDay
        ? when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
        : when.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return device ? `${device} · ${time}` : `Unknown device · ${time}`;
}
