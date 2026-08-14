import { describe, expect, it } from "vitest";
import { mergeChoices } from "./mergeChoices.ts";

const a = { name: "MacBook", content: JSON.stringify({ theme: "dark", zoom: 1 }) };
const b = { name: "iPhone", content: JSON.stringify({ theme: "light", font: "Inter" }) };

describe("mergeChoices", () => {
    it("offers each side and both combinations when they disagree", () => {
        expect(mergeChoices(a, b).map((c) => c.mode)).toEqual(["A", "B", "AB", "BA"]);
    });

    it("does not offer the same file twice under two names", () => {
        // With no key in dispute the two combinations produce identical files,
        // and a second button inviting a comparison that has no answer is worse
        // than no button.
        const left = { name: "MacBook", content: JSON.stringify({ zoom: 1 }) };
        const right = { name: "iPhone", content: JSON.stringify({ font: "Inter" }) };
        expect(mergeChoices(left, right).map((c) => c.mode)).toEqual(["A", "B", "AB"]);
    });

    it("prefers the named side where the two disagree", () => {
        const choices = mergeChoices(a, b);
        const ab = JSON.parse(choices.find((c) => c.mode === "AB")!.content);
        const ba = JSON.parse(choices.find((c) => c.mode === "BA")!.content);
        // Both keep every key; they differ only on the one in dispute.
        expect(ab).toMatchObject({ zoom: 1, font: "Inter" });
        expect(ba).toMatchObject({ zoom: 1, font: "Inter" });
        expect(ab.theme).not.toBe(ba.theme);
    });

    it("offers only the whole files when they are not both JSON", () => {
        // A theme's CSS, or a file that arrived corrupt. Combining would be a
        // promise the format cannot keep.
        const css = { name: "MacBook", content: "body { color: red }" };
        expect(mergeChoices(css, b).map((c) => c.mode)).toEqual(["A", "B"]);
    });

    it("leaves this device out when its version is not on offer", () => {
        expect(mergeChoices(a, b, false).map((c) => c.mode)).toEqual(["B", "AB", "BA"]);
    });

    it("labels the choices with the names it was given", () => {
        const labels = mergeChoices(a, b).map((c) => c.label);
        expect(labels).toContain("MacBook");
        expect(labels).toContain("MacBook + iPhone");
    });
});
