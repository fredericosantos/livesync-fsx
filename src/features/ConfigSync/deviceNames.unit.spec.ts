import { describe, expect, it } from "vitest";
import { deviceNameFromCustomisationPath } from "./deviceNames.ts";
import { ICXHeader } from "@vrtmrz/livesync-commonlib/compat/common/models/fileaccess.const";

describe("deviceNameFromCustomisationPath", () => {
    it("reads the device from a markdown entry", () => {
        expect(deviceNameFromCustomisationPath(`${ICXHeader}Mac — Notes/PLUGIN_MAIN/iconic.md`)).toBe("Mac — Notes");
    });

    it("reads the device from a binary entry, which ends in %basename", () => {
        expect(deviceNameFromCustomisationPath(`${ICXHeader}iPhone/PLUGIN_MAIN/iconic%main.js`)).toBe("iPhone");
    });

    it("ignores paths that are not customisation entries", () => {
        for (const path of ["notes/first.md", "", `${ICXHeader}`, `${ICXHeader}/no-device/x.md`]) {
            expect(deviceNameFromCustomisationPath(path), path).toBe("");
        }
    });
});
