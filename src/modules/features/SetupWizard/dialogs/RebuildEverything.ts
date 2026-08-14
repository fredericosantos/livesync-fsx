/**
 * One consequence, one button.
 *
 * This dialogue used to require three ticked checkboxes and a three-way answer
 * to "have you made a backup?", one branch of which told the reader to abandon
 * the operation and rebuild on a new server instead. Ceremony is not consent: a
 * reader who has to tick three boxes to get past a wall of prose reads none of
 * it, and the `backup` answer was never even examined by the code that ran
 * afterwards.
 */

import type { DialogBuilder } from "@/modules/services/dialogues/DialogManager.ts";
import { decisions, guidance } from "@/modules/services/dialogues/parts.ts";
import { TYPE_BACKUP_SKIPPED, TYPE_CANCEL, type RebuildEverythingResult } from "./setupDialogTypes.ts";
import { $msg as msg } from "@/common/translation";

export const rebuildEverything: DialogBuilder<RebuildEverythingResult> = (el, control) => {
    control.setTitle(msg("Replace files on server"));
    guidance(
        el,
        msg(
            "This vault will overwrite the remote vault. Any changes made on other devices that have not synced to this device will be lost."
        )
    );
    decisions(
        el,
        { label: msg("Cancel"), onClick: () => control.commit(TYPE_CANCEL) },
        {
            label: msg("Replace files on server"),
            destructive: true,
            onClick: () => control.commit({ backup: TYPE_BACKUP_SKIPPED, extra: { preventFetchingConfig: false } }),
        }
    );
};
