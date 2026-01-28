import { App, Notice, Plugin, PluginSettingTab, Setting, MarkdownView } from "obsidian";
import { DEFAULT_SETTINGS, VaultPilotSettings } from "./settings";
import { OpenAIClient } from "./openai/OpenAIClient";
import { makeDb } from "./storage/db";
import { VaultIndexer } from "./index/indexer";
import { AskModal } from "./ui/AskModal";
import { MarkdownResultModal } from "./ui/MarkdownResultModal";
import { topKByEmbedding } from "./index/retriever";
import { VaultQAOutputSchema } from "./openai/schemas";
import { ApiKeyModal } from "./ui/ApiKeyModal";

function vaultIdFromApp(app: App): string {
	// Best-effort stable identifier: vault name
	// If you want stronger: hash basePath (desktop only). Keeping simple + cross-platform.
	// @ts-ignore
	return (app.vault.getName?.() ?? "default").replace(/\W+/g, "_");
}

export default class VaultPilotPlugin extends Plugin {
	settings!: VaultPilotSettings;

	public apiKeyCache: string | null = null;

	private db = makeDb("default");
	private openai!: OpenAIClient;
	private indexer!: VaultIndexer;

	async onload() {
		await this.loadSettings();

		// Best effort: template folder detection (does not depend on API key)
		const detected = this.tryDetectTemplatesFolder();
		if (detected && detected !== this.settings.templatesFolder) {
			if (!this.settings.templatesFolder || this.settings.templatesFolder === "99_Templates") {
				this.settings.templatesFolder = detected;
				if (!this.settings.excludeFolders.includes(detected)) this.settings.excludeFolders.push(detected);
				await this.saveSettings();
			}
		}

		// DB per-vault
		this.db = makeDb(vaultIdFromApp(this.app));

		// OpenAI client must exist even if key is missing (commands will gate)
		this.openai = new OpenAIClient(
			() => this.getApiKeySync(),
			() => this.settings.openaiBaseUrl
		);

		// Indexer can be created; it will only call OpenAI when commands/events run
		this.indexer = new VaultIndexer(this.app, this.db, this.openai, () => this.settings);

		// Settings tab must always load
		this.addSettingTab(new VaultPilotSettingTab(this.app, this));

		// Warm cache (never block plugin load)
		try {
			await this.refreshApiKeyCache();
		} catch {
			this.apiKeyCache = null;
		}

		this.addCommand({
			id: "vaultpilot-reindex",
			name: "VaultPilot: Reindex allowed folders",
			callback: async () => {
				await this.refreshApiKeyCache();
				if (!this.apiKeyCache) {
					new Notice("VaultPilot: No API key loaded. Set a fallback key in VaultPilot settings.");
					return;
				}
				try {
					await this.indexer.fullReindex();
					new Notice("VaultPilot: Reindex complete");
				} catch (e: any) {
					new Notice(`VaultPilot: Reindex failed: ${e.message ?? e}`);
				}
			}
		});

		this.addCommand({
			id: "vaultpilot-ask",
			name: "VaultPilot: Ask vault (with citations)",
			callback: async () => {
				await this.refreshApiKeyCache();
				if (!this.apiKeyCache) {
					new Notice("VaultPilot: No API key loaded. Set a fallback key in VaultPilot settings.");
					return;
				}

				const q = await new AskModal(this.app).openAndGetValue();
				if (!q) return;

				try {
					const answer = await this.answerWithCitations(q);
					new MarkdownResultModal(this.app, answer).open();
				} catch (e: any) {
					new Notice(`VaultPilot: Ask failed: ${e.message ?? e}`);
				}
			}
		});

		this.addCommand({
			id: "vaultpilot-meeting-assist",
			name: "VaultPilot: Meeting assist (create meeting + people notes)",
			callback: async () => {
				await this.refreshApiKeyCache();
				if (!this.apiKeyCache) {
					new Notice("VaultPilot: No API key loaded. Set a fallback key in VaultPilot settings.");
					return;
				}

				const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
				const active = this.app.workspace.getActiveFile();
				if (!active) return;

				const text = mdView?.editor?.getValue?.() ?? (await this.app.vault.read(active));

				const { runMeetingAutomation } = await import("./automation/meeting");
				await runMeetingAutomation(this.app, this.openai, () => this.settings, active, text);
			}
		});

		if (this.settings.enableAutoIndexOnChange) {
			this.registerEvent(this.app.vault.on("modify", (f) => this.indexer.onFileModified(f)));
			this.registerEvent(this.app.vault.on("delete", (f) => this.indexer.onFileDeleted(f)));
			this.registerEvent(this.app.vault.on("create", (f) => this.indexer.onFileCreated(f)));
		}
	}

