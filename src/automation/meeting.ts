import { App, Notice, TFile } from "obsidian";
import { OpenAIClient } from "../openai/OpenAIClient";
import { VaultPilotSettings } from "../settings";
import { VaultQAOutputSchema, MeetingExtractSchema, PersonExtractSchema } from "../openai/schemas";
import { renderTemplate, slugifyFileName } from "../templates/templating";
import { extractStructuredJson } from "../openai/extract";

function todayISO(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function toWikiLink(path: string): string {
    // [[path without .md]]
    return `[[${path.replace(/\.md$/i, "")}]]`;
}

async function readTemplateFromTemplatesFolder(app: App, templatesFolder: string, fileName: string): Promise<string> {
    const path = `${templatesFolder}/${fileName}`.replace(/\/+/g, "/");
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`Template not found: ${path}`);
    return await app.vault.read(f);
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
    const parts = folderPath.split("/").filter(Boolean);
    let current = "";
    for (const p of parts) {
        current = current ? `${current}/${p}` : p;
        const existing = app.vault.getAbstractFileByPath(current);
        if (!existing) await app.vault.createFolder(current);
    }
}

async function findPersonNote(app: App, peopleFolder: string, fullName: string): Promise<TFile | null> {
    const target = `${peopleFolder}/${slugifyFileName(fullName)}.md`;
    const af = app.vault.getAbstractFileByPath(target);
    return af instanceof TFile ? af : null;
}

async function createPersonNote(app: App, settings: VaultPilotSettings, fullName: string, notes: string): Promise<TFile> {
    await ensureFolder(app, settings.peopleFolder);
    const path = `${settings.peopleFolder}/${slugifyFileName(fullName)}.md`;
    const tpl = await readTemplateFromTemplatesFolder(app, settings.templatesFolder, settings.meetingTemplateFile);


    const content = renderTemplate(tpl, {
        full_name: fullName,
        notes,
        created: todayISO()
    });

    return await app.vault.create(path, content);
}

async function createMeetingNote(app: App, settings: VaultPilotSettings, data: any, attendeeLinks: string[]): Promise<TFile> {
    await ensureFolder(app, settings.meetingsFolder);
    const date = data.date && data.date.trim().length > 0 ? data.date.trim() : todayISO();
    const title = data.title?.trim() || "Meeting";
    const fileName = slugifyFileName(`${date} ${title}`);
    const path = `${settings.meetingsFolder}/${fileName}.md`;

    const tpl = await readTemplateFromTemplatesFolder(app, settings.templatesFolder, settings.meetingTemplateFile);

    const content = renderTemplate(tpl, {
        title,
        date,
        start_time: data.startTime || "",
        attendees: attendeeLinks.join(", "),
        summary: data.summary || "",
        decisions: (data.decisions || []).map((d: string) => `- ${d}`).join("\n"),
        action_items: (data.action_items || []).map((a: string) => `- ${a}`).join("\n"),
        created: todayISO()
    });

    const existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
        await app.vault.modify(existing, content);
        return existing;
    }
    return await app.vault.create(path, content);
}

export async function runMeetingAutomation(
    app: App,
    openai: OpenAIClient,
    getSettings: () => VaultPilotSettings,
    activeFile: TFile | null,
    activeText: string
) {
    const s = getSettings();
    if (!s.enableMeetingAutomation) return;
    if (!activeFile) throw new Error("No active file");

    // 1) Extract meeting metadata from the current note text
    const extract = await openai.respond({
        model: s.model,
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
                content: activeText
            }
        ],
        text: {
            format: {
                type: "json_schema",
                name: MeetingExtractSchema.name,
                strict: MeetingExtractSchema.strict,
                schema: MeetingExtractSchema.schema
            }
        }
    });

    console.log("[VaultPilot] Responses output_text:", extract?.output_text);
    console.log("[VaultPilot] Responses output:", extract?.output);  

    const meetingJson = extractStructuredJson(extract);
    if (!meetingJson) {
    console.error("[VaultPilot] Meeting automation: could not extract structured JSON. Full resp:", extract);
    throw new Error("Meeting extraction failed (no structured output).");
    }

    // 2) Extract per-person notes (optional enrichment) from the active note
    const peopleExtract = await openai.respond({
        model: s.model,
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
                content: `Attendees: ${(meetingJson.attendees || []).join(", ")}\n\nNotes:\n${activeText}`
            }
        ],
        text: {
            format: {
                type: "json_schema",
                name: PersonExtractSchema.name,
                strict: PersonExtractSchema.strict,
                schema: PersonExtractSchema.schema
            }
        }
    });

    const peopleJson = peopleExtract.output?.[0]?.content?.[0]?.json ?? peopleExtract.output_json ?? null;
    const people = (peopleJson?.people || []) as { fullName: string; notes: string }[];

    // 3) Ensure person notes exist
    const attendeeLinks: string[] = [];
    for (const name of (meetingJson.attendees || []) as string[]) {
        const fullName = name.trim();
        if (!fullName) continue;

        let note = await findPersonNote(app, s.peopleFolder, fullName);

        if (!note) {
            const personNotes = people.find(p => p.fullName.toLowerCase() === fullName.toLowerCase())?.notes || "";
            note = await createPersonNote(app, s, fullName, personNotes);
            new Notice(`Created person note: ${note.path}`);
        }

        attendeeLinks.push(toWikiLink(note.path));
    }

    // 4) Create meeting note
    const meetingFile = await createMeetingNote(app, s, meetingJson, attendeeLinks);
    new Notice(`Meeting note ready: ${meetingFile.path}`);

    // 5) Optionally: update active note with a link to the meeting note (append)
    const meetingLink = toWikiLink(meetingFile.path);
    const updated = `${activeText.trim()}\n\n---\nMeeting note: ${meetingLink}\n`;
    await app.vault.modify(activeFile, updated);
}
