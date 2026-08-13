import { describe, expect, it } from "vitest";
import { deservesNotice } from "./noticePolicy.ts";

describe("what earns a toast", () => {
    // The six that appeared, in order, on one clean start-up of a phone that
    // had just been set up. Nothing had gone wrong.
    it.each([
        "Checking for incomplete documents...",
        "No size mismatches found",
        "An update has been detected. Please open the Settings dialogue and check the Change Log. Replication has been cancelled.",
        "Database and storage reflection has been resumed!",
        "Initialize done!",
        "Initializing",
        "Local Database Reset",
        "Suspending reflection: Database and storage changes will not be reflected in each other until completely finished the fetching.",
        "Resuming fast database fetch from sequence: 41220",
        "Fast database fetch completed. Total documents in local database: 3184",
    ])("stays in the log: %s", (message) => {
        expect(deservesNotice(message)).toBe(false);
    });

    // A long download is worth watching; it updates one notice in place rather
    // than stacking, so it is feedback, not spam.
    it("still shows progress while a fetch is running", () => {
        expect(deservesNotice("Fast fetch progress: 512 / 3184\nTotal bytes fetched: 41.2MB")).toBe(true);
    });

    // The line that has to survive: it is the answer to "did my fetch work?",
    // for an operation the reader started themselves.
    it("still announces the end of a fetch the user asked for", () => {
        expect(deservesNotice("Done. Your files will arrive as they are downloaded.")).toBe(true);
    });

    it.each([
        "Something went wrong while preparing the vault.",
        "Could not connect to the remote database.",
        "Synchronisation paused. It stays paused until you resume it.",
        "Recovery finished. Resuming file processing and restarting Obsidian.",
    ])("still interrupts for: %s", (message) => {
        expect(deservesNotice(message)).toBe(true);
    });

    // Whole messages, not fragments. Matching on a fragment would have
    // swallowed the failure below along with the success it resembles.
    it("does not suppress a failure that names a suppressed operation", () => {
        expect(deservesNotice("Checking for incomplete documents failed: the database is unreadable")).toBe(true);
        expect(deservesNotice("The incomplete document check could not be completed.")).toBe(true);
    });
});
