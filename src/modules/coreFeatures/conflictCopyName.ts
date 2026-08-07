/**
 * Naming the copy kept when two devices edited the same file and the edits
 * cannot be merged.
 *
 * The model, which is what Dropbox, iCloud and Obsidian Sync all settle on:
 * never lose either version, never block the user, never ask a question they
 * have no basis to answer. The losing version becomes an ordinary file sitting
 * beside the original, and the user finds out when they next open the original.
 *
 * The name has to survive being replicated back to every other device, so it
 * must be *deterministic*: the same conflict must produce the same name
 * everywhere, or three devices produce three copies of the same content.
 * That is why the device and the modification time are inputs rather than
 * "now" and "this device".
 */

export interface ConflictCopyInput {
    /** Path of the file the conflict is on, relative to the vault root. */
    readonly path: string;
    /** Device that produced the losing version, from `deviceAndVaultName`. */
    readonly device: string;
    /** Modification time of the losing version, in epoch milliseconds. */
    readonly modifiedAt: number;
    /** Paths already in the vault, so a second conflict does not overwrite the first. */
    readonly existingPaths?: ReadonlySet<string>;
}

function splitExtension(path: string): { stem: string; extension: string } {
    const slash = path.lastIndexOf("/");
    const dot = path.lastIndexOf(".");
    // A dot before the last slash belongs to a directory, and a leading dot is
    // a hidden file rather than an extension.
    if (dot <= slash + 1) return { stem: path, extension: "" };
    return { stem: path.slice(0, dot), extension: path.slice(dot) };
}

/** `2026-08-07 14:32` — sortable, unambiguous, no locale surprises. */
function formatStamp(modifiedAt: number): string {
    const d = new Date(modifiedAt);
    const pad = (n: number) => `${n}`.padStart(2, "0");
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}${pad(d.getMinutes())}`
    );
}

/**
 * Characters that are legal in a vault path but not in a file name on every
 * platform this vault might reach. A device called `A/B` would otherwise
 * silently create a folder.
 */
function sanitiseForName(value: string): string {
    return value
        .replace(/[/\\:*?"<>|#^[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function conflictCopyPath(input: ConflictCopyInput): string {
    const { stem, extension } = splitExtension(input.path);
    const device = sanitiseForName(input.device) || "another device";
    const base = `${stem} (from ${device}, ${formatStamp(input.modifiedAt)})`;

    const taken = input.existingPaths ?? new Set<string>();
    let candidate = `${base}${extension}`;
    // Two unmergeable conflicts on the same file, from the same device, within
    // the same minute is vanishingly rare — but overwriting the first copy
    // would be exactly the data loss this whole design exists to avoid.
    for (let n = 2; taken.has(candidate); n++) {
        candidate = `${base} ${n}${extension}`;
    }
    return candidate;
}

/** What to tell the user when they open a file that has a conflict copy. */
export function conflictCopyNotice(copyPath: string): string {
    const name = copyPath.slice(copyPath.lastIndexOf("/") + 1);
    return `This file was also edited on another device. That version is saved as "${name}".`;
}
