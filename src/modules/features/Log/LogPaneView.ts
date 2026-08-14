/**
 * The log, as a pane.
 *
 * This is where the status icon leads, and since the toasts went it is the only
 * place the full text of a failure exists. So it is a reading surface: lines,
 * scrolled, selectable, and nothing else.
 *
 * It was a Svelte component with three checkboxes — wrap, auto-scroll, pause —
 * and a Close button beside a tab that already closes. Wrapping is what a log
 * should always do rather than a preference to set each visit; auto-scroll is
 * what you want unless you have scrolled up, which the pane can simply notice;
 * and pausing a log you are reading is answered by not looking at it. None of
 * the three survived the port, which is most of why the port is shorter than
 * the component's stylesheet was.
 */

import { ItemView, WorkspaceLeaf } from "@/deps.ts";
import type ObsidianLiveSyncPlugin from "@/main.ts";
import { $msg } from "@/common/translation";
import { logMessages } from "@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores";
import { reactive, type ReactiveInstance, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";

export const VIEW_TYPE_LOG = "log-log";

/**
 * How close to the bottom still counts as "at the bottom".
 *
 * Auto-scrolling only while the reader is already at the end is the whole of
 * the removed checkbox: scroll up to read something and the log stops chasing
 * you; scroll back down and it resumes. A few pixels of tolerance because a
 * trackpad rarely lands exactly on zero.
 */
const AT_BOTTOM_TOLERANCE_PX = 32;

export class LogPaneView extends ItemView {
    plugin: ObsidianLiveSyncPlugin;
    override navigation = false;

    private logEl?: HTMLElement;
    private source?: ReactiveValue<string[]>;
    private readonly onLogged = (logs: ReactiveInstance<string[]>) => this.render(logs.value);

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    override getIcon(): string {
        return "view-log";
    }

    getViewType(): string {
        return VIEW_TYPE_LOG;
    }

    getDisplayText(): string {
        return $msg("logPane.title");
    }

    override async onOpen(): Promise<void> {
        await super.onOpen();
        this.contentEl.empty();
        this.logEl = this.contentEl.createDiv({ cls: "lsfsx-log" });
        this.source = reactive(() => logMessages.value);
        this.source.onChanged(this.onLogged);
        this.render(this.source.value);
    }

    override async onClose(): Promise<void> {
        this.source?.offChanged(this.onLogged);
        this.source = undefined;
        this.logEl = undefined;
        await super.onClose();
    }

    private render(lines: readonly string[]): void {
        const el = this.logEl;
        if (!el) return;
        // Measured before the write, because appending changes the answer.
        const followTail = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_TOLERANCE_PX;
        el.empty();
        for (const line of lines) {
            el.createEl("pre", { cls: "lsfsx-log__line", text: line });
        }
        if (followTail) el.scrollTop = el.scrollHeight;
    }
}
