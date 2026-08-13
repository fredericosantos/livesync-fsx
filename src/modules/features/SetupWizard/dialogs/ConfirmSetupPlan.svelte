<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";

    import { SETUP_UNREACHABLE, type SetupPlan } from "@/modules/features/SetupWizard/setupPlan";
    import { TYPE_APPLY, TYPE_CANCELLED, type SetupPlanResultType } from "./setupDialogTypes";

    type Props = {
        setResult: (result: SetupPlanResultType) => void;
        getInitialData?: () => SetupPlan | undefined;
    };
    const { setResult, getInitialData }: Props = $props();
    const plan = $derived(getInitialData?.());

    // An unreachable server offers nothing to agree to, so there is no
    // confirming button — only the way back.
    const canCommit = $derived(plan !== undefined && plan.action !== SETUP_UNREACHABLE);
</script>

{#if plan}
    <DialogHeader title={plan.headline} />
    <Guidance>
        <p>{plan.detail}</p>
    </Guidance>
    <UserDecisions>
        {#if canCommit}
            <!-- A destructive commit is styled destructive rather than merely
                 left unhighlighted: the reader has to be able to tell the two
                 apart at a glance, not by noticing an absence. -->
            <Decision
                title={plan.confirmLabel}
                important={!plan.isDestructive}
                destructive={plan.isDestructive}
                commit={() => setResult(TYPE_APPLY)}
            />
            <Decision title="Cancel" commit={() => setResult(TYPE_CANCELLED)} />
        {:else}
            <Decision title={plan.confirmLabel} important={true} commit={() => setResult(TYPE_CANCELLED)} />
        {/if}
    </UserDecisions>
{/if}
