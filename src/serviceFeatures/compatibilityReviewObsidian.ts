import { Notice } from "@/deps.ts";
import type { Confirm } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import type { CompatibilityPause } from "@/common/databaseCompatibility.ts";
import type {
    CompatibilityReviewDetailsAction,
    CompatibilityReviewSummaryAction,
    CompatibilityReviewUi,
} from "./compatibilityReview.ts";
import {
    compatibilityReviewDetailsMarkdown,
    compatibilityReviewSummaryMarkdown,
} from "./compatibilityReviewMarkdown.ts";

const REVIEW_DETAILS = "Show details";
const KEEP_PAUSED = "Leave it paused";
const RESUME = "Resume syncing";
const BACK = "Back";

export class ObsidianCompatibilityReviewUi implements CompatibilityReviewUi {
    private reminder: Notice | undefined;

    constructor(private readonly confirm: Confirm) {}

    async showSummary(pause: CompatibilityPause): Promise<CompatibilityReviewSummaryAction> {
        const buttons = !pause.resumable
            ? ([REVIEW_DETAILS, KEEP_PAUSED] as const)
            : ([REVIEW_DETAILS, RESUME, KEEP_PAUSED] as const);
        const result = await this.confirm.confirmWithMessage(
            "Why syncing is held back",
            compatibilityReviewSummaryMarkdown(pause),
            [...buttons],
            KEEP_PAUSED,
            undefined,
            "vertical"
        );
        if (result === REVIEW_DETAILS) return "details";
        if (result === RESUME) return "resume";
        if (result === KEEP_PAUSED) return "keep-paused";
        return false;
    }

    async showDetails(pause: CompatibilityPause): Promise<CompatibilityReviewDetailsAction> {
        const result = await this.confirm.confirmWithMessage(
            "The details",
            compatibilityReviewDetailsMarkdown(pause),
            [BACK],
            BACK,
            undefined,
            "vertical"
        );
        if (result === BACK) return "back";
        return false;
    }

    clearReminder(): void {
        this.reminder?.hide();
        this.reminder = undefined;
    }
}

export function createObsidianCompatibilityReviewUi(confirm: Confirm): CompatibilityReviewUi {
    return new ObsidianCompatibilityReviewUi(confirm);
}
