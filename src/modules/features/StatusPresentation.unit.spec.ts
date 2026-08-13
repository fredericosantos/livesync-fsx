import { HOLD_COMPATIBILITY, HOLD_REMOTE_REBUILT } from "@/common/syncHold.ts";
import { describe, expect, it } from "vitest";
import {
    ACTIVITY_VISIBILITY_THRESHOLD_MS,
    STATUS_IDLE,
    STATUS_OFFLINE,
    STATUS_PROBLEM,
    STATUS_SYNCED,
    STATUS_SYNCING,
    SYNCED_VISIBILITY_MS,
    presentStatus,
    type StatusInput,
} from "./StatusPresentation.ts";

/** A healthy, fully synchronised, idle device. */
function healthy(overrides: Partial<StatusInput> = {}): StatusInput {
    return {
        connected: true,
        anyTriggerEnabled: true,
        paused: false,
        errored: false,
        pendingUpload: 0,
        pendingDownload: 0,
        processing: 0,
        queued: 0,
        conflicts: 0,
        restartRequired: false,
        activeForMs: 0,
        ...overrides,
    };
}

const busy = (overrides: Partial<StatusInput> = {}) =>
    healthy({ activeForMs: ACTIVITY_VISIBILITY_THRESHOLD_MS, ...overrides });

describe("presentStatus", () => {
    describe("silence is the default", () => {
        it("shows nothing at all when healthy and current", () => {
            const result = presentStatus(healthy());
            expect(result.level).toBe(STATUS_IDLE);
            expect(result.icon).toBe("");
            expect(result.text).toBe("");
        });

        it("says nothing about work that finishes quickly", () => {
            expect(presentStatus(healthy({ pendingUpload: 3, activeForMs: 200 })).level).toBe(STATUS_IDLE);
        });
    });

    describe("syncing", () => {
        it("turns while work is in flight", () => {
            const result = presentStatus(busy({ pendingUpload: 4 }));
            expect(result.level).toBe(STATUS_SYNCING);
            expect(result.icon).toBe("refresh-cw");
        });

        it("counts both directions together", () => {
            expect(presentStatus(busy({ pendingUpload: 2, pendingDownload: 3 })).text).toBe("Syncing 5 changes");
        });

        it("covers local work with no network work", () => {
            expect(presentStatus(busy({ processing: 1, queued: 2 })).level).toBe(STATUS_SYNCING);
        });
    });

    describe("synced", () => {
        // The one confirmation left, and it expires on its own.
        it("shows a tick for a moment after work finishes", () => {
            const result = presentStatus(healthy({ sinceSyncedMs: 200 }));
            expect(result.level).toBe(STATUS_SYNCED);
            expect(result.icon).toBe("check");
            expect(result.text).toBe("Synced");
        });

        it("returns to silence once the moment has passed", () => {
            expect(presentStatus(healthy({ sinceSyncedMs: SYNCED_VISIBILITY_MS })).level).toBe(STATUS_IDLE);
        });

        it("says nothing on a device that has not synchronised yet", () => {
            expect(presentStatus(healthy()).level).toBe(STATUS_IDLE);
        });

        it("never interrupts work in flight to confirm the last batch", () => {
            expect(presentStatus(busy({ pendingUpload: 1, sinceSyncedMs: 10 })).level).toBe(STATUS_SYNCING);
        });
    });

    describe("offline is not a fault", () => {
        it("is its own state, not red", () => {
            const result = presentStatus(healthy({ connected: false }));
            expect(result.level).toBe(STATUS_OFFLINE);
            expect(result.icon).toBe("refresh-cw-off");
        });
    });

    describe("problems are red, and say what happened when pressed", () => {
        it("reports a failure that did not stop replication", () => {
            const result = presentStatus(healthy({ problem: "Could not write notes/a.md" }));
            expect(result.level).toBe(STATUS_PROBLEM);
            expect(result.icon).toBe("alert-circle");
            expect(result.detail).toBe("Could not write notes/a.md");
        });

        it("carries the reason when replication itself stopped", () => {
            const result = presentStatus(healthy({ errored: true, problem: "Server refused the connection" }));
            expect(result.level).toBe(STATUS_PROBLEM);
            expect(result.detail).toBe("Server refused the connection");
        });

        it.each([
            ["a restart is owed", healthy({ restartRequired: true })],
            ["a decision is owed", healthy({ conflicts: 2 })],
            ["synchronisation is paused", healthy({ paused: true })],
            ["nothing will ever sync", healthy({ anyTriggerEnabled: false })],
            ["synchronisation is held back", healthy({ hold: HOLD_COMPATIBILITY })],
        ])("is red when %s", (_, input) => {
            expect(presentStatus(input).level).toBe(STATUS_PROBLEM);
        });

        it("outranks work in flight", () => {
            expect(presentStatus(busy({ pendingUpload: 9, conflicts: 1 })).level).toBe(STATUS_PROBLEM);
        });

        // Two holds can share a headline — the icon has room for one phrase —
        // but each has to name its own way out, because that is what the reader
        // came for when they pressed it.
        it("distinguishes the holds from one another", () => {
            const rebuilt = presentStatus(busy({ hold: HOLD_REMOTE_REBUILT }));
            const compatibility = presentStatus(busy({ hold: HOLD_COMPATIBILITY }));
            expect(rebuilt.detail).not.toBe(compatibility.detail);
        });
    });

    it("always explains itself when it shows anything", () => {
        for (const state of [
            healthy({ connected: false }),
            healthy({ conflicts: 1 }),
            healthy({ problem: "Something failed" }),
            healthy({ sinceSyncedMs: 10 }),
            busy({ pendingUpload: 1 }),
        ]) {
            const result = presentStatus(state);
            expect(result.text).not.toBe("");
            expect(result.detail).toBeTruthy();
        }
    });
});
