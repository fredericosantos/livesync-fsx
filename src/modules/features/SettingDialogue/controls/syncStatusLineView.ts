/**
 * What synchronisation is doing, in the words the settings page uses.
 *
 * The status icon deliberately says almost nothing: it lives in the corner
 * while you write, so silence is its healthy state and a turning icon is the
 * whole of "not yet". That is the right answer *there* and the wrong one on the
 * settings page, which is the screen you open **because** you want to know —
 * arriving to find no statement at all, because everything is fine, reads as
 * broken rather than calm.
 *
 * Derived from the icon's own state rather than from a second reading of the
 * replication statistics, so the line and the icon can never disagree.
 *
 * Kept apart from the renderer so it can be tested without Obsidian.
 */

import {
    STATUS_OFFLINE,
    STATUS_PROBLEM,
    STATUS_SYNCING,
    type StatusLevel,
} from "@/modules/features/StatusPresentation.ts";

export interface SyncStatusLineView {
    readonly level: StatusLevel;
    /** Lucide icon name, or empty for the states that show a bar instead. */
    readonly icon: string;
    readonly text: string;
    /**
     * Progress through the current burst, 0–1, or undefined when there is
     * nothing in flight to be part-way through.
     */
    readonly progress?: number;
}

/**
 * The line, from the icon's state and the progress counters.
 *
 * Idle and synced collapse into one statement. The icon distinguishes them —
 * green for a moment, then nothing — because it is competing with your writing
 * for attention. Here nothing is being interrupted, and "up to date" is true in
 * both, so drawing a distinction would only invite the reader to work out which
 * one they are looking at.
 */
export function presentSyncStatusLine(
    /** The status bar's own labels, where `message` is what the icon means. */
    status: { readonly level: StatusLevel; readonly message: string },
    progress: { readonly done: number; readonly total: number }
): SyncStatusLineView {
    if (status.level === STATUS_OFFLINE) {
        return { level: status.level, icon: "cloud-off", text: "Sync server unavailable" };
    }
    if (status.level === STATUS_PROBLEM) {
        // The icon's own wording, which is already a description of the fault
        // rather than the word "problem".
        return { level: status.level, icon: "alert-circle", text: status.message };
    }
    if (status.level === STATUS_SYNCING) {
        // A denominator of zero is a real state — work is queued before the
        // replicator has reported a total — and dividing by it would render a
        // bar at NaN%, which draws as empty and reads as stalled.
        const fraction = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
        return { level: status.level, icon: "", text: "Syncing files…", progress: fraction };
    }
    return { level: status.level, icon: "check", text: "Sync complete" };
}

