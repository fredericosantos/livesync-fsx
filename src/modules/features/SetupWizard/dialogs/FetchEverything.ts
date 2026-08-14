/**
 * One consequence, one button.
 *
 * The reader used to be asked to classify their own vault — "almost identical
 * to the server's", "empty or only new files", "there may be differences" — so
 * that the plugin could choose a scan strategy. That is an implementation
 * question wearing a user's clothes, and getting it wrong silently costs data.
 *
 * `unbalanced` is the answer that is never wrong: it recreates the metadata for
 * every file and lets identical content resolve itself. It is slower than the
 * other two and correct in every case, which is the right trade for something
 * run once when synchronisation has already gone wrong.
 */

import type { DialogBuilder } from "@/modules/services/dialogues/DialogManager.ts";
import { decisions, guidance } from "@/modules/services/dialogues/parts.ts";
import { TYPE_BACKUP_SKIPPED, TYPE_CANCEL, TYPE_UNBALANCED, type FetchEverythingResult } from "./setupDialogTypes.ts";
import { $msg as translateMessage } from "@/common/translation";

export const fetchEverything: DialogBuilder<FetchEverythingResult> = (el, control) => {
    control.setTitle(translateMessage("Replace files on this device"));
    guidance(
        el,
        translateMessage(
            "The remote vault will overwrite this vault. Any changes made here that have not synced to the server are kept as a second copy of the file."
        )
    );
    decisions(
        el,
        { label: translateMessage("Cancel"), onClick: () => control.commit(TYPE_CANCEL) },
        {
            label: translateMessage("Replace files on this device"),
            destructive: true,
            onClick: () =>
                control.commit({
                    vault: TYPE_UNBALANCED,
                    backup: TYPE_BACKUP_SKIPPED,
                    extra: { preventFetchingConfig: false },
                }),
        }
    );
};
