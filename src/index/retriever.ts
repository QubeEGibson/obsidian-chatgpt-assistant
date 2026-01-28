import { ChunkRecord } from "../storage/types";

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function topKByEmbedding(query: number[], candidates: ChunkRecord[], k: number): ChunkRecord[] {
  const scored = candidates.map(c => ({ c, s: cosineSimilarity(query, c.embedding) }));
  scored.sort((x, y) => y.s - x.s);
  return scored.slice(0, k).map(x => x.c);
}
