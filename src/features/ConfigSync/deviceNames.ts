/**
 * Which device names are already in use.
 *
 * Customisation Sync stores everything under a path built from the device name
 * — `ix:<device name>/<category>/<file>` — so the names in use are recoverable
 * from the database itself, without asking any device or adding a document.
 *
 * This matters because a duplicate name does not fail loudly. Two devices
 * sharing one write to the same documents, and each quietly replaces the
 * other's plugins and settings.
 */

import { ICXHeader } from "@/common/types.ts";
import type { LiveSyncCore } from "@/main.ts";

/**
 * The device name a Customisation Sync path belongs to, or empty if the path
 * is not one.
 *
 * The name is everything between the header and the first `/`. Binary entries
 * end `<file>%<basename>` rather than `.md`, but the device segment is the same
 * in both, which is why the split is on `/` alone.
 */
export function deviceNameFromCustomisationPath(path: string): string {
    if (!path.startsWith(ICXHeader)) return "";
    const rest = path.slice(ICXHeader.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) return "";
    return rest.slice(0, slash);
}

/**
 * Every device name present in the local replica of the database.
 *
 * Read locally, so it costs no network round trip and no credentials — but it
 * therefore knows only what has already replicated here. A device that has
 * never connected to this database is unknown to it, and a device that has
 * connected but never stored customisations has left no trace to find.
 */
export async function usedDeviceNames(core: LiveSyncCore): Promise<string[]> {
    const names = new Set<string>();
    try {
        // `localDatabaseDirect` rather than `localDatabase`: the latter throws
        // when the database is not open, and during setup it is not.
        const database = core.services.database.localDatabaseDirect;
        if (!database) return [];
        const entries = database.findEntries(ICXHeader, `${ICXHeader}\u{10ffff}`, {});
        for await (const entry of entries) {
            if (entry.deleted || entry._deleted) continue;
            const name = deviceNameFromCustomisationPath(entry.path ?? entry._id ?? "");
            if (name) names.add(name);
        }
    } catch {
        // The database may not be open yet — during setup it usually is not.
        // An advisory check that cannot run must not block the field.
        return [...names];
    }
    return [...names];
}
