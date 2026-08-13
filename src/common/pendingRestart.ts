/**
 * Settings arrived from another device that Obsidian only reads at start-up.
 *
 * A plug-in whose files changed can simply be reloaded, and is. Obsidian's own
 * preferences cannot: the app read them when it opened, and the copy in memory
 * is the one in force until it opens again.
 *
 * That used to be a prompt — "Other Obsidian settings files were updated." with
 * a "Schedule an Obsidian restart" button. It is a real thing to know and the
 * wrong way to say it: a restart takes the window away, so it must be the
 * reader's decision, made when they are between things rather than when a
 * replication happened to finish. So it waits in the status icon instead, which
 * is where everything else that wants attention waits.
 */

import { reactiveSource } from "octagonal-wheels/dataobject/reactive";

/** True once settings arrived that this Obsidian will not read until restarted. */
export const restartToApplySettings = reactiveSource(false);
