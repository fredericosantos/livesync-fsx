import { describe, expect, it } from "vitest";
import { DEVICE_NAME_MAX, validateDeviceName } from "./deviceNameRules.ts";

describe("validateDeviceName", () => {
    it("accepts an ordinary name", () => {
        expect(validateDeviceName("MacBook Air").ok).toBe(true);
    });

    it("requires a name", () => {
        expect(validateDeviceName("").ok).toBe(false);
        expect(validateDeviceName("   ").problem).toEqual({ kind: "empty" });
    });

    describe("the Customisation Sync key delimiters", () => {
        // `CmdConfigSync` interpolates the name straight into
        // `${ICXHeader}${term}/${category}/${name}.md`, so a name carrying
        // either delimiter produces a key that parses back into wrong fields.
        it("refuses a forward slash", () => {
            expect(validateDeviceName("work/laptop").problem).toEqual({
                kind: "reserved-character",
                character: "/",
            });
        });

        it("refuses a percent sign", () => {
            expect(validateDeviceName("100%vault").problem).toEqual({
                kind: "reserved-character",
                character: "%",
            });
        });
    });

    it("rejects a name already used by another device", () => {
        const verdict = validateDeviceName("air", ["Desktop", "Air"]);
        expect(verdict.ok).toBe(false);
        // Reported with the existing device's own spelling, so the user can
        // recognise which machine they are colliding with.
        expect(verdict.message).toContain('"Air"');
    });

    it("caps the length", () => {
        expect(validateDeviceName("a".repeat(DEVICE_NAME_MAX)).ok).toBe(true);
        expect(validateDeviceName("a".repeat(DEVICE_NAME_MAX + 1)).problem).toEqual({ kind: "too-long" });
    });

    it("trims before judging, so surrounding spaces neither pass nor collide", () => {
        expect(validateDeviceName("  Air  ", ["Air"]).problem).toEqual({ kind: "taken" });
    });

    it("says what to do, not just what is wrong", () => {
        for (const bad of ["", "a/b", "a".repeat(99)]) {
            expect(validateDeviceName(bad).message.length).toBeGreaterThan(0);
        }
    });
});
