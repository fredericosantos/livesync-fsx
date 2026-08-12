import { setIcon } from "@/deps.ts";
import type { ObsidianLiveSyncSettingTab } from "@/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import { parseIgnoreFileNames, serialiseIgnoreFileNames } from "./ignoreFileNames.ts";

/**
 * Which gitignore-style files to honour.
 *
 * Note what this setting is *not*: it does not list the files that are excluded
 * from synchronisation. It lists the names of rule files — `.gitignore`,
 * `.dockerignore` — whose contents do the excluding. Upstream stored it as one
 * comma-separated string in a textarea, which made a list of two or three short
 * tokens look like free prose.
 */
export function renderIgnoreFileList(tab: ObsidianLiveSyncSettingTab, el: HTMLElement): void {
    const container = el.createDiv({ cls: "lsfsx-list" });

    const draw = () => {
        container.empty();
        const names = parseIgnoreFileNames(tab.editingSettings.ignoreFiles ?? "");

        const commit = async (next: readonly string[]) => {
            tab.editingSettings.ignoreFiles = serialiseIgnoreFileNames(next);
            await tab.saveSettings(["ignoreFiles"]);
            draw();
        };

        const head = container.createDiv({ cls: "lsfsx-list__head" });
        head.createSpan({ text: "Rule files" });
        head.createSpan({ cls: "lsfsx-list__count", text: `${names.length}` });

        if (names.length === 0) {
            container.createDiv({
                cls: "lsfsx-list__empty",
                text: "No rule files. Nothing is being excluded by ignore rules.",
            });
        }

        for (const name of names) {
            const row = container.createDiv({ cls: "lsfsx-list__row" });
            row.createSpan({ cls: "lsfsx-list__name", text: name });
            const remove = row.createEl("button", { cls: "lsfsx-list__remove" });
            setIcon(remove, "x");
            remove.ariaLabel = `Stop honouring ${name}`;
            remove.addEventListener("click", () => {
                void commit(names.filter((entry) => entry !== name));
            });
        }

        const adder = container.createDiv({ cls: "lsfsx-list__add" });
        const input = adder.createEl("input", { type: "text", cls: "lsfsx-list__input" });
        input.placeholder = ".gitignore";
        const add = adder.createEl("button", { text: "Add" });
        const submit = () => {
            const value = input.value.trim();
            if (value === "" || names.includes(value)) {
                input.value = "";
                return;
            }
            void commit([...names, value]);
        };
        add.addEventListener("click", submit);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                submit();
            }
        });
    };

    draw();
}