	onunload() { }

	private async answerWithCitations(question: string): Promise<string> {
		// 1) Embed the question
		const qEmb = await this.openai.embed(this.settings.embeddingModel, question);

		// 2) Retrieve candidates from IndexedDB
		const all = await this.db.chunks.toArray();
		const top = topKByEmbedding(qEmb, all, 8);

		// 3) Build context
		const context = top.map((c, i) => {
			return `CHUNK ${i + 1}\nchunkId: ${c.id}\nnotePath: ${c.notePath}\nheading: ${c.heading}\ntext:\n${c.text}\n`;
		}).join("\n---\n");

		// 4) Ask model with structured output
		const resp = await this.openai.respond({
			model: this.settings.model,
			input: [
				{
					role: "system",
					content:
						"You answer questions using ONLY the provided CHUNK context. " +
						"If the answer is not in the context, say you don't have enough information. " +
						"Return citations that reference the notePath and chunkId you used. " +
						"When possible, include a short quote in each citation."
				},
				{
					role: "user",
					content: `Question:\n${question}\n\nContext:\n${context}`
				}
			],
			text: {
				format: {
					type: "json_schema",
					name: VaultQAOutputSchema.name,
					strict: VaultQAOutputSchema.strict,
					schema: VaultQAOutputSchema.schema
				}
			}
		});

		console.log("[VaultPilot] resp.output_text:", resp?.output_text);
		console.log("[VaultPilot] resp.output:", resp?.output);

		const out = extractJsonFromResponse(resp);
		if (!out) {
			console.error("[VaultPilot] Could not extract structured JSON. Full resp:", resp);
			throw new Error("No structured output JSON returned (could not parse response).");
		}

		const citations = (out.citations || []) as any[];
		const renderedCites = citations.map((c: any) => {
			const link = `[[${String(c.notePath).replace(/\.md$/i, "")}]]`;
			const quote = c.quote ? `> ${String(c.quote).trim()}` : "";
			return `- ${link} (chunk: \`${c.chunkId}\`)\n${quote ? quote : ""}`;
		}).join("\n");

		return `${out.answer_markdown}\n\n---\n### Citations\n${renderedCites || "- (none)"}\n`;
	}

	private secretsApi() {
		const s: any = (this.app as any).secrets;
		// Some builds may use get/set rather than getSecret/setSecret.
		const get = s?.getSecret ?? s?.get;
		const set = s?.setSecret ?? s?.set;
		const list = s?.listSecrets ?? s?.list;
		return { raw: s, get, set, list };
	}

	public async refreshApiKeyCache(): Promise<void> {
		const { get } = this.secretsApi();
		const id = this.settings.apiKeySecretId?.trim();

		// Prefer Keychain if plugin API exists and id is set
		if (typeof get === "function" && id) {
			try {
				const v = await get.call((this.app as any).secrets, id);
				const key = (typeof v === "string") ? v.trim() : "";
				this.apiKeyCache = key.length > 0 ? key : null;
				return;
			} catch {
				// fall through to fallback key
			}
		}

		// Fallback to plugin-stored key
		const fallback = (this.settings.openaiApiKeyFallback ?? "").trim();
		this.apiKeyCache = fallback.length > 0 ? fallback : null;
	}

	private getApiKeySync(): string {
		return this.apiKeyCache ?? "";
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}

