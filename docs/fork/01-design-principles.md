# Design principles

The interface is redesigned from first principles. The existing layout is not a
constraint and is not a reference.

## 1. Silence is the default state

**A working system shows nothing.** When sync is healthy and current, the status
bar is empty. Not a checkmark, not a green dot, not "Synced" — empty.

Permanent indicators are a tax on attention that never pays out. A user who sees
"syncing!" every second of every day learns to ignore that region of the screen,
which means the one time it matters, they miss it. An indicator that is always
present carries no information.

The old status line was:

```
Sync: ⚡ ↑ 12 (LIVE) ↓ 5 (LIVE) ⏳ 0 🛫 0 📬 0
```

Six emoji and five counters, four of them reading `0` almost always.

## 2. Three states, in strict priority

| State | When | Presentation |
| --- | --- | --- |
| **Idle** | Healthy and current | Nothing. Empty string. |
| **Activity** | Real work in flight, > 1s | Muted, transient, no icon |
| **Attention** | Needs a human decision | Persistent until resolved |

Attention always outranks activity. A conflict during an active transfer reads
"2 conflicts", never "Syncing".

Activity is suppressed below a latency threshold. Work that finishes in 200 ms
must not flash — a flicker is noise, and noise is worse than silence.

## 3. No emoji

Emoji are not an icon set. They render differently on every platform, carry
unintended connotations, cannot be recoloured to match a theme, ignore font
weight, and are illegible at status-bar size.

Where a glyph genuinely aids scanning, use Obsidian's built-in Lucide icons,
which inherit theme colour and weight. Otherwise use words.

## 4. Words over symbols

`⏳ 0 🛫 0 📬 0` requires a decoder ring. "Uploading 3 files" does not.

Prefer a short noun phrase. Sentence case, never Title Case. No exclamation
marks. State what is true, not how the system feels about it.

## 5. Colour carries one meaning

Colour is reserved for states needing attention, and only for those. Nothing
routine is coloured. Never encode meaning in colour alone — always pair it with
text, so the message survives colour blindness and monochrome themes.

Use Obsidian's theme variables (`--text-muted`, `--text-error`,
`--text-warning`), never fixed hex values. The plugin must look native in both
light and dark themes and in third-party themes.

## 6. Progressive disclosure

Default view shows what a working user needs. Everything else is one deliberate
step away.

Settings are tiered: **Basic** (~8), **Advanced** (~25), **Expert** (the rest).
Tiers are a property of each setting, declared once, not four booleans
(`useAdvancedMode`, `usePowerUserMode`, `useEdgeCaseMode`, `enableDebugTools`)
that the user must discover and combine.

## 7. Destructive actions look destructive

Rebuild, Fetch, and Wipe discard data. They are visually separated from routine
controls, state their consequence in the confirmation ("This deletes every
document on the remote server"), and never sit adjacent to a safe control that
looks the same.

Conversely, safe and reversible actions must not be dressed in warning styling.
Crying wolf trains users to click through real warnings.

## 8. Errors say what to do

"Some mismatches have been detected in the configuration between devices" is a
statement about the program's internal state. It cost this project's own author
a full evening of investigation.

The replacement names the offending key, both values, and the fix:

> `customChunkSize` differs — this device 60, remote preferred 0.
> [Use this device's value] [Use remote value]

Every error message answers: what is wrong, which thing, and what do I do.

## 9. Native, not branded

The plugin is a guest in Obsidian. Use Obsidian's own components, spacing scale,
and type ramp. Do not introduce a separate visual identity, custom fonts, or a
brand colour. The best outcome is that the settings pane is indistinguishable
from Obsidian's own.

## 10. Typography and rhythm

Restraint over decoration:

- One type scale, inherited from Obsidian.
- Weight for hierarchy, not size — and only two weights.
- Generous whitespace. Grouping comes from space, not from boxes and rules.
- Left-align. Centred body text is harder to scan.
- Sentence case everywhere, including buttons and headings.
