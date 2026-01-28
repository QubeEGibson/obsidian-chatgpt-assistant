import { App, TFile } from "obsidian";

export interface Chunk {
  chunkId: string;
  notePath: string;
  heading: string;
  startLine: number;
  endLine: number;
  text: string;
}

function normalizeHeading(h: string): string {
  return h.trim() || "ROOT";
}

// Chunk strategy:
// - Use Obsidian headings when available
// - Further split large sections by character count with overlap
export async function chunkFile(app: App, file: TFile, maxChunkChars: number, overlapChars: number): Promise<Chunk[]> {
  const notePath = file.path;
  const content = await app.vault.read(file);
  const lines = content.split("\n");

  // Map line -> active heading (simple parse)
  let currentHeading = "ROOT";
  const sections: { heading: string; startLine: number; endLine: number; text: string }[] = [];
  let sectionStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(#{1,6})\s+(.*)\s*$/.exec(line);
    if (m) {
      // close previous section
      const prevText = lines.slice(sectionStart, i).join("\n").trim();
      if (prevText.length > 0) {
        sections.push({
          heading: normalizeHeading(currentHeading),
          startLine: sectionStart,
          endLine: i - 1,
          text: prevText
        });
      }
      currentHeading = m[2] || "ROOT";
      sectionStart = i;
    }
  }
  // last section
  const lastText = lines.slice(sectionStart).join("\n").trim();
  if (lastText.length > 0) {
    sections.push({
      heading: normalizeHeading(currentHeading),
      startLine: sectionStart,
      endLine: lines.length - 1,
      text: lastText
    });
  }

  // Now sub-chunk by size
  const chunks: Chunk[] = [];
  for (const s of sections) {
    if (s.text.length <= maxChunkChars) {
      chunks.push({
        chunkId: `${notePath}::${s.heading}::${s.startLine}-${s.endLine}`,
        notePath,
        heading: s.heading,
        startLine: s.startLine,
        endLine: s.endLine,
        text: s.text
      });
      continue;
    }

    let start = 0;
    const text = s.text;
    while (start < text.length) {
      const end = Math.min(text.length, start + maxChunkChars);
      const slice = text.slice(start, end).trim();
      const chunkStartLine = s.startLine; // approximation; precise mapping would require char->line mapping
      const chunkEndLine = s.endLine;

      chunks.push({
        chunkId: `${notePath}::${s.heading}::${chunkStartLine}-${chunkEndLine}::${start}-${end}`,
        notePath,
        heading: s.heading,
        startLine: chunkStartLine,
        endLine: chunkEndLine,
        text: slice
      });

      if (end >= text.length) break;
      start = Math.max(0, end - overlapChars);
    }
  }

  return chunks;
}
