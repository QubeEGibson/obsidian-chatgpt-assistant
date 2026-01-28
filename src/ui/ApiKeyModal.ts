import { App, Modal, Setting } from "obsidian";

export class ApiKeyModal extends Modal {
  private value = "";
  private resolve!: (v: string | null) => void;

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Set OpenAI API Key" });

    new Setting(contentEl)
      .setName("API Key")
      .setDesc("Stored in VaultPilot settings as a fallback when Keychain APIs aren’t available.")
      .addText(t => {
        t.inputEl.type = "password";
        t.setPlaceholder("sk-...");
        t.onChange(v => (this.value = v.trim()));
        t.inputEl.style.width = "100%";
      });

    new Setting(contentEl)
      .addButton(b =>
        b.setButtonText("Save").setCta().onClick(() => {
          this.close();
          this.resolve(this.value || null);
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
