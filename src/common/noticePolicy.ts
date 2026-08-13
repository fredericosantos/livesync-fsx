/**
 * Which log lines mean something went wrong.
 *
 * This was a policy for deciding which of 220 messages deserved a toast. There
 * are no toasts now: a message that interrupts you to say a thing worked is a
 * message you have to dismiss to get back to writing, and one that interrupts
 * to say a thing failed is a message you will have closed before you understood
 * it. Both go to the log, and the status icon says which kind arrived.
 *
 * So the only question left is the one below: is this line a fault? If it is,
 * the icon turns red and holds this text until it is read. If it is not, it
 * goes to the log and nothing moves on screen.
 *
 * The vocabulary is matched rather than the message, deliberately. An unknown
 * failure must never be silent — including one added upstream that this fork
 * has never seen — so anything that reads like a fault counts as one.
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
    "problem",
] as const;

/**
 * Faults with no failure vocabulary in them.
 *
 * Both are about another device, and neither says anything that looks like an
 * error, so the patterns above cannot catch them.
 */
const ALWAYS_A_PROBLEM = [
    "Another device is using a newer version of the plug-in.",
    "The remote database has no compatibility with the running version.",
] as const;

/**
 * Lines that read like faults but are not this fork's to report.
 *
 * The compatibility pause is presented as a dialogue with named reasons. The
 * sync engine additionally logs upstream's wording for the same thing, which
 * names a Change Log that does not exist here.
 */
const NOT_OURS_TO_REPORT: ReadonlySet<string> = new Set([
    "An update has been detected. Please open the Settings dialogue and check the Change Log. Replication has been cancelled.",
]);

/** Whether a log line should turn the status icon red. */
export function isProblem(message: string): boolean {
    const trimmed = message.trim();
    if (trimmed === "") return false;
    if (NOT_OURS_TO_REPORT.has(trimmed)) return false;
    if (ALWAYS_A_PROBLEM.some((prefix) => trimmed.startsWith(prefix))) return true;

    const lowered = trimmed.toLowerCase();
    return FAILURE_VOCABULARY.some((word) => lowered.includes(word));
}
