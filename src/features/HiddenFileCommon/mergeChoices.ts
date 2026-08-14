/**
 * What can be done about two versions of the same settings file.
 *
 * Pure, so it can be tested: everything here is strings in and strings out, and
 * the dialogue that shows it holds no logic of its own beyond drawing.
 *
 * The two combined choices are not symmetrical and both are offered. Merging is
 * "take everything, and where they disagree prefer this side" — so `A + B` and
 * `B + A` differ exactly on the keys in dispute, which are the keys the reader
 * opened the dialogue about. When they happen to agree, the second combination
 * produces the same object and is not offered twice.
 */

import { isObjectDifferent, mergeObject } from "@vrtmrz/livesync-commonlib/compat/common/utils";

export type MergeMode = "A" | "B" | "AB" | "BA";

export interface MergeChoice {
    readonly mode: MergeMode;
    /** What the button says. */
    readonly label: string;
    /** The file this choice would produce, formatted. */
    readonly content: string;
}

/** What `mergeObject` accepts: an object, or a single-element tuple for arrays. */
type JsonData = Record<string | number | symbol, unknown> | [unknown];

function parse(text: string): JsonData | undefined {
    try {
        const parsed: unknown = JSON.parse(text);
        return typeof parsed === "object" && parsed !== null ? (parsed as JsonData) : undefined;
    } catch {
        // Not JSON. Whole-file choices still work; combining does not.
        return undefined;
    }
}

function format(value: JsonData): string {
    return JSON.stringify(value, null, 2);
}

/**
 * @param a the older side, and `nameA` what to call it
 * @param b the newer side
 * @param includeA false when this device's own version is not on offer
 */
export function mergeChoices(
    a: { readonly name: string; readonly content: string },
    b: { readonly name: string; readonly content: string },
    includeA = true
): readonly MergeChoice[] {
    const choices: MergeChoice[] = [];
    if (includeA) choices.push({ mode: "A", label: a.name, content: a.content });
    choices.push({ mode: "B", label: b.name, content: b.content });

    const objA = parse(a.content);
    const objB = parse(b.content);
    // Combining is only meaningful for two objects. A theme's CSS or a corrupt
    // file gets the two whole-file choices and nothing that pretends otherwise.
    if (!objA || !objB) return choices;

    const ab = mergeObject(objA, objB) as JsonData;
    choices.push({ mode: "AB", label: `${a.name} + ${b.name}`, content: format(ab) });

    const ba = mergeObject(objB, objA) as JsonData;
    // Identical when the two sides have no key in dispute, and offering the
    // same file twice under two names invites the reader to look for a
    // difference that is not there.
    if (isObjectDifferent(ba, ab)) {
        choices.push({ mode: "BA", label: `${b.name} + ${a.name}`, content: format(ba) });
    }
    return choices;
}
