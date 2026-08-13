import { describe, expect, it } from "vitest";
import { isProblem } from "./noticePolicy.ts";

/**
 * Every message below is a real one, taken from the 220 distinct
 * `LOG_LEVEL_NOTICE` messages in this plug-in and the sync engine. None of them
 * interrupts anybody any more; this decides only which turn the status icon
 * red.
 */
describe("which log lines turn the icon red", () => {
    // The half that must never be missed. The vocabulary is matched rather
    // than the message, so a fault added upstream tomorrow is caught on the day
    // it is written.
    it.each([
        "Could not connect to the remote database.",
        "Failed to decrypt configuration item",
        "Refusing to overwrite notes/a.md while applying the distinct path notes/A.md",
        "File notes/a.md seems to be corrupted! Writing prevented. (12 != 15)",
        "No active replicator found when trying to reset remote database.",
        "DELETE DATABASE did not delete notes/a.md; keeping last-seen record to avoid resurrecting the file",
        "The remote database has been cleaned up. Fetch rebuilt DB, explicit unlocking or chunk clean-up is required.",
        "No passphrase found for data.json! Verify configuration before syncing.",
        "STORAGE <- DB : Cloud not read notes/a.md, possibly deleted",
        "Something went wrong while preparing the vault.",
        "Network is offline",
        "notes/a.md is conflicted, merging process has been postponed.",
        "Another device is using a newer version of the plug-in. Update this one before syncing again.",
        "Missing document content!, could not read notes/a.md from database.",
    ])("red: %s", (message) => {
        expect(isProblem(message)).toBe(true);
    });

    // Everything the plug-in used to announce about itself. All of it still
    // goes to the log; none of it colours anything.
    it.each([
        "Initializing",
        "Initialize done!",
        "Local Database Reset",
        "Database and storage reflection has been resumed!",
        "Suspending reflection: Database and storage changes will not be reflected in each other until completely finished the fetching.",
        "Synchronisation completed: 184/184 files processed successfully",
        "Replication activated",
        "Replication completed",
        "Connected to obsidian successfully",
        "Fast database fetch completed. Total documents in local database: 3184",
        "Done. Your files will arrive as they are downloaded.",
        "Done. The server now holds this vault.",
        "Connection settings saved.",
        "Setup URI copied to clipboard",
        "Creating chunks Done: 12 of 12 files",
    ])("quiet: %s", (message) => {
        expect(isProblem(message)).toBe(false);
    });

    // This fork presents the compatibility pause as a dialogue with named
    // reasons; the engine's own wording for it names a Change Log that does not
    // exist here, and would otherwise turn the icon red alongside it.
    it("leaves the compatibility pause to the dialogue that owns it", () => {
        expect(
            isProblem(
                "An update has been detected. Please open the Settings dialogue and check the Change Log. Replication has been cancelled."
            )
        ).toBe(false);
    });

    it("says nothing about an empty message", () => {
        expect(isProblem("   ")).toBe(false);
    });
});
