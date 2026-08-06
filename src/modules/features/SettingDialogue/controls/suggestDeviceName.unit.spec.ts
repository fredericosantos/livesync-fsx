import { describe, expect, it } from "vitest";
import { describeDevice, suggestDeviceName, type DevicePlatform } from "./suggestDeviceName.ts";
import { validateDeviceName } from "./deviceNameRules.ts";

const platform = (over: Partial<DevicePlatform> = {}): DevicePlatform => ({
    isPhone: false,
    isTablet: false,
    isIosApp: false,
    isAndroidApp: false,
    isMacOS: false,
    isWin: false,
    isLinux: false,
    ...over,
});

describe("describeDevice", () => {
    it("prefers the form of the machine over its operating system", () => {
        // "iPhone" tells the reader which device it is; "iOS" does not, and both
        // are true of the same handset.
        expect(describeDevice(platform({ isPhone: true, isIosApp: true }))).toBe("iPhone");
        expect(describeDevice(platform({ isTablet: true, isIosApp: true }))).toBe("iPad");
    });

    it("names each desktop platform", () => {
        expect(describeDevice(platform({ isMacOS: true }))).toBe("Mac");
        expect(describeDevice(platform({ isWin: true }))).toBe("Windows");
        expect(describeDevice(platform({ isLinux: true }))).toBe("Linux");
    });

    it("falls back to something usable rather than empty", () => {
        expect(describeDevice(platform())).toBe("Desktop");
    });
});

describe("suggestDeviceName", () => {
    it("distinguishes two vaults on the same machine", () => {
        expect(suggestDeviceName(platform({ isMacOS: true }), "Notes")).toBe("Mac — Notes");
        expect(suggestDeviceName(platform({ isMacOS: true }), "Work")).toBe("Mac — Work");
    });

    it("uses the device alone when there is no vault name", () => {
        expect(suggestDeviceName(platform({ isMacOS: true }), "")).toBe("Mac");
    });

    it("does not propose a name that is already taken", () => {
        expect(suggestDeviceName(platform({ isMacOS: true }), "Notes", ["Mac — Notes"])).toBe("Mac — Notes 2");
        expect(suggestDeviceName(platform({ isMacOS: true }), "Notes", ["Mac — Notes", "Mac — Notes 2"])).toBe(
            "Mac — Notes 3"
        );
    });

    it("never proposes a name its own validator would reject", () => {
        // A vault called "a/b" would otherwise produce a name carrying the
        // Customisation Sync key delimiter.
        for (const vault of ["a/b", "100%", "  ", "Notes"]) {
            const suggested = suggestDeviceName(platform({ isPhone: true, isIosApp: true }), vault);
            expect(validateDeviceName(suggested).ok, `${vault} -> ${suggested}`).toBe(true);
        }
    });
});
