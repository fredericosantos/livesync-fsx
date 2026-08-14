/**
 * How the status icon disappeared, twice, in one release.
 *
 * Neither failure was a wrong value, a type error or a lint error — 587 tests
 * passed through both. They were facts about *wiring*: what notifies whom, and
 * when. So these tests pin the wiring rules rather than any particular caller,
 * because the code that broke them has been fixed and the rules are what the
 * next mistake will break.
 *
 * The behaviour below is `octagonal-wheels`' own, verified against its
 * implementation rather than assumed.
 */

import { describe, expect, it, vi } from "vitest";
import { reactive, reactiveSource } from "octagonal-wheels/dataobject/reactive";

describe("what a reactive source notifies, and when", () => {
    it("registers its dependants when the derived value is created, not on first read", () => {
        const source = reactiveSource(1);
        const derived = reactive(() => source.value * 2);
        const heard = vi.fn();
        derived.onChanged(heard);

        source.value = 2;

        expect(heard).toHaveBeenCalled();
        expect(derived.value).toBe(4);
    });

    /**
     * The rule that makes "paint only on change" fragile.
     *
     * A source marked dirty stays dirty until something reads it, and a write
     * to an already-dirty source updates the value *without* rippling. So a
     * listener that never reads back can be told once and then go quiet while
     * the value keeps moving.
     */
    it("goes quiet after one notification until someone reads the value back", () => {
        const source = reactiveSource(0);
        const heard = vi.fn();
        reactive(() => source.value).onChanged(heard);

        source.value = 1;
        source.value = 2;
        source.value = 3;

        expect(heard).toHaveBeenCalledTimes(1);
    });

    it("notifies again once the value has been read", () => {
        const source = reactiveSource(0);
        const derived = reactive(() => source.value);
        const heard = vi.fn();
        derived.onChanged(heard);

        source.value = 1;
        void derived.value; // the read is what clears the dirty flag
        source.value = 2;

        expect(heard).toHaveBeenCalledTimes(2);
    });
});

describe("painting a status only when it changes", () => {
    it("never shows the state a session begins in", () => {
        // The second bug, in miniature. The status bar item was created already
        // carrying the hidden class and repainted from `onChanged` alone, so a
        // vault that started disconnected and stayed disconnected showed no
        // icon at all. The state most worth reporting is the one that never
        // varies, and that is precisely the one this arrangement cannot show.
        const status = reactive(() => "offline");
        const paint = vi.fn();

        status.onChanged(() => paint(status.value));

        expect(paint).not.toHaveBeenCalled();
    });

    it("shows it when the first paint is done from the loaded value", () => {
        const status = reactive(() => "offline");
        const paint = vi.fn();

        // What `ModuleLog` now does: paint once from what is already there,
        // then follow changes as before.
        paint(status.value);
        status.onChanged(() => paint(status.value));

        expect(paint).toHaveBeenCalledWith("offline");
    });
});
