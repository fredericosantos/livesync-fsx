/**
 * Settings that were changed on two devices and cannot be merged.
 *
 * Most of them never get here. Two devices changing different keys of the same
 * JSON file are merged automatically against their common ancestor, and files
 * that are not settings at all — a plug-in's `main.js`, a theme — are resolved
 * by taking the newer, because nobody hand-edits those on two machines. What is
 * left is the genuine case: the same setting, given two different values, with
 * no way to have both.
 *
 * That used to open a modal the instant replication delivered it. A modal is
 * the most interruptive thing this plug-in can do — it takes the keyboard, mid
 * sentence, because a background transfer happened to finish — and it was doing
 * it for a decision that is in no hurry: both versions sit in the database
 * until one is chosen, and nothing is lost by choosing tomorrow.
 *
 * So the decisions wait here, the status icon turns red to say they exist, and
 * the dialogue opens when the icon is pressed. Same rule as everything else in
 * this fork: the plug-in says something is owed, the reader chooses when.
 *
 * This lives apart from the feature that fills it so that the status icon can
 * read it without importing Hidden File Sync, which imports the world.
 */

import { reactiveSource } from "octagonal-wheels/dataobject/reactive";

export interface SettingsDecision {
    /** Vault-relative path, e.g. `.obsidian/plugins/iconic/data.json`. */
    readonly path: string;
    /** Opens the dialogue for this one. Resolves when it has been dealt with. */
    readonly ask: () => Promise<void>;
}

export const settingsDecisions = reactiveSource<readonly SettingsDecision[]>([]);

/**
 * Records a decision, replacing any earlier one for the same file.
 *
 * Replacing rather than appending: the conflict check is requeued after each
 * resolution, and a file that is still conflicted comes back round. Appending
 * would count one unresolved file as two, then three.
 */
export function addSettingsDecision(decision: SettingsDecision): void {
    settingsDecisions.value = [...settingsDecisions.value.filter((e) => e.path !== decision.path), decision];
}

export function removeSettingsDecision(path: string): void {
    const remaining = settingsDecisions.value.filter((e) => e.path !== path);
    // Assigned only when it actually changed: writing the same list back would
    // notify every observer, and one of them redraws the status bar.
    if (remaining.length !== settingsDecisions.value.length) settingsDecisions.value = remaining;
}

/** The one to ask about next, or undefined when none are waiting. */
export function nextSettingsDecision(): SettingsDecision | undefined {
    return settingsDecisions.value[0];
}
