import { describe, expect, it } from "vitest";
import { mount, unmount, type Component } from "svelte";
import DialogHost from "./DialogHost.svelte";
import Guest from "./DialogHostGuest.testonly.svelte";
import { setupDialogContext } from "./svelteDialog";

/**
 * Every dialogue in the plugin — the setup wizard, the setup URI, the QR code —
 * is a guest component mounted inside `DialogHost`, and each reads the dialogue
 * context during its own initialisation.
 *
 * This exists because that stopped working and the only symptom was an empty
 * window: Svelte threw `lifecycle_outside_component` and nothing was rendered.
 */
/** What the stand-in guest reports back through `setResult`. */
interface GuestReport {
    hasContext: boolean;
    canSetTitle: boolean;
    hasServices: boolean;
    initial: unknown;
}

describe("DialogHost", () => {
    it("mounts a guest that reads the dialogue context while initialising", () => {
        const target = document.createElement("div");
        document.body.appendChild(target);

        let seen: GuestReport | undefined;
        // The host takes its props from whichever dialogue it is hosting, so
        // they are deliberately loose at this boundary; the assertions below,
        // not the types, are what this test is for.
        const host = mount(DialogHost as unknown as Component<Record<string, unknown>>, {
            target,
            props: {
                setTitle: () => {},
                closeDialog: () => {},
                setResult: (value: GuestReport) => (seen = value),
                getInitialData: () => "initial",
                mountComponent: Guest,
                onSetupContext: (props: Record<string, unknown>) =>
                    setupDialogContext({ ...props, context: {}, services: {} } as Parameters<
                        typeof setupDialogContext
                    >[0]),
            },
        });

        expect(target.querySelector(".dialog-host"), "the host itself did not render").not.toBeNull();
        expect(target.querySelector(".guest"), "the guest component did not render").not.toBeNull();
        expect(seen?.hasContext, "the guest could not read the dialogue context").toBe(true);
        expect(seen?.canSetTitle, "the dialogue context carried no controls").toBe(true);
        expect(seen?.hasServices, "the dialogue context carried no services").toBe(true);
        expect(seen?.initial).toBe("initial");

        void unmount(host);
    });
});
