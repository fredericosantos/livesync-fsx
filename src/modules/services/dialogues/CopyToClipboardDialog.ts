/**
 * Showing a value that has to get to another device.
 *
 * A setup link is too long to read aloud and too long to retype, so the only
 * useful thing a dialogue can do with it is put it on the clipboard. The button
 * says whether that has happened, and nothing else here has an opinion.
 */

import { App, Modal, Setting } from "@/deps.ts";
import { guidance } from "./parts.ts";

export function promptCopyToClipboard(app: App, title: string, value: string): Promise<boolean> {
    return new Promise((resolve) => {
        const modal = new (class extends Modal {
            private copied = false;

            override onOpen(): void {
                this.titleEl.setText(`Copy the ${title || "text"}`);
                guidance(this.contentEl, `Copy this and paste it into ${title ? "the other device" : "where you need it"}.`);

                const box = this.contentEl.createEl("textarea", { cls: "lsfsx-dialog__copyable" });
                box.value = value;
                box.readOnly = true;
                box.rows = 4;

                new Setting(this.contentEl).addButton((button) =>
                    button
                        .setButtonText("Copy")
                        .setCta()
                        .onClick(async () => {
                            await navigator.clipboard.writeText(value);
                            this.copied = true;
                            // The button reports its own result rather than a
                            // note appearing below it: the reader is looking at
                            // the thing they just pressed.
                            button.setButtonText("Copied");
                        })
                );
            }

            override onClose(): void {
                this.contentEl.empty();
                resolve(this.copied);
            }
        })(app);
        modal.open();
    });
}
