import { setIcon } from "@/deps.ts";
import { LiveSyncSetting as Setting } from "../LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "../ObsidianLiveSyncSettingTab.ts";
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
    const container = el.createDiv({ cls: "sls-list" });

    const draw = () => {
        container.empty();
        const names = parseIgnoreFileNames(tab.editingSettings.ignoreFiles ?? "");

        const commit = async (next: readonly string[]) => {
            tab.editingSettings.ignoreFiles = serialiseIgnoreFileNames(next);
            await tab.saveSettings(["ignoreFiles"]);
            draw();
        };

        const head = container.createDiv({ cls: "sls-list__head" });
        head.createSpan({ text: "Rule files" });
        head.createSpan({ cls: "sls-list__count", text: `${names.length}` });

        if (names.length === 0) {
            container.createDiv({
                cls: "sls-list__empty",
                text: "No rule files. Nothing is being excluded by ignore rules.",
            });
        }

        for (const name of names) {
            const row = container.createDiv({ cls: "sls-list__row" });
            row.createSpan({ cls: "sls-list__name", text: name });
            const remove = row.createEl("button", { cls: "sls-list__remove" });
            setIcon(remove, "x");
            remove.ariaLabel = `Stop honouring ${name}`;
            remove.addEventListener("click", () => {
                void commit(names.filter((entry) => entry !== name));
            });
        }

        const adder = container.createDiv({ cls: "sls-list__add" });
        const input = adder.createEl("input", { type: "text", cls: "sls-list__input" });
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

    new Setting(el)
        .setName("Path rules")
        .setDesc("Regular expressions applied to paths directly, without a rule file. Under File selection.")
        .setClass("sls-setting-crossref");
}
