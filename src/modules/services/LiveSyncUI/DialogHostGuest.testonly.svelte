<script lang="ts">
    // A stand-in for a real dialogue: it does the one thing they all do, which
    // is read the dialogue context during its own initialisation, and reports
    // what it found through the only channel a guest is given.
    import { getDialogContext } from "@/modules/services/LiveSyncUI/svelteDialog";

    const { setResult, getInitialData }: Record<string, any> = $props();
    const context = getDialogContext();
    setResult({
        hasContext: context !== undefined,
        canSetTitle: typeof context?.setTitle === "function",
        hasServices: context?.services !== undefined,
        initial: getInitialData?.(),
    });
</script>

<div class="guest">mounted</div>
