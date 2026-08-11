<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import { $msg as translateMessage } from "@/common/translation";
    import { TYPE_BACKUP_SKIPPED, TYPE_CANCEL, TYPE_UNBALANCED, type FetchEverythingResult } from "./setupDialogTypes";

    /**
     * One consequence, one button.
     *
     * The reader used to be asked to classify their own vault — "almost
     * identical to the server's", "empty or only new files", "there may be
     * differences" — so that the plugin could choose a scan strategy. That is
     * an implementation question wearing a user's clothes, and getting it wrong
     * silently costs data.
     *
     * `unbalanced` is the answer that is never wrong: it recreates the metadata
     * for every file and lets identical content resolve itself. It is slower
     * than the other two and correct in every case, which is the right trade
     * for something run once when synchronisation has already gone wrong.
     */
    type Props = { setResult: (result: FetchEverythingResult) => void };
    const { setResult }: Props = $props();

    function commit() {
        setResult({
            vault: TYPE_UNBALANCED,
            backup: TYPE_BACKUP_SKIPPED,
            extra: { preventFetchingConfig: false },
        });
    }
</script>

<DialogHeader title={translateMessage("Replace files on this device")} />
<Guidance>
    {translateMessage(
        "The remote vault will overwrite this vault. Any changes made here that have not synced to the server are kept as a second copy of the file."
    )}
</Guidance>

<UserDecisions>
    <Decision title={translateMessage("Replace files on this device")} important commit={() => commit()} />
    <Decision title={translateMessage("Cancel")} commit={() => setResult(TYPE_CANCEL)} />
</UserDecisions>
