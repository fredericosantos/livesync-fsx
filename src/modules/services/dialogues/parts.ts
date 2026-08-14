/**
 * The pieces every dialogue is made of.
 *
 * These replace eight Svelte components — `DialogHeader`, `Guidance`,
 * `Instruction`, `InputRow`, `Password`, `InfoNote`, `Decision`,
 * `UserDecisions` — none of which did anything a `Setting` and an element do
 * not. What they did do was define their own spacing, their own label column
 * and their own button styling, which is why the wizard never looked like the
 * settings page it leads to.
 */

import { Setting } from "@/deps.ts";

/** A paragraph of explanation. Several calls make several paragraphs. */
export function guidance(el: HTMLElement, ...paragraphs: string[]): void {
    const wrap = el.createDiv({ cls: "lsfsx-dialog__guidance" });
    for (const text of paragraphs) wrap.createEl("p", { text });
}

/** Numbered steps, where the order is the instruction. */
export function steps(el: HTMLElement, ...items: string[]): void {
    const list = el.createEl("ol", { cls: "lsfsx-dialog__steps" });
    for (const text of items) list.createEl("li", { text });
}

export type NoteKind = "info" | "warning" | "error";

export interface Note {
    /** Show the note with this text, or hide it when the text is empty. */
    set(text: string): void;
}

/**
 * A line that appears when there is something to say and takes no space when
 * there is not.
 *
 * Hidden rather than absent, so showing it does not move the buttons out from
 * under the reader's cursor.
 */
export function note(el: HTMLElement, kind: NoteKind = "info"): Note {
    const noteEl = el.createDiv({ cls: `lsfsx-dialog__note is-${kind}` });
    return {
        set(text: string) {
            noteEl.setText(text);
            noteEl.toggleClass("is-visible", text.trim() !== "");
        },
    };
}

export interface DialogButton {
    readonly label: string;
    /** The one the reader is expected to press. */
    readonly primary?: boolean;
    /** Loses work. Styled as such, rather than merely left unhighlighted. */
    readonly destructive?: boolean;
    readonly onClick: () => void;
}

export interface Decisions {
    /** Enable or disable the primary button as the form becomes valid. */
    setPrimaryEnabled(enabled: boolean): void;
}

/**
 * The row of buttons that ends a dialogue.
 *
 * Obsidian puts the primary action on the right, so the buttons are given in
 * reading order and land where the app puts them.
 */
export function decisions(el: HTMLElement, ...buttons: DialogButton[]): Decisions {
    const setting = new Setting(el);
    setting.settingEl.addClass("lsfsx-dialog__decisions");
    let primary: { setDisabled(disabled: boolean): unknown } | undefined;
    for (const spec of buttons) {
        setting.addButton((button) => {
            button.setButtonText(spec.label).onClick(spec.onClick);
            if (spec.destructive) button.setWarning();
            else if (spec.primary) button.setCta();
            if (spec.primary) primary = button;
        });
    }
    return {
        setPrimaryEnabled(enabled: boolean) {
            primary?.setDisabled(!enabled);
        },
    };
}

/** A labelled text field. */
export function textRow(
    el: HTMLElement,
    label: string,
    options: { value?: string; placeholder?: string; password?: boolean; desc?: string },
    onChange: (value: string) => void
): void {
    const setting = new Setting(el).setName(label);
    if (options.desc) setting.setDesc(options.desc);
    setting.addText((text) => {
        text.setValue(options.value ?? "").onChange(onChange);
        if (options.placeholder) text.setPlaceholder(options.placeholder);
        if (options.password) {
            text.inputEl.type = "password";
            // A passphrase typed on a phone is typed once and cannot be read
            // back, so the usual helpers are actively harmful here.
            text.inputEl.autocapitalize = "off";
            text.inputEl.spellcheck = false;
        }
    });
}

/** A labelled switch. */
export function toggleRow(
    el: HTMLElement,
    label: string,
    options: { value: boolean; desc?: string },
    onChange: (value: boolean) => void
): void {
    const setting = new Setting(el).setName(label);
    if (options.desc) setting.setDesc(options.desc);
    setting.addToggle((toggle) => toggle.setValue(options.value).onChange(onChange));
}
