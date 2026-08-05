import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Emoji are not an icon set: they render differently on every platform, cannot
 * be recoloured to match a theme, ignore font weight, and are illegible at
 * status-bar size. Obsidian's Lucide icons are used instead, or plain words.
 *
 * See `docs/fork/01-design-principles.md` (principle 3).
 */
const EMOJI =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F000}-\u{1F0FF}\u{1F100}-\u{1F1FF}]/u;

const SOURCE_ROOT = join(import.meta.dirname, "..");

/**
 * Upstream's translation catalogues are excluded: they are generated artefacts
 * carrying community-contributed text for ten locales, and rewriting them is a
 * separate job from the interface itself.
 */
const EXCLUDED = ["messages", "messagesJson", "messagesYAML"];

function* sourceFiles(directory: string): Generator<string> {
    for (const entry of readdirSync(directory)) {
        if (EXCLUDED.includes(entry)) continue;
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
            yield* sourceFiles(path);
        } else if (/\.(ts|svelte)$/.test(entry) && !entry.endsWith(".unit.spec.ts")) {
            yield path;
        }
    }
}

describe("no emoji in the interface", () => {
    it("keeps every source file free of emoji", () => {
        const offenders: string[] = [];
        for (const path of sourceFiles(SOURCE_ROOT)) {
            const content = readFileSync(path, "utf8");
            for (const [index, line] of content.split("\n").entries()) {
                if (EMOJI.test(line)) {
                    offenders.push(`${relative(SOURCE_ROOT, path)}:${index + 1}  ${line.trim().slice(0, 70)}`);
                }
            }
        }
        expect(
            offenders,
            `Emoji found in the interface. Use an Obsidian Lucide icon via setIcon(), or plain words.\n${offenders.join("\n")}`
        ).toEqual([]);
    });
});
