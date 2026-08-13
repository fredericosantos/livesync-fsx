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
    ])("stays in the log: %s", (message) => {
        expect(deservesNotice(message)).toBe(false);
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
