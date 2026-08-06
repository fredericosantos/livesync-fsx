/**
 * What makes a device name usable.
 *
 * This is not cosmetic validation. Customisation Sync builds document keys by
 * interpolating the name directly into a path — see `CmdConfigSync`, which
 * composes `${ICXHeader}${term}/${category}/${name}.md` and, for binary
 * entries, `${ICXHeader}${term}/${category}/${name}%${baseName}`. A name
 * containing either delimiter produces keys that parse back into the wrong
 * fields, so the characters have to be refused at the point of entry.
 */

export const DEVICE_NAME_MAX = 60;

export type DeviceNameProblem =
    | { readonly kind: "empty" }
    | { readonly kind: "reserved-character"; readonly character: string }
    | { readonly kind: "too-long" }
    | { readonly kind: "taken" };

export interface DeviceNameVerdict {
    readonly ok: boolean;
    readonly problem?: DeviceNameProblem;
    /** Ready to show under the field. Empty when the name is fine. */
    readonly message: string;
}

const OK: DeviceNameVerdict = { ok: true, message: "" };

/** Delimiters in the Customisation Sync document key. */
const RESERVED = ["/", "%"];

export function validateDeviceName(raw: string, takenNames: readonly string[] = []): DeviceNameVerdict {
    const name = raw.trim();

    if (name === "") {
        return {
            ok: false,
            problem: { kind: "empty" },
            message: "Give this device a name. Other devices use it to tell your vaults apart.",
        };
    }

    const reserved = RESERVED.find((character) => name.includes(character));
    if (reserved) {
        return {
            ok: false,
            problem: { kind: "reserved-character", character: reserved },
            message: `A device name cannot contain "${reserved}". Try a hyphen or a space instead.`,
        };
    }

    if (name.length > DEVICE_NAME_MAX) {
        return {
            ok: false,
            problem: { kind: "too-long" },
            message: `Keep it under ${DEVICE_NAME_MAX} characters.`,
        };
    }

    // Compared case-insensitively: two devices called "Air" and "air" would be
    // indistinguishable to a reader even though the keys would differ.
    const collision = takenNames.find((taken) => taken.trim().toLowerCase() === name.toLowerCase());
    if (collision !== undefined) {
        return {
            ok: false,
            problem: { kind: "taken" },
            message: `Another device is already called "${collision}". Names must be unique.`,
        };
    }

    return OK;
}
