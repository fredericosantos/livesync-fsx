import { describe, expect, it } from "vitest";
import { deservesNotice } from "./noticePolicy.ts";

/**
 * Every message below is a real one, taken from the 220 distinct
 * `LOG_LEVEL_NOTICE` messages in this plug-in and the sync engine.
 */
describe("what earns a toast", () => {
    // The ones that appeared, in order, on clean start-ups of a phone where
    // nothing had gone wrong.
    it.each([
        "Checking for incomplete documents...",
        "No size mismatches found",
        "An update has been detected. Please open the Settings dialogue and check the Change Log. Replication has been cancelled.",
        "Database and storage reflection has been resumed!",
        "Initialize done!",
        "Initializing",
        "Local Database Reset",
        "Suspending reflection: Database and storage changes will not be reflected in each other until completely finished the fetching.",
        "Synchronisation completed: 184/184 files processed successfully",
        "Replication activated",
        "Replication completed",
        "Replication stopped.",
        "Connected to obsidian successfully",
        "Bulk sending chunks to remote database...",
        "Resuming fast database fetch from sequence: 41220",
        "Fast database fetch completed. Total documents in local database: 3184",
        "Creating chunks Done: 12 of 12 files",
        "Collecting local files on the DB: 1200",
    ])("stays in the log: %s", (message) => {
        expect(deservesNotice(message)).toBe(false);
    });

    // Ends an operation the reader started by hand and then waited for.
    it.each([
        "Done. Your files will arrive as they are downloaded.",
        "Done. The server now holds this vault.",
        "Connection settings saved.",
        "Setup URI copied to clipboard",
        "Conflicts resolved.",
        "Synchronisation paused. It stays paused until you resume it.",
        "Repaired 3 file(s) whose database record was incomplete.",
        "Obsidian will be restarted soon! (Within 20 seconds)",
        "Fast fetch progress: 512 / 3184",
    ])("still answers the reader: %s", (message) => {
        expect(deservesNotice(message)).toBe(true);
    });

    // The half that must never be silenced. An unknown failure is louder than
    // a known one: the vocabulary is matched, not the message, so a fault
    // added upstream tomorrow interrupts on the day it is written.
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
    ])("still interrupts for: %s", (message) => {
        expect(deservesNotice(message)).toBe(true);
    });

    it("says nothing about an empty message", () => {
        expect(deservesNotice("   ")).toBe(false);
    });

    // A failure inside an operation whose success is listed must not be
    // mistaken for that success.
    it("prefers the failure reading when a message could be either", () => {
        expect(deservesNotice("Fast fetch progress: 3 / 100 — could not read chunk")).toBe(true);
    });
});
