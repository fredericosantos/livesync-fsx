import { describe, expect, it } from "vitest";
import {
    ACTIVITY_VISIBILITY_THRESHOLD_MS,
    STATUS_ACTIVITY,
    STATUS_ATTENTION,
    STATUS_IDLE,
    presentStatus,
    type StatusInput,
} from "./StatusPresentation.ts";

/** A healthy, fully synchronised, idle device. */
function healthy(overrides: Partial<StatusInput> = {}): StatusInput {
    return {
        connected: true,
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
            expect(result.text).toBe("");
            expect(result.detail).toBeUndefined();
        });

        it("stays silent while connected with no work in flight, however long it has been up", () => {
            expect(presentStatus(healthy({ activeForMs: 600_000 })).text).toBe("");
        });

        it("does not flash for work that completes faster than the visibility threshold", () => {
            const result = presentStatus(
                healthy({ pendingUpload: 12, activeForMs: ACTIVITY_VISIBILITY_THRESHOLD_MS - 1 })
            );
            expect(result.level).toBe(STATUS_IDLE);
            expect(result.text).toBe("");
        });
    });

    describe("activity", () => {
        it("reports uploads in words once sustained", () => {
            const result = presentStatus(busy({ pendingUpload: 3 }));
            expect(result.level).toBe(STATUS_ACTIVITY);
            expect(result.text).toBe("Uploading 3");
        });

        it("reports downloads separately from uploads", () => {
            expect(presentStatus(busy({ pendingDownload: 5 })).text).toBe("Downloading 5");
        });

        it("combines both directions into a single total", () => {
            const result = presentStatus(busy({ pendingUpload: 2, pendingDownload: 4 }));
            expect(result.text).toBe("Syncing 6");
            expect(result.detail).toBe("Uploading 2 changes, downloading 4.");
        });

        it("falls back to local processing when nothing is in flight remotely", () => {
            expect(presentStatus(busy({ processing: 1, queued: 2 })).text).toBe("Processing 3");
        });

        it("singularises a lone change", () => {
            expect(presentStatus(busy({ pendingUpload: 1 })).detail).toBe("Sending 1 change to the remote server.");
        });
    });

    describe("attention outranks activity", () => {
        it("reports conflicts rather than the transfer they occurred during", () => {
            const result = presentStatus(busy({ pendingUpload: 99, conflicts: 2 }));
            expect(result.level).toBe(STATUS_ATTENTION);
            expect(result.text).toBe("2 conflicts");
        });

        it("puts a required restart above everything else", () => {
            const result = presentStatus(
                busy({ restartRequired: true, conflicts: 3, errored: true, pendingUpload: 10 })
            );
            expect(result.text).toBe("Restart required");
        });

        it("surfaces an error with its cause in the tooltip", () => {
            const result = presentStatus(healthy({ errored: true, errorDetail: "Authentication failed." }));
            expect(result.level).toBe(STATUS_ATTENTION);
            expect(result.text).toBe("Sync error");
            expect(result.detail).toBe("Authentication failed.");
        });

        it("still explains an error that arrived without a cause", () => {
            expect(presentStatus(healthy({ errored: true })).detail).toBeTruthy();
        });

        it("reports a pause, which is a state the user chose and must undo", () => {
            expect(presentStatus(healthy({ paused: true })).text).toBe("Sync paused");
        });

        it("reports a missing connection", () => {
            expect(presentStatus(healthy({ connected: false })).text).toBe("Not connected");
        });

        it("singularises a lone conflict", () => {
            expect(presentStatus(healthy({ conflicts: 1 })).text).toBe("1 conflict");
        });
    });

    describe("presentation contract", () => {
        it("never emits an emoji in any reachable state", () => {
            const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{23F0}-\u{23FF}]/u;
            const states: StatusInput[] = [
                healthy(),
                healthy({ connected: false }),
                healthy({ paused: true }),
                healthy({ errored: true, errorDetail: "boom" }),
                healthy({ conflicts: 4 }),
                healthy({ restartRequired: true }),
                busy({ pendingUpload: 7 }),
                busy({ pendingDownload: 8 }),
                busy({ pendingUpload: 1, pendingDownload: 1 }),
                busy({ processing: 2, queued: 5 }),
            ];
            for (const state of states) {
                const { text, detail } = presentStatus(state);
                expect(text).not.toMatch(emoji);
                if (detail) expect(detail).not.toMatch(emoji);
            }
        });

        it("gives every non-idle state a tooltip, and the idle state none", () => {
            expect(presentStatus(healthy()).detail).toBeUndefined();
            for (const state of [healthy({ conflicts: 1 }), busy({ pendingUpload: 1 })]) {
                expect(presentStatus(state).detail).toBeTruthy();
            }
        });

        it("treats negative counters as zero rather than rendering them", () => {
            const result = presentStatus(busy({ pendingUpload: -5, pendingDownload: -1, processing: -2, queued: -3 }));
            expect(result.level).toBe(STATUS_IDLE);
        });
    });
});
