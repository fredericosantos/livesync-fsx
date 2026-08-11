import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";

type MaintenancePrerequisiteSettings = Pick<
    ObsidianLiveSyncSettings,
    "readChunksOnline"
>;

type MaintenancePrerequisiteOptions = {
    operationName: string;
    settings: MaintenancePrerequisiteSettings;
    askSelectStringDialogue: (
        message: string,
        buttons: readonly ["Apply and continue", "Cancel"],
        options: { title: string; defaultAction: "Cancel" }
    ) => Promise<"Apply and continue" | "Cancel" | false | undefined>;
    applyPartial: (settings: Partial<ObsidianLiveSyncSettings>, saveImmediately?: boolean) => Promise<void>;
};

export async function ensureLocalDatabaseMaintenancePrerequisites({
    operationName,
    settings,
    askSelectStringDialogue,
    applyPartial,
}: MaintenancePrerequisiteOptions): Promise<boolean> {
    const requiredSettings = {
        readChunksOnline: false,
    } satisfies MaintenancePrerequisiteSettings;

    const missing = settings.readChunksOnline ? ["- Fetch chunks on demand: Off (currently On)"] : [];

    if (missing.length == 0) return true;

    // Applied, not requested. Reading chunks on demand cannot be left on while
    // the database is being reorganised, so "Apply and continue" against
    // "Cancel" was a question with one workable answer — and the setting it
    // asks about is not one this fork puts on the settings page at all.
    await applyPartial(requiredSettings, true);
    return true;
}
