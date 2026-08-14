import { describe, expect, it } from "vitest";
import { presentSyncStatusLine } from "./syncStatusLineView.ts";
import {
    STATUS_IDLE,
    STATUS_OFFLINE,
    STATUS_PROBLEM,
    STATUS_SYNCED,
    STATUS_SYNCING,
} from "@/modules/features/StatusPresentation.ts";

const noProgress = { done: 0, total: 0 };

describe("presentSyncStatusLine", () => {
    it("says the server is unavailable when offline", () => {
        const view = presentSyncStatusLine({ level: STATUS_OFFLINE, message: "Not connected" }, noProgress);
        expect(view.text).toBe("Sync server unavailable");
        expect(view.progress).toBeUndefined();
    });

    it("says work is in flight, with how far along it is", () => {
        const view = presentSyncStatusLine(
            { level: STATUS_SYNCING, message: "Downloading 40" },
            { done: 10, total: 40 }
        );
        expect(view.text).toBe("Syncing files…");
        expect(view.progress).toBeCloseTo(0.25);
    });

    it("reports no progress rather than NaN before a total is known", () => {
        // Work can be queued before the replicator has reported a total. A bar
        // at NaN% draws as empty, which is indistinguishable from stalled.
        const view = presentSyncStatusLine({ level: STATUS_SYNCING, message: "Processing 3" }, { done: 3, total: 0 });
        expect(view.progress).toBe(0);
    });

    it("never reports more than complete", () => {
        const view = presentSyncStatusLine({ level: STATUS_SYNCING, message: "Uploading 1" }, { done: 99, total: 40 });
        expect(view.progress).toBe(1);
    });

    it("says the same thing whether it just finished or has been idle for hours", () => {
        // The icon distinguishes these because it is competing for attention in
        // the corner of the screen. Here nothing is being interrupted, and "up
        // to date" is equally true of both.
        for (const level of [STATUS_SYNCED, STATUS_IDLE] as const) {
            const view = presentSyncStatusLine({ level, message: "" }, noProgress);
            expect(view.text).toBe("Sync complete");
            expect(view.icon).toBe("check");
        }
    });

    it("uses the icon's own wording for a problem rather than the word 'problem'", () => {
        const view = presentSyncStatusLine({ level: STATUS_PROBLEM, message: "2 conflicts" }, noProgress);
        expect(view.text).toBe("2 conflicts");
        expect(view.icon).toBe("alert-circle");
    });

    it("names a drawn glyph, never an emoji", () => {
        // An emoji would be the only one on the page, in a different typeface at
        // a different weight in a colour the theme does not control.
        const views = [
            presentSyncStatusLine({ level: STATUS_SYNCED, message: "" }, noProgress),
            presentSyncStatusLine({ level: STATUS_OFFLINE, message: "" }, noProgress),
            presentSyncStatusLine({ level: STATUS_PROBLEM, message: "x" }, noProgress),
        ];
        for (const view of views) {
            expect(view.icon).toMatch(/^[a-z-]+$/);
        }
    });
});
