<script lang="ts">
    // A stand-in for a real dialogue: it does the one thing they all do, which
    // is read the dialogue context during its own initialisation, and reports
    // what it found through the only channel a guest is given.
    import { untrack } from "svelte";
    import { getDialogContext } from "@/modules/services/LiveSyncUI/svelteDialog";

    // Read inside `untrack`, deliberately. Props are reactive, so Svelte warns
    // when one is read during initialisation — "did you mean to reference it
    // inside a closure?" — and here the answer is no: reporting exactly once,
    // synchronously, while initialising is the behaviour under test. `untrack`
    // says that in the language of the framework instead of silencing it.
    interface Props {
        setResult: (report: {
            hasContext: boolean;
            canSetTitle: boolean;
            hasServices: boolean;
            initial: unknown;
        }) => void;
        getInitialData?: () => unknown;
    }
    const props: Props = $props();
    const context = getDialogContext();
    untrack(() =>
        props.setResult({
            hasContext: context !== undefined,
            canSetTitle: typeof context?.setTitle === "function",
            hasServices: context?.services !== undefined,
            initial: props.getInitialData?.(),
        })
    );
</script>

<div class="guest">mounted</div>
