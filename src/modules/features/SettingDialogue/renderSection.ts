/**
 * How a catalogue section becomes a group of controls.
 *
 * There is one rule: a key is rendered from its schema entry — upstream already
 * supplies the name, the description and the default, and the type of that
 * default decides the control. Only keys that genuinely cannot be expressed
 * that way (a name that must be validated, a masked passphrase, a list that
 * would otherwise be a comma-separated string) get an entry in `KEY_RENDERERS`,
 * and only copy we deliberately disagree with gets an entry in `COPY`.
 *
 * Panes used to do this by hand, which is how "Appearance" ended up rendered
 * twice and how two adjacent groups ended up with different spacing.
 */

import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import { visibleOnly } from "./SettingPane.ts";
import type { SettingKey, SettingSection } from "./settingsCatalogue.ts";
import { AllSettingDefault, type AllSettingItemKey } from "./settingConstants.ts";
import { renderPassphrase } from "./controls/Passphrase.ts";
import { renderIgnoreFileList } from "./controls/IgnoreFileList.ts";

type KeyRenderer = (tab: ObsidianLiveSyncSettingTab, el: HTMLElement) => void;

/** Copy we deliberately override, applied after the schema name and description. */
const COPY: Partial<Record<SettingKey, { name: string; desc?: string }>> = {
    // The eight category settings are no longer rendered one-to-one; five rows
    // cover them, and their names live with the grouping that produces them in
    // `controls/ConfigCategories.ts`.
    encrypt: {
        name: "Encrypt this vault",
        desc: "Every device must use the same passphrase, or they cannot read each other's notes.",
    },
    useIgnoreFiles: {
        name: "Use ignore files",
        desc: "Skip anything excluded by a gitignore-style file in the vault.",
    },
};

const KEY_RENDERERS: Partial<Record<SettingKey, KeyRenderer>> = {
    // Meaningless while encryption is off, so it is not shown then. A disabled
    // field would still invite the reader to wonder what it is for.
    passphrase: (tab, el) =>
        renderPassphrase(
            tab,
            el,
            visibleOnly(() => tab.isConfiguredAs("encrypt", true))
        ),
    ignoreFiles: (tab, el) => renderIgnoreFileList(tab, el),
};

/**
 * The default control for a key: whatever its schema default's type implies.
 * A key whose default is not a primitive has no generic control and must be
 * listed in `KEY_RENDERERS`; rendering nothing silently is how a setting ends
 * up on the page as a name with no way to change it.
 */
function renderKey(tab: ObsidianLiveSyncSettingTab, el: HTMLElement, key: SettingKey): void {
    const custom = KEY_RENDERERS[key];
    if (custom) {
        custom(tab, el);
        return;
    }
    const itemKey = key as SettingKey & AllSettingItemKey;
    const setting = new Setting(el);
    switch (typeof AllSettingDefault[itemKey]) {
        case "boolean":
            setting.autoWireToggle(itemKey as never);
            break;
        case "number":
            setting.autoWireNumeric(itemKey as never, {});
            break;
        case "string":
            setting.autoWireText(itemKey as never);
            break;
        default:
            throw new Error(`No control for setting "${key}"; add one to KEY_RENDERERS.`);
    }
    const copy = COPY[key];
    if (copy) {
        setting.setName(copy.name);
        if (copy.desc) setting.setDesc(copy.desc);
    }
}

export function renderSection(tab: ObsidianLiveSyncSettingTab, el: HTMLElement, section: SettingSection): void {
    for (const key of section.keys) {
        renderKey(tab, el, key);
    }
}
