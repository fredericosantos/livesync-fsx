/**
 * Choosing between two versions of a settings file.
 *
 * Native Obsidian rather than a Svelte component: a modal, a row of choices, a
 * diff and two buttons. The component it replaces offered five radio options
 * (including "Not now"), a revision-number column, a letter count per side and
 * both a Cancel and an Apply, then hid some of them behind two flags — for a
 * question with one right shape: which of these do you want?
 *
 * "Not now" is the Escape key and the close button, so it is not also a radio
 * option in the middle of the list of things you might pick.
 */

import { App, DIFF_DELETE, DIFF_INSERT, Modal, Setting, diff_match_patch, type Diff } from "@/deps.ts";
import { type FilePath, type LoadedEntry } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { decodeBinary, readString } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/convert";
import { getDocData } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { waitForSignal } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { mergeChoices, type MergeChoice } from "./mergeChoices.ts";

function docToString(doc: LoadedEntry): string {
    return doc.datatype == "plain" ? getDocData(doc.data) : readString(new Uint8Array(decodeBinary(doc.data)));
}

/** Line-level, because a settings file is read as lines and not as characters. */
function diffLines(left: string, right: string): Diff[] {
    const dmp = new diff_match_patch();
    const mapped = dmp.diff_linesToChars_(left, right);
    const diffs = dmp.diff_main(mapped.chars1, mapped.chars2, false);
    dmp.diff_charsToLines_(diffs, mapped.lineArray);
    return diffs;
}

export class JsonResolveModal extends Modal {
    private readonly docs: LoadedEntry[];
    private callback?: (keepRev?: string, mergedStr?: string) => Promise<void>;
    private readonly filename: FilePath;
    private readonly nameA: string;
    private readonly nameB: string;
    private readonly hideLocal: boolean;
    private readonly heading: string;

    private choices: readonly MergeChoice[] = [];
    private selected?: MergeChoice;
    private previewEl?: HTMLElement;

    constructor(
        app: App,
        filename: FilePath,
        docs: LoadedEntry[],
        callback: (keepRev?: string, mergedStr?: string) => Promise<void>,
        nameA?: string,
        nameB?: string,
        _defaultSelect?: string,
        _keepOrder?: boolean,
        hideLocal?: boolean,
        heading: string = "Conflicted setting"
    ) {
        super(app);
        this.filename = filename;
        this.docs = docs;
        this.callback = callback;
        this.nameA = nameA || "This device";
        this.nameB = nameB || "The other device";
        this.hideLocal = hideLocal ?? false;
        this.heading = heading;
        void waitForSignal(`cancel-internal-conflict:${filename}`).then(() => this.close());
    }

    override onOpen(): void {
        const { contentEl } = this;
        this.titleEl.setText(this.heading);
        contentEl.empty();
        contentEl.addClass("lsfsx-merge");
        contentEl.createDiv({ cls: "lsfsx-merge__file", text: this.filename });

        const [a, b] = this.docs;
        if (!a || !b) {
            // Both revisions are needed to describe a choice; without them the
            // only honest thing is to close and let the check come round again.
            contentEl.createDiv({ text: "That version is no longer available." });
            new Setting(contentEl).addButton((button) =>
                button
                    .setButtonText("Close")
                    .setCta()
                    .onClick(() => void this.finish())
            );
            return;
        }

        // Older first, so "A + B" reads as "the old one, updated by the new".
        const [older, newer] = a.mtime <= b.mtime ? [a, b] : [b, a];
        const olderName = older === a ? this.nameA : this.nameB;
        const newerName = older === a ? this.nameB : this.nameA;

        this.choices = mergeChoices(
            { name: olderName, content: docToString(older) },
            { name: newerName, content: docToString(newer) },
            !this.hideLocal
        );
        this.selected = this.choices[0];

        const chips = contentEl.createDiv({ cls: "lsfsx-chips lsfsx-merge__choices" });
        const buttons = new Map<MergeChoice, HTMLElement>();
        for (const choice of this.choices) {
            const chip = chips.createEl("button", { cls: "lsfsx-chip-button", text: choice.label });
            chip.addEventListener("click", () => {
                this.selected = choice;
                for (const [other, el] of buttons) el.toggleClass("is-selected", other === choice);
                this.preview(docToString(older));
            });
            buttons.set(choice, chip);
        }
        if (this.selected) buttons.get(this.selected)?.addClass("is-selected");

        this.previewEl = contentEl.createDiv({ cls: "lsfsx-merge__preview" });
        this.preview(docToString(older));

        new Setting(contentEl).addButton((button) =>
            button
                .setButtonText("Keep this")
                .setCta()
                .onClick(() => void this.apply(older, newer))
        );
    }

    /** What the chosen version changes, against the older side. */
    private preview(base: string): void {
        const el = this.previewEl;
        if (!el || !this.selected) return;
        el.empty();
        for (const [op, text] of diffLines(base, this.selected.content)) {
            const cls = op === DIFF_DELETE ? "is-deleted" : op === DIFF_INSERT ? "is-added" : "is-same";
            el.createSpan({ cls, text });
        }
    }

    private async apply(older: LoadedEntry, newer: LoadedEntry): Promise<void> {
        const choice = this.selected;
        if (!choice) return void (await this.finish());
        // Keeping one whole revision of the same document is a revision choice,
        // which the caller resolves by deleting the other. Anything else is new
        // content and has to be written.
        if (older._id === newer._id) {
            if (choice.mode === "A") return void (await this.finish(older._rev, undefined));
            if (choice.mode === "B") return void (await this.finish(newer._rev, undefined));
        }
        await this.finish(undefined, choice.content);
    }

    private async finish(keepRev?: string, mergedStr?: string): Promise<void> {
        const callback = this.callback;
        // Cleared first: closing can re-enter, and running the caller's write
        // twice would delete a revision that is no longer there.
        this.callback = undefined;
        this.close();
        await callback?.(keepRev, mergedStr);
    }

    override onClose(): void {
        this.contentEl.empty();
        // Dismissed rather than answered: the decision stays queued, and the
        // status icon keeps saying it is owed.
        void this.finish();
    }
}
