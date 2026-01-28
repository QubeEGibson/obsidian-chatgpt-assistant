import { App, TFile } from "obsidian";

export interface StyleHints {
  preferredDateFormat: "YYYY-MM-DD" | "MM/DD/YYYY";
  bullet: "-" | "*";
}

export async function inferStyleHints(app: App, samplePaths: string[]): Promise<StyleHints> {
  // Simple heuristic: inspect a few notes for date usage and bullets
  let dateIso = 0;
  let dateSlash = 0;
  let dash = 0;
  let star = 0;

  for (const p of samplePaths) {
    const f = app.vault.getAbstractFileByPath(p);
    if (!(f instanceof TFile)) continue;
    const txt = await app.vault.read(f);

    if (/\b\d{4}-\d{2}-\d{2}\b/.test(txt)) dateIso++;
    if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(txt)) dateSlash++;
    if (/^\s*-\s+/m.test(txt)) dash++;
    if (/^\s*\*\s+/m.test(txt)) star++;
  }

  return {
    preferredDateFormat: dateIso >= dateSlash ? "YYYY-MM-DD" : "MM/DD/YYYY",
    bullet: dash >= star ? "-" : "*"
  };
}
