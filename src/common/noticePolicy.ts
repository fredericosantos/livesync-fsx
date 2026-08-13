/**
 * What earns a toast.
 *
 * A clean start-up produced six of them in a row, and nothing had gone wrong.
 * There are 277 `LOG_LEVEL_NOTICE` call sites across this plug-in and the sync
 * engine — 220 distinct messages — and each was written by someone who thought
 * their own step was worth announcing. They are individually defensible and
 * collectively unusable.
 *
 * This began as a list of messages to suppress, which is the wrong shape: every
 * upstream release adds new ones, so the quiet has to be re-earned each time.
 * The rule is now the other way round.
 *
 *   A notice interrupts only if it reports something wrong, or the end of
 *   something the reader started. Everything else goes to the log.
 *
 * Nothing is discarded: "Show log" still shows every line, and the file log
 * still records them.
 *
 * The failure half is matched by pattern rather than enumerated, deliberately.
 * An unknown failure must never be silent, so the default for anything that
 * reads like a fault is to interrupt — including faults added upstream that
 * this fork has never seen. The success half is enumerated, because a success
 * nobody listed is by definition not one the reader was waiting for.
 */

/**
 * Messages this fork has replaced with a surface of its own.
 *
 * Checked before anything else, because each of these reads like a fault and
 * would otherwise interrupt twice — once as the engine's wording, once as the
 * dialogue that already says it better.
 */
const REPLACED_BY_OUR_OWN_UI: ReadonlySet<string> = new Set([
    // The compatibility pause. This fork presents it as a dialogue with named
    // reasons; upstream's line for it names a Change Log that does not exist
    // here, and reads as an unrelated second failure.
    "An update has been detected. Please open the Settings dialogue and check the Change Log. Replication has been cancelled.",
]);

/**
 * Warnings with no failure vocabulary in them.
 *
 * Both of these are about someone else's device, and neither says anything that
 * looks like an error, so the pattern below cannot catch them.
 */
const ALWAYS_INTERRUPT = [
    "Another device is using a newer version of the plug-in.",
    "The remote database has no compatibility with the running version.",
] as const;

/**
 * How a failure is recognised.
 *
 * Every one of these appears in real messages from the engine: "Could not
 * connect to the remote database", "Failed to decrypt configuration item",
 * "Refusing to overwrite ...", "File ... seems to be corrupted!". Matching the
 * vocabulary rather than the message means a new failure is loud on the day it
 * is written.
 */
const FAILURE_VOCABULARY = [
    "could not",
    "cannot",
    "can not",
    "failed",
    "failure",
    "error",
    "unable",
    "refusing",
    "prevented",
    "corrupted",
    "not found",
    "not available",
    // "No active replicator found when trying to reset remote database."
    "no active",
    // "DELETE DATABASE did not delete …"
    "did not",
    // "… explicit unlocking or chunk clean-up is required."
    "is required",
    // "File … seems to be corrupted!"
    "seems to be",
    // "No passphrase found for data.json! Verify configuration before syncing."
    "verify",
    // Upstream's spelling of "Could not", in "STORAGE <- DB : Cloud not read …".
    "cloud not",
    "not matched",
    "not ready",
    "missing",
    "denied",
    "invalid",
    "exceed",
    "too large",
    "went wrong",
    "no longer",
    "unsynchronised",
    "conflict",
    "warning",
    "offline",
    "skipped",
    "problem",
    "must ",
    "please ",
] as const;

/**
 * Successes worth interrupting for: each one ends an operation the reader
 * started by hand and then waited for.
 *
 * Matched as prefixes, because several carry a count. A prefix here is a whole
 * clause that only a success can begin.
 */
const ANSWERED_A_QUESTION = [
    // Setup and recovery, all begun from a dialogue or the command palette.
    "Done. Your files will arrive as they are downloaded.",
    "Done. The server now holds this vault.",
    "Connection settings saved.",
    "Recovery finished.",
    "Synchronisation paused.",
    "Synchronisation resumed.",
    "Repairing synchronisation.",
    "Setup URI copied to clipboard",
    "Copied to the clipboard.",

    // Conflict resolution, which the reader triggers and watches.
    "Conflicts resolved.",
    "There are no conflicted documents",
    "Resolving conflicts by keeping the newer file.",

    // Long transfers. These update one notice in place rather than stacking,
    // so they are feedback on a wait the reader is already enduring.
    "Fast fetch progress:",
    "↑ Uploading chunks",
    "Processing:",
    "Check and Processing",

    // Repairs that changed the vault. Silence here would hide a real edit.
    "Repaired ",

    // Restart, which is about to take the window away.
    "Obsidian will be restarted soon!",
    "Everything is suspended:",
] as const;

/**
 * Whether a notice-level message should actually interrupt the reader.
 *
 * Failure first: a message that reads like a fault always shows, even if it
 * also matches a success prefix.
 */
export function deservesNotice(message: string): boolean {
    const trimmed = message.trim();
    if (trimmed === "") return false;
    if (REPLACED_BY_OUR_OWN_UI.has(trimmed)) return false;
    if (ALWAYS_INTERRUPT.some((prefix) => trimmed.startsWith(prefix))) return true;

    const lowered = trimmed.toLowerCase();
    if (FAILURE_VOCABULARY.some((word) => lowered.includes(word))) return true;

    return ANSWERED_A_QUESTION.some((prefix) => trimmed.startsWith(prefix));
}
