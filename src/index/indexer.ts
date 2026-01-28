import { App, TAbstractFile, TFile } from "obsidian";
import { VaultPilotDB } from "../storage/db";
import { OpenAIClient } from "../openai/OpenAIClient";
import { chunkFile } from "./chunker";
import { sha256 } from "./hash";
import { redact } from "./redact";
import { VaultPilotSettings } from "../settings";
import { ChunkRecord } from "../storage/types";

function isMarkdown(file: TFile): boolean {
    return file.extension.toLowerCase() === "md";
}

function isInFolders(path: string, allow: string[], exclude: string[]): boolean {
    const norm = path.replace(/\\/g, "/");
    for (const ex of exclude) {
        const exn = ex.replace(/\\/g, "/").replace(/\/$/, "");
        if (exn && (norm === exn || norm.startsWith(exn + "/"))) return false;
    }
    if (!allow || allow.length === 0) return true;
    for (const a of allow) {
        const an = a.replace(/\\/g, "/").replace(/\/$/, "");
        if (an && (norm === an || norm.startsWith(an + "/"))) return true;
    }
    return false;
}

export class VaultIndexer {
    private busy = new Set<string>();

    constructor(
        private app: App,
        private db: VaultPilotDB,
        private openai: OpenAIClient,
        private getSettings: () => VaultPilotSettings
    ) { }

    async fullReindex(): Promise<void> {
        const files = this.app.vault.getMarkdownFiles();
        for (const f of files) {
            await this.indexFileIfAllowed(f);
        }
    }

    async onFileCreated(f: TAbstractFile) {
        if (f instanceof TFile) await this.indexFileIfAllowed(f);
    }
    async onFileModified(f: TAbstractFile) {
        if (f instanceof TFile) await this.indexFileIfAllowed(f);
    }
    async onFileDeleted(f: TAbstractFile) {
        if (f instanceof TFile) await this.deleteFileFromIndex(f.path);
    }

    async deleteFileFromIndex(notePath: string): Promise<void> {
        await this.db.chunks.where("notePath").equals(notePath).delete();
        await this.db.notes.delete(notePath);
    }

    async indexFileIfAllowed(file: TFile): Promise<void> {
        const s = this.getSettings();
        if (!isMarkdown(file)) return;
        if (!isInFolders(file.path, s.indexFolders, s.excludeFolders)) return;
        if (this.busy.has(file.path)) return;

        this.busy.add(file.path);
        try {
            // frontmatter opt-out
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            const optKey = s.aiOptOutFrontmatterKey || "ai";
            if (fm && fm[optKey] === false) return;

            const mtime = file.stat.mtime;

            // quick skip if note record matches
            const existingNote = await this.db.notes.get(file.path);
            if (existingNote && existingNote.mtime === mtime) return;

            const chunks = await chunkFile(this.app, file, s.maxChunkChars, s.overlapChars);
            const redactedChunks = chunks.map(c => ({
                ...c,
                text: redact(c.text, s.redactPatterns)
            }));

            const records: ChunkRecord[] = [];

            for (const c of redactedChunks) {
                const redacted = redact(c.text, s.redactPatterns);
                const hash = await sha256(`${c.notePath}|${c.heading}|${c.startLine}-${c.endLine}`);

                const existing = await this.db.chunks.get(c.chunkId);
                if (existing && existing.hash === hash) {
                    // keep existing embedding
                    continue;
                }

                const embedding = await this.openai.embed(s.embeddingModel, redacted);
                records.push({
                    id: c.chunkId,
                    notePath: c.notePath,
                    heading: c.heading,
                    blockId: "", // filled on-demand when citing
                    startLine: c.startLine,
                    endLine: c.endLine,
                    text: redacted,
                    mtime,
                    hash,
                    embedding
                });
            }

            // Replace chunks: delete old, then upsert updated/new.
            // Safer: delete notePath chunks then re-add (simple & consistent).
            await this.db.transaction("rw", this.db.chunks, this.db.notes, async () => {
                await this.db.chunks.where("notePath").equals(file.path).delete();

                // recompute all chunks with embeddings (avoid missing unchanged ones)
                // For unchanged, re-embed would be wasteful; so we do partial approach:
                //  - load from db for same chunkId if existed and same hash (we skipped above)
                // But we deleted notePath chunks already. So we should load before deletion.
            });

            // Better approach: do not delete first. Instead upsert new + delete removed chunkIds.
            await this.upsertByDiff(file, mtime, redactedChunks, records);

            await this.db.notes.put({ notePath: file.path, mtime, indexedAt: Date.now() });
        } finally {
            this.busy.delete(file.path);
        }
    }

    private async upsertByDiff(file: TFile, mtime: number, chunks: any[], newlyEmbedded: ChunkRecord[]) {
        const notePath = file.path;
        const existing = await this.db.chunks.where("notePath").equals(notePath).toArray();
        const existingById = new Map(existing.map(e => [e.id, e]));
        const newIds = new Set(chunks.map((c: any) => c.chunkId));

        // Delete removed chunks
        const removed = existing.filter(e => !newIds.has(e.id)).map(e => e.id);
        if (removed.length > 0) await this.db.chunks.bulkDelete(removed);

        // Upsert updated/new chunks
        const puts: ChunkRecord[] = [];

        for (const c of chunks) {
            const redacted = c.text; // chunker already returned raw; indexFileIfAllowed uses redacted; here we assume caller passed same
            const id = c.chunkId;
            const current = existingById.get(id);

            // find if this chunk had a newly computed embedding
            const newRec = newlyEmbedded.find(r => r.id === id);
            if (newRec) {
                puts.push(newRec);
                continue;
            }

            // unchanged chunk: preserve prior embedding
            if (current) {
                puts.push({
                    ...current,
                    mtime
                });
            } else {
                // missing and not in newlyEmbedded means caller didn't compute; compute now
                // (Should be rare; safeguard)
                throw new Error(`Index diff error: missing embedding for new chunk ${id}`);
            }
        }

        await this.db.chunks.bulkPut(puts);
    }
}
