/**
 * The largest file that may be synchronised.
 *
 * Stored as a number of megabytes, which is why it used to be a text box
 * labelled "Maximum file size" with "(MB)" appended and `0` meaning "no limit".
 * Three things wrong with that: zero is not a size, the unit is the storage
 * format rather than anything the reader thinks in, and a free-text number
 * invites 5000 when the answer wanted was "about a gigabyte".
 *
 * So: a switch for whether there is a limit at all, and the sizes people
 * actually mean, as chips. Anything else is still reachable — the last chip
 * opens a box — because a limit is exactly the setting somebody will have a
 * specific number for.
 */

import { LiveSyncSetting as Setting } from "@/modules/features/SettingDialogue/LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "@/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts";

/** The offered sizes, in megabytes, with the words for them. */
const SIZES: readonly { readonly label: string; readonly mb: number }[] = [
    { label: "1 MB", mb: 1 },
    { label: "10 MB", mb: 10 },
    { label: "100 MB", mb: 100 },
    { label: "1 GB", mb: 1024 },
    { label: "10 GB", mb: 10240 },
    { label: "100 GB", mb: 102400 },
];

/**
 * What the switch is off for.
 *
 * Zero is the stored value for "no limit", and it is also what a reader would
 * type to mean "nothing may sync". Nothing may ever save it from this control:
 * turning the limit off writes zero, and every path that writes a size writes
 * a size.
 */
const NO_LIMIT = 0;

/** The size to offer when the limit is switched on for the first time. */
const DEFAULT_LIMIT_MB = 100;

export function renderFileSizeLimit(tab: ObsidianLiveSyncSettingTab, el: HTMLElement): void {
    const container = el.createDiv();

    const draw = () => {
        container.empty();
        const current = tab.editingSettings.syncMaxSizeInMB ?? NO_LIMIT;
        const limited = current > NO_LIMIT;

        const save = async (mb: number) => {
            tab.editingSettings.syncMaxSizeInMB = mb;
            await tab.saveSettings(["syncMaxSizeInMB"]);
            draw();
        };

        new Setting(container)
            .setName("Do not sync files over a specified size")
            .setDesc("Larger files stay on the device they are on. Nothing is deleted.")
            .addToggle((toggle) =>
                toggle.setValue(limited).onChange((value) => void save(value ? DEFAULT_LIMIT_MB : NO_LIMIT))
            );

        if (!limited) return;

        const chips = container.createDiv({ cls: "lsfsx-chips" });
        const isPreset = SIZES.some((size) => size.mb === current);

        for (const size of SIZES) {
            const chip = chips.createEl("button", { cls: "lsfsx-chip-button", text: size.label });
            chip.type = "button";
            chip.toggleClass("is-selected", current === size.mb);
            chip.setAttribute("aria-pressed", String(current === size.mb));
            chip.addEventListener("click", () => void save(size.mb));
        }

        const custom = chips.createEl("button", { cls: "lsfsx-chip-button", text: "Custom" });
        custom.type = "button";
        custom.toggleClass("is-selected", !isPreset);
        custom.setAttribute("aria-pressed", String(!isPreset));
        // Selecting "Custom" while a preset is chosen keeps that number as the
        // starting point, so the box opens on the size the reader can see
        // rather than on an empty field or a zero.
        custom.addEventListener("click", () => void save(current));

        if (isPreset) return;

        new Setting(container).setName("Size in megabytes").addText((text) =>
            text
                .setValue(`${current}`)
                .onChange(async (value) => {
                    const mb = Number(value);
                    // Rejected rather than corrected: a half-typed "1" on the
                    // way to "150" must not be saved as a one-megabyte limit,
                    // and redrawing on every keystroke would take the field
                    // away mid-word.
                    if (!Number.isFinite(mb) || mb <= NO_LIMIT) return;
                    tab.editingSettings.syncMaxSizeInMB = mb;
                    await tab.saveSettings(["syncMaxSizeInMB"]);
                })
        );
    };

    draw();
}
