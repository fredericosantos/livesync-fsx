/**
 * What earns a toast.
 *
 * A clean start-up on a phone produced six of them, one after another:
 * "Checking for incomplete documents…", "No size mismatches found", a
 * cancelled replication pointing at a Change Log this fork does not have,
 * "Done. Your files will arrive as they are downloaded.", "Database and storage
 * reflection has been resumed!", "Initialize done!" — and then a modal on top.
 * Nothing had gone wrong. The plug-in was narrating its own start-up.
 *
 * The cause is structural rather than careless: there are nearly four hundred
 * `LOG_LEVEL_NOTICE` calls across the plug-in and the sync engine, and each was
 * written by someone who thought their own step was worth announcing. They are
 * each defensible and collectively unusable.
 *
 * The rule applied here:
 *
 *   A notice is for something the reader must know or must act on. Anything
 *   that reports the plug-in doing its job belongs in the log.
 *
 * This is a boundary rather than a rewrite of every call site because most of
 * those call sites are in `livesync-commonlib`, which still tracks upstream.
 * Silencing them there would be a merge conflict on every release; deciding
 * here costs nothing and keeps the log complete — nothing is discarded, and
 * "Show log" still shows all of it.
 */

/**
 * Messages that report progress or completion of work nobody asked about.
 *
 * Matched whole, not by fragment. A fragment would be more robust against
 * upstream rewording, and that is exactly the wrong trade: `includes("Checking
 * for incomplete documents")` would also swallow "Checking for incomplete
 * documents failed: the database is unreadable". Whole messages fail in the
 * safe direction — reworded upstream text starts appearing again, which is
 * noise, rather than disappearing, which is a hidden fault.
 */
const INTERNAL_PROGRESS: ReadonlySet<string> = new Set([
    // The start-up scan announcing that it is looking, then that it found
    // nothing: two interruptions for a non-event.
    "Checking for incomplete documents...",
    "No size mismatches found",

    // Initialisation and rebuild milestones. The reader started these from a
    // dialogue that already said what would happen, and the vault visibly
    // fills when they finish.
    "Initialize done!",
    "Database and storage reflection has been resumed!",

    // The compatibility pause's own side effect. This fork presents the pause
    // in a dialogue it owns; the sync engine additionally logs upstream's
    // wording for the same thing, which names a Change Log that does not exist
    // here and reads as a second, unrelated failure.
    "An update has been detected. Please open the Settings dialogue and check the Change Log. Replication has been cancelled.",
]);

/**
 * Whether a notice-level message should actually interrupt the reader.
 *
 * Every entry in the set above describes success, so no failure can be
 * suppressed by it: a failure is a different message.
 */
export function deservesNotice(message: string): boolean {
    return !INTERNAL_PROGRESS.has(message.trim());
}
