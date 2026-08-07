import { Modal } from "@/deps.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { TOOL_PANES } from "./settingsCatalogue.ts";

export type ToolPaneBody = (
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    funcs: PageFunctions
) => void;

/**
 * Rebuilding a database, reading a log, applying a patch: things you do when
 * something is wrong, not settings you keep. They used to occupy four of the
 * twelve settings tabs, which put "delete the remote database" the same
 * distance from the reader as "sync hidden files".
 *
 * They are still all here, and nothing has been removed — they are one click
 * away instead of nought.
 */
export class ToolsModal extends Modal {
    constructor(
        private readonly tab: ObsidianLiveSyncSettingTab,
        private readonly bodies: Record<string, ToolPaneBody>,
        private readonly funcs: PageFunctions
    ) {
        super(tab.plugin.app);
    }

    override onOpen(): void {
        this.titleEl.setText("Tools");
        this.contentEl.addClass("lsfsx-tools");
        for (const pane of TOOL_PANES) {
            const body = this.bodies[pane.id];
            if (!body) continue;
            const el = this.contentEl.createDiv({ cls: "lsfsx-section" });
            body.call(this.tab, el, this.funcs);
        }
    }

    override onClose(): void {
        this.contentEl.empty();
    }
}
