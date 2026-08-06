import { describe, expect, it } from "vitest";
import { parseIgnoreFileNames, serialiseIgnoreFileNames } from "./ignoreFileNames.ts";

describe("ignore file names", () => {
    it("reads the stored comma-separated form", () => {
        expect(parseIgnoreFileNames(".gitignore, .dockerignore")).toEqual([".gitignore", ".dockerignore"]);
    });

    it("survives the shapes a textarea produced", () => {
        expect(parseIgnoreFileNames("")).toEqual([]);
        expect(parseIgnoreFileNames("  ")).toEqual([]);
        expect(parseIgnoreFileNames(".gitignore,,")).toEqual([".gitignore"]);
        expect(parseIgnoreFileNames("\n.gitignore ,\n .npmignore\n")).toEqual([".gitignore", ".npmignore"]);
    });

    it("writes back without padding", () => {
        // The stored string is compared against other devices' tweak values,
        // so an added space would read as a configuration mismatch.
        expect(serialiseIgnoreFileNames([".gitignore", ".dockerignore"])).toBe(".gitignore,.dockerignore");
    });

    it("round-trips a list that a user typed loosely", () => {
        const stored = " .gitignore ,.npmignore ";
        expect(serialiseIgnoreFileNames(parseIgnoreFileNames(stored))).toBe(".gitignore,.npmignore");
    });
});
