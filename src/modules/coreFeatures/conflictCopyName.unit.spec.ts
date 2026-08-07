import { describe, expect, it } from "vitest";
import { conflictCopyNotice, conflictCopyPath } from "./conflictCopyName.ts";

const AT = Date.UTC(2026, 7, 7, 12, 32);
const localStamp = (() => {
    const d = new Date(AT);
    const pad = (n: number) => `${n}`.padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
})();

describe("conflictCopyPath", () => {
    it("keeps the copy beside the original, with the extension intact", () => {
        expect(conflictCopyPath({ path: "Notes/Ideas.md", device: "iPhone", modifiedAt: AT })).toBe(
            `Notes/Ideas (from iPhone, ${localStamp}).md`
        );
    });

    it("says which device the other version came from", () => {
        // The whole point of the name is that the user can tell the two apart
        // without opening either.
        const copy = conflictCopyPath({ path: "Ideas.md", device: "Mac — Work", modifiedAt: AT });
        expect(copy).toContain("from Mac — Work");
    });

    describe("paths that would break", () => {
        it("does not turn a device name into a folder", () => {
            const copy = conflictCopyPath({ path: "Ideas.md", device: "work/laptop", modifiedAt: AT });
            expect(copy.slice(0, copy.lastIndexOf("("))).not.toContain("/");
        });

        it("leaves a file with no extension alone", () => {
            expect(conflictCopyPath({ path: "LICENSE", device: "Mac", modifiedAt: AT })).toBe(
                `LICENSE (from Mac, ${localStamp})`
            );
        });

        it("treats a leading dot as a hidden file, not an extension", () => {
            expect(conflictCopyPath({ path: ".gitignore", device: "Mac", modifiedAt: AT })).toBe(
                `.gitignore (from Mac, ${localStamp})`
            );
        });

        it("does not mistake a dotted folder for an extension", () => {
            const copy = conflictCopyPath({ path: "my.folder/Ideas", device: "Mac", modifiedAt: AT });
            expect(copy.startsWith("my.folder/Ideas (from")).toBe(true);
        });

        it("falls back to readable words when the device has no usable name", () => {
            expect(conflictCopyPath({ path: "Ideas.md", device: "  ", modifiedAt: AT })).toContain(
                "from another device"
            );
        });
    });

    describe("never overwriting an earlier copy", () => {
        it("suffixes when the name is already taken", () => {
            const existing = new Set([`Ideas (from Mac, ${localStamp}).md`]);
            expect(conflictCopyPath({ path: "Ideas.md", device: "Mac", modifiedAt: AT, existingPaths: existing })).toBe(
                `Ideas (from Mac, ${localStamp}) 2.md`
            );
        });
    });

    describe("determinism", () => {
        it("produces the same name on every device for the same conflict", () => {
            // The copy is an ordinary file and replicates like one. If the name
            // depended on the current time or the local device, three devices
            // would create three copies of one conflict.
            const input = { path: "Ideas.md", device: "iPhone", modifiedAt: AT } as const;
            expect(conflictCopyPath(input)).toBe(conflictCopyPath(input));
        });
    });
});

describe("conflictCopyNotice", () => {
    it("names the file without its folders, and says nothing else", () => {
        expect(conflictCopyNotice("Notes/Ideas (from iPhone, 2026-08-07 1432).md")).toBe(
            'This file was also edited on another device. That version is saved as "Ideas (from iPhone, 2026-08-07 1432).md".'
        );
    });
});
