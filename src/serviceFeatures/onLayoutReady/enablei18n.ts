import { createServiceFeature } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { __onMissingTranslation } from "@/common/translation";

/**
 * Keeps the message catalogue quiet.
 *
 * This fork ships one language. What was here before detected Obsidian's
 * language, switched to a matching translation, then raised a Notice — "your
 * language is available" — leading to a dialogue offering to revert to the
 * default, plus a reminder object with its own unload handler. With nothing to
 * detect and nothing to choose between, all that remains is suppressing the
 * missing-translation warnings for keys the English catalogue does not carry.
 */
export const enableI18nFeature = createServiceFeature(() => {
    __onMissingTranslation(() => {});
    return Promise.resolve(true);
});
