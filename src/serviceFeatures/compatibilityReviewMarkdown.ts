import type { CompatibilityPause, CompatibilityPauseReason } from "@/common/databaseCompatibility.ts";

/**
 * One sentence: what to do.
 *
 * This was three paragraphs. The first announced that "remote synchronisation
 * is paused on this device because its compatibility state requires attention",
 * which is the title restated in the passive voice. The third promised that
 * "your automatic synchronisation preferences have not been changed" and that
 * closing the dialogue keeps synchronisation paused — reassurance about a thing
 * the reader had not yet thought to worry about, and a description of what a
 * Close button does.
 *
 * What was left after removing both was the only line that told anyone anything.
 */
export function compatibilityReviewSummaryMarkdown(pause: CompatibilityPause): string {
    // "Self-hosted LiveSync" is upstream's plug-in, not this one. A reader told
    // to update it would go looking for something they do not have installed.
    return !pause.resumable
        ? "This version is too old to read what is on the server. Update this plugin to continue."
        : "Update this plugin on every device that uses this server, then resume.";
}

function reasonMarkdown(reason: CompatibilityPauseReason): string {
    if (reason.source === "database-version") {
        if (reason.state === "upgrade") {
            return `- The last acknowledged internal database version was **${reason.acknowledgedVersion}** and this installation uses **${reason.currentVersion}**.`;
        }
        if (reason.state === "downgrade") {
            return `- This installation uses internal database version **${reason.currentVersion}**, but this device previously acknowledged newer version **${reason.acknowledgedVersion}**. An older installation must not resume synchronisation.`;
        }
        if (reason.state === "missing") {
            return `- No previously acknowledged internal database version was found for this existing Vault. This can happen when a Vault is copied or restored, or when it is opened with a new Obsidian profile. This installation uses version **${reason.currentVersion}**. An empty local database does not mean that it is safe to resume automatically.`;
        }
        return `- The saved internal database version marker is invalid. This installation uses version **${reason.currentVersion}**.`;
    }
    if (reason.source === "settings-schema") {
        if (reason.isFromFutureSchema) {
            return `- The saved settings use schema **${reason.sourceVersion}**, which is newer than schema **${reason.currentVersion}** supported by this installation.`;
        }
        return `- The settings were migrated from schema **${reason.sourceVersion}** to **${reason.currentVersion}** and require review before synchronisation resumes.`;
    }
    const escapedMessage = reason.message.replace(/[\\`*_{}[\]()<>#+.!|-]/gu, "\\$&");
    return `- An earlier compatibility review remains pending: ${escapedMessage}`;
}

/**
 * The reasons, and nothing else.
 *
 * A "What the pause changes" section used to list three bullets, of which two
 * said that closing a dialogue closes a dialogue. The reader who pressed "Show
 * details" wanted the details.
 */
export function compatibilityReviewDetailsMarkdown(pause: CompatibilityPause): string {
    return pause.reasons.map(reasonMarkdown).join("\n");
}
