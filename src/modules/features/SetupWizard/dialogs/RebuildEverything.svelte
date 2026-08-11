<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import { $msg as msg } from "@/common/translation";
    import { TYPE_BACKUP_SKIPPED, TYPE_CANCEL, type RebuildEverythingResult } from "./setupDialogTypes";

    /**
     * One consequence, one button.
     *
     * This dialogue used to require three ticked checkboxes and a three-way
     * answer to "have you made a backup?", one branch of which told the reader
     * to abandon the operation and rebuild on a new server instead. Ceremony is
     * not consent: a reader who has to tick three boxes to get past a wall of
     * prose reads none of it, and the `backup` answer was never even examined
     * by the code that ran afterwards.
     */
    type Props = {
        setResult: (result: RebuildEverythingResult) => void;
        getInitialData?: () => { isP2P?: boolean } | undefined;
    };
    const { setResult }: Props = $props();

    function commit() {
        setResult({ backup: TYPE_BACKUP_SKIPPED, extra: { preventFetchingConfig: false } });
    }
</script>

<DialogHeader title={msg("Replace files on server")} />
<Guidance>
    {msg(
        "This vault will overwrite the remote vault. Any changes made on other devices that have not synced to this device will be lost."
    )}
</Guidance>

<UserDecisions>
    <Decision title={msg("Replace files on server")} important commit={() => commit()} />
    <Decision title={msg("Cancel")} commit={() => setResult(TYPE_CANCEL)} />
</UserDecisions>
