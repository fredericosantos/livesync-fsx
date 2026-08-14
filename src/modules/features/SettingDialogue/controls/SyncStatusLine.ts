/**
 * The sync status line, drawn.
 *
 * Everything about *what* it says lives in `syncStatusLineView.ts`; this is
 * only the elements, the icon and the bar.
 */

import { ProgressBarComponent, setIcon } from "@/deps.ts";
import type { ObsidianLiveSyncSettingTab } from "@/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import { ModuleLog } from "@/modules/features/ModuleLog.ts";
import { presentSyncStatusLine } from "./syncStatusLineView.ts";

export function renderSyncStatusLine(tab: ObsidianLiveSyncSettingTab, el: HTMLElement): void {
    let log;
    try {
        log = tab.core.getModule(ModuleLog);
    } catch {
        // `getModule` throws when the module is not loaded. The rest of the
        // page is still worth showing; a missing line is better than a missing
        // settings screen.
        return;
    }
    // Both are built in `observeForLogs`, which has not necessarily run yet.
    if (!log.statusBarLabels || !log.syncProgress) return;

    const line = el.createDiv({ cls: "lsfsx-syncline" });
    const iconEl = line.createSpan({ cls: "lsfsx-syncline__icon" });
    const textEl = line.createSpan({ cls: "lsfsx-syncline__text" });
    // Obsidian's own bar rather than two divs and a width. It is the same
    // element the app uses elsewhere, so it inherits the app's accent, its
    // radius and its reduced-motion behaviour without this file having an
    // opinion about any of them.
    //
    // Always present, never removed: a bar that appears and disappears moves
    // every row beneath it, so the page jumps each time work starts.
    const track = line.createDiv({ cls: "lsfsx-syncline__track" });
    const bar = new ProgressBarComponent(track);

    const draw = () => {
        const view = presentSyncStatusLine(log.statusBarLabels.value, log.syncProgress.value);
        line.dataset.level = view.level;
        iconEl.empty();
        // A drawn glyph, not an emoji: an emoji is a different typeface at a
        // different weight in a different colour, and it would be the only one
        // on the page.
        if (view.icon) setIcon(iconEl, view.icon);
        textEl.setText(view.text);
        track.toggleClass("is-visible", view.progress !== undefined);
        bar.setValue(Math.round((view.progress ?? 0) * 100));
    };

    draw();

    // Torn down with the pane. `display()` empties the container and `hide()`
    // unloads this component, so without unregistering, every visit to the
    // settings page would leave another handler writing into elements that are
    // no longer on screen — and the reactive sources outlive the pane, so those
    // handlers would run on every replication for the rest of the session.
    const redraw = () => draw();
    log.statusBarLabels.onChanged(redraw);
    log.syncProgress.onChanged(redraw);
    tab.lifetimeComponent.register(() => {
        log.statusBarLabels.offChanged(redraw);
        log.syncProgress.offChanged(redraw);
    });
}
