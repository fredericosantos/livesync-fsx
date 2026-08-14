/**
 * The `ignoreFiles` setting is stored as one comma-separated string, and is
 * read back that way by the replication modules. The list editor works in
 * arrays, so the conversion happens here and nowhere else.
 */

export function parseIgnoreFileNames(stored: string): string[] {
    return stored
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
}

export function serialiseIgnoreFileNames(names: readonly string[]): string {
    // No space after the comma: the stored form is compared against remote
    // tweak values, and a whitespace difference would read as a mismatch.
    return names
        .map((name) => name.trim())
        .filter((name) => name !== "")
        .join(",");
}
