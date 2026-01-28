import { App, Modal, MarkdownRenderer } from "obsidian";

export class MarkdownResultModal extends Modal {
  constructor(app: App, private markdown: string) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.maxHeight = "80vh";
    contentEl.style.overflowY = "auto";
    contentEl.createEl("h3", { text: "VaultPilot Answer" });

    const mdEl = contentEl.createDiv();
    await MarkdownRenderer.render(this.app, this.markdown, mdEl, "", null);
  }

  onClose() {
    this.contentEl.empty();
  }
}