	private tryDetectTemplatesFolder(): string | null {
		try {
			const templatesPlugin: any = (this.app as any).internalPlugins?.getPluginById?.("templates");
			const enabled = templatesPlugin?.enabled;
			if (!enabled) return null;

			const folder = templatesPlugin?.instance?.options?.folder;
			if (typeof folder === "string" && folder.trim().length > 0) return folder.trim();
			return null;
		} catch {
			return null;
		}
	}
}

class VaultPilotSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: VaultPilotPlugin) {
		super(app, plugin);
	}

	display(): void {
		void this.displayAsync();
	}

	async displayAsync(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "VaultPilot Settings" });

		const secretsApi = (this.plugin as any).secretsApi?.();
		const hasKeychainApi = typeof secretsApi?.get === "function";
		const canList = typeof secretsApi?.list === "function";

		// Keychain selector
		if (hasKeychainApi) {
			if (canList) {
				let ids: string[] = [];
				try {
					ids = await secretsApi.list.call(secretsApi.raw);
				} catch {
					ids = [];
				}

				new Setting(containerEl)
					.setName("Keychain entry")
					.setDesc("Select which Keychain secret VaultPilot should use for the OpenAI API key.")
					.addDropdown(d => {
						const current = this.plugin.settings.apiKeySecretId?.trim();
						const all = new Set(ids);
						if (current) all.add(current);

						for (const id of Array.from(all).sort()) d.addOption(id, id);

						d.setValue(current || "");
						d.onChange(async (v) => {
							this.plugin.settings.apiKeySecretId = v.trim();
							await this.plugin.saveSettings();
							await this.plugin.refreshApiKeyCache();
							this.display();
						});
					});
			} else {
				new Setting(containerEl)
					.setName("Keychain entry id")
					.setDesc("Type the Keychain secret id. (This Obsidian build can’t enumerate Keychain entries.)")
					.addText(t => {
						t.setValue(this.plugin.settings.apiKeySecretId || "");
						t.onChange(async (v) => {
							this.plugin.settings.apiKeySecretId = v.trim();
							await this.plugin.saveSettings();
							await this.plugin.refreshApiKeyCache();
							this.display();
						});
					});
			}
		} else {
			new Setting(containerEl)
				.setName("Keychain access")
				.setDesc("Keychain APIs are not available in this Obsidian build. VaultPilot will use the fallback API key below.");
		}

		new Setting(containerEl)
			.setName("Fallback API key (used when Keychain isn’t available)")
			.setDesc("Stored in VaultPilot plugin data. Prefer Keychain when supported by your Obsidian version.")
			.addButton(b => b.setButtonText("Set key…").setCta().onClick(async () => {
				const modal = new ApiKeyModal(this.app);
				const key = await modal.openAndGetValue();
				if (!key) return;

				this.plugin.settings.openaiApiKeyFallback = key.trim();
				await this.plugin.saveSettings();
				await this.plugin.refreshApiKeyCache();
				new Notice("VaultPilot: Fallback API key saved.");
				this.display(); // refresh UI
			}))
			.addButton(b => b.setButtonText("Clear fallback").onClick(async () => {
				this.plugin.settings.openaiApiKeyFallback = "";
				await this.plugin.saveSettings();
				await this.plugin.refreshApiKeyCache();
				new Notice("VaultPilot: Fallback API key cleared.");
				this.display();
			}));

		await this.plugin.refreshApiKeyCache();
		new Setting(containerEl)
			.setName("API key loaded")
			.setDesc(this.plugin.apiKeyCache ? "Yes" : "No");


		new Setting(containerEl)
			.setName("Model")
			.addText(t => {
				t.setValue(this.plugin.settings.model);
				t.onChange(async (v) => {
					this.plugin.settings.model = v.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Embedding model")
			.addText(t => {
				t.setValue(this.plugin.settings.embeddingModel);
				t.onChange(async (v) => {
					this.plugin.settings.embeddingModel = v.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Index folders (comma-separated)")
			.setDesc("Allowlist. Leave empty to index entire vault (not recommended).")
			.addText(t => {
				t.setValue(this.plugin.settings.indexFolders.join(", "));
				t.onChange(async (v) => {
					this.plugin.settings.indexFolders = v.split(",").map(x => x.trim()).filter(Boolean);
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Exclude folders (comma-separated)")
			.addText(t => {
				t.setValue(this.plugin.settings.excludeFolders.join(", "));
				t.onChange(async (v) => {
					this.plugin.settings.excludeFolders = v.split(",").map(x => x.trim()).filter(Boolean);
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Templates folder")
			.setDesc("Folder containing templates (e.g., 99_Templates).")
			.addText(t => {
				t.setValue(this.plugin.settings.templatesFolder);
				t.onChange(async (v) => {
					this.plugin.settings.templatesFolder = v.trim();
					// keep excluded in sync
					if (this.plugin.settings.templatesFolder && !this.plugin.settings.excludeFolders.includes(this.plugin.settings.templatesFolder)) {
						this.plugin.settings.excludeFolders.push(this.plugin.settings.templatesFolder);
					}
					await this.plugin.saveSettings();
				});
			})
			.addButton(b => b.setButtonText("Detect").onClick(async () => {
				const detected = (this.plugin as any).tryDetectTemplatesFolder?.() as string | null;
				if (!detected) {
					new Notice("VaultPilot: Could not detect Templates folder (Templates plugin disabled or unknown).");
					return;
				}
				this.plugin.settings.templatesFolder = detected;
				if (!this.plugin.settings.excludeFolders.includes(detected)) this.plugin.settings.excludeFolders.push(detected);
				await this.plugin.saveSettings();
				this.display();
				new Notice(`VaultPilot: Templates folder set to ${detected}`);
			}));

		new Setting(containerEl)
			.setName("Person template file")
			.setDesc("Template file name within Templates folder (e.g., Person.md).")
			.addText(t => {
				t.setValue(this.plugin.settings.personTemplateFile);
				t.onChange(async (v) => {
					this.plugin.settings.personTemplateFile = v.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Meeting template file")
			.setDesc("Template file name within Templates folder (e.g., Meeting.md).")
			.addText(t => {
				t.setValue(this.plugin.settings.meetingTemplateFile);
				t.onChange(async (v) => {
					this.plugin.settings.meetingTemplateFile = v.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("People folder")
			.addText(t => {
				t.setValue(this.plugin.settings.peopleFolder);
				t.onChange(async (v) => {
					this.plugin.settings.peopleFolder = v.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Meetings folder")
			.addText(t => {
				t.setValue(this.plugin.settings.meetingsFolder);
				t.onChange(async (v) => {
					this.plugin.settings.meetingsFolder = v.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Enable auto-index on change")
			.addToggle(t => {
				t.setValue(this.plugin.settings.enableAutoIndexOnChange);
				t.onChange(async (v) => {
					this.plugin.settings.enableAutoIndexOnChange = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Enable meeting automation")
			.addToggle(t => {
				t.setValue(this.plugin.settings.enableMeetingAutomation);
				t.onChange(async (v) => {
					this.plugin.settings.enableMeetingAutomation = v;
					await this.plugin.saveSettings();
				});
			});
	}
}

function extractJsonFromResponse(resp: any): any | null {
  // 1) If the response already has parsed output (some wrappers/SDKs do this)
  if (resp?.output_parsed && typeof resp.output_parsed === "object") return resp.output_parsed;

  // 2) If there's a top-level output_text, try parsing it as JSON
  if (typeof resp?.output_text === "string") {
    const s = resp.output_text.trim();
    if (s) {
      try { return JSON.parse(s); } catch { /* ignore */ }
    }
  }

  // 3) Walk output items -> message content parts and parse first JSON-looking text
  const items = Array.isArray(resp?.output) ? resp.output : [];
  for (const item of items) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      // Most common: part.text is a string
      const t = typeof part?.text === "string" ? part.text.trim() : "";
      if (!t) continue;

      try { return JSON.parse(t); } catch { /* ignore */ }
    }
  }

  return null;
}