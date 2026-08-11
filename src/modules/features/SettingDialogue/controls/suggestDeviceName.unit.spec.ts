import { describe, expect, it } from "vitest";
import { cleanHostName, describeDevice, suggestDeviceName, type DevicePlatform } from "./suggestDeviceName.ts";
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

describe("cleanHostName", () => {
    it("keeps the machine's own name and drops the network's part of it", () => {
        expect(cleanHostName("Fredericos-MacBook-Pro.local")).toBe("Fredericos-MacBook-Pro");
        expect(cleanHostName("studio.lan")).toBe("studio");
        expect(cleanHostName("workstation")).toBe("workstation");
    });

    it("refuses names that identify nothing", () => {
        // A router-assigned name or a stock default tells the reader less than
        // the kind of machine does.
        for (const raw of ["localhost", "unknown", "192-168-1-42", "10-0-0-3.lan", "", "   "]) {
            expect(cleanHostName(raw), raw).toBe("");
        }
    });

    it("refuses a name carrying the Customisation Sync key delimiters", () => {
        expect(cleanHostName("a/b")).not.toContain("/");
        expect(cleanHostName("100%box")).not.toContain("%");
    });
});

describe("suggestDeviceName", () => {
    const mac = platform({ isMacOS: true });

    it("prefers the name the machine already has", () => {
        expect(suggestDeviceName(mac, "Notes", [], "Fredericos-MacBook-Pro.local")).toBe("Fredericos-MacBook-Pro");
    });

    it("falls back to the kind of machine and the vault when there is no host name", () => {
        // Mobile has no host name to read, and "Mac" alone stops distinguishing
        // as soon as a second vault is synchronised from the same computer.
        expect(suggestDeviceName(mac, "Notes")).toBe("Mac — Notes");
        expect(suggestDeviceName(mac, "")).toBe("Mac");
    });

    it("names the vault before resorting to a number", () => {
        expect(suggestDeviceName(mac, "Work", ["Fredericos-MacBook-Pro"], "Fredericos-MacBook-Pro")).toBe(
            "Fredericos-MacBook-Pro — Work"
        );
    });

    it("does not propose a name that is already taken", () => {
        expect(suggestDeviceName(mac, "Notes", ["Mac — Notes"])).toBe("Mac — Notes 2");
        expect(suggestDeviceName(mac, "Notes", ["Mac — Notes", "Mac — Notes 2"])).toBe("Mac — Notes 3");
    });

    it("never proposes a name its own validator would reject", () => {
        for (const vault of ["a/b", "100%", "  ", "Notes"]) {
            for (const host of ["", "a/b.local", "Fredericos-MacBook-Pro.local"]) {
                const suggested = suggestDeviceName(platform({ isPhone: true, isIosApp: true }), vault, [], host);
                expect(validateDeviceName(suggested).ok, `${vault} + ${host} -> ${suggested}`).toBe(true);
            }
        }
    });
});
