import { App, Modal, Setting } from "obsidian";

export class AskModal extends Modal {
  private value = "";
  private resolve!: (v: string | null) => void;

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Ask VaultPilot" });

    new Setting(contentEl)
      .setName("Question")
      .addTextArea(t => {
        t.setPlaceholder("Ask a question about your vault…");
        t.onChange(v => (this.value = v));
        t.inputEl.style.width = "100%";
        t.inputEl.style.height = "120px";
      });

    new Setting(contentEl)
      .addButton(b =>
        b.setButtonText("Ask").setCta().onClick(() => {
          this.close();
          this.resolve(this.value.trim() || null);
        })
      )
      .addExtraButton(b =>
        b.setIcon("cross").setTooltip("Cancel").onClick(() => {
          this.close();
          this.resolve(null);
        })
      );
  }

  onClose() {
    this.contentEl.empty();
  }

  async openAndGetValue(): Promise<string | null> {
    return new Promise(resolve => {
      this.resolve = resolve;
      this.open();
    });
  }
}
