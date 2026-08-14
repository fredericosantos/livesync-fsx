/**
 * The one screen that says what setup is about to do, before it does it.
 */

import type { DialogBuilder } from "@/modules/services/dialogues/DialogManager.ts";
import { decisions, guidance } from "@/modules/services/dialogues/parts.ts";
import { SETUP_UNREACHABLE, type SetupPlan } from "@/modules/features/SetupWizard/setupPlan.ts";
import { TYPE_APPLY, TYPE_CANCELLED, type SetupPlanResultType } from "./setupDialogTypes.ts";

export const confirmSetupPlan: DialogBuilder<SetupPlanResultType, SetupPlan> = (el, control, plan) => {
    control.setTitle(plan.headline);
    guidance(el, plan.detail);

    // An unreachable server offers nothing to agree to, so there is no
    // confirming button — only the way back.
    if (plan.action === SETUP_UNREACHABLE) {
        decisions(el, { label: plan.confirmLabel, primary: true, onClick: () => control.commit(TYPE_CANCELLED) });
        return;
    }

    decisions(
        el,
        { label: "Cancel", onClick: () => control.commit(TYPE_CANCELLED) },
        {
            // A destructive commit is styled destructive rather than merely
            // left unhighlighted: the reader has to be able to tell the two
            // apart at a glance, not by noticing an absence.
            label: plan.confirmLabel,
            primary: !plan.isDestructive,
            destructive: plan.isDestructive,
            onClick: () => control.commit(TYPE_APPLY),
        }
    );
};
