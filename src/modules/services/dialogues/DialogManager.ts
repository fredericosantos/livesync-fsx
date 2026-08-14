/**
 * Opening a dialogue, without a UI framework.
 *
 * The contract this replaces took a *Svelte component* and mounted it inside a
 * host component, which passed it a result callback through Svelte context. So
 * every dialogue in the plug-in — six of them, none complicated — obliged the
 * bundle to carry a reactive framework and the source to carry a host, a mixin,
 * a context key and a session object to bridge between it and Obsidian's
 * `Modal`, which was already a perfectly good dialogue.
 *
 * What a dialogue actually needs is two things: somewhere to draw, and a way to
 * say what the reader chose. That is this file.
 *
 * `build` is called once with the modal's content element. It draws, and calls
 * `commit` when the reader decides. Closing the window without committing is a
 * cancellation, which is what the close button and Escape have always meant.
 */

import { App, Modal } from "@/deps.ts";

export interface DialogControl<TResult> {
    /** The reader decided. Closes the dialogue and resolves the caller. */
    commit(result: TResult): void;
    /** Set the window's title. */
    setTitle(title: string): void;
    /** Close without deciding; the caller sees a cancellation. */
    cancel(): void;
}

/** Draws one dialogue. Called once, with the modal's own content element. */
export type DialogBuilder<TResult, TInitial = undefined> = (
    contentEl: HTMLElement,
    control: DialogControl<TResult>,
    initialData: TInitial
) => void;

class BuiltDialog<TResult, TInitial> extends Modal {
    private settle?: (result: TResult | undefined) => void;
    private readonly closed: Promise<TResult | undefined>;

    constructor(
        app: App,
        private readonly build: DialogBuilder<TResult, TInitial>,
        private readonly initialData: TInitial
    ) {
        super(app);
        this.closed = new Promise((resolve) => (this.settle = resolve));
    }

    override onOpen(): void {
        this.build(this.contentEl, {
            commit: (result) => {
                this.resolve(result);
                this.close();
            },
            setTitle: (title) => this.titleEl.setText(title),
            cancel: () => this.close(),
        }, this.initialData);
    }

    override onClose(): void {
        this.contentEl.empty();
        // Resolves as a cancellation if nothing was committed. Harmless when a
        // result already went out: `resolve` only fires once.
        this.resolve(undefined);
    }

    private resolve(result: TResult | undefined): void {
        const settle = this.settle;
        this.settle = undefined;
        settle?.(result);
    }

    waitForClose(): Promise<TResult | undefined> {
        return this.closed;
    }
}

/**
 * The word the wizard uses for "the reader backed out".
 *
 * A distinct value rather than `undefined`, because the wizard's steps have
 * results of their own and one of them could legitimately be absent.
 */
export const DIALOG_CANCELLED = "cancelled";

export class DialogManager {
    constructor(private readonly app: App) {}

    async open<TResult, TInitial = undefined>(
        build: DialogBuilder<TResult, TInitial>,
        initialData?: TInitial
    ): Promise<TResult | undefined> {
        const dialog = new BuiltDialog<TResult, TInitial>(this.app, build, initialData as TInitial);
        dialog.open();
        return await dialog.waitForClose();
    }

    async openWithExplicitCancel<TResult, TInitial = undefined>(
        build: DialogBuilder<TResult, TInitial>,
        initialData?: TInitial
    ): Promise<TResult | typeof DIALOG_CANCELLED> {
        const result = await this.open(build, initialData);
        return result === undefined ? DIALOG_CANCELLED : result;
    }
}
