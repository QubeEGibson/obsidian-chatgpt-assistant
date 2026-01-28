export interface ChunkRecord {
  id: string;                 // chunkId (stable)
  notePath: string;
  heading: string;
  blockId: string;            // optional anchor we can create for citations
  startLine: number;
  endLine: number;
  text: string;
  mtime: number;
  hash: string;               // hash of text + metadata to detect changes
  embedding: number[];        // stored as array for IndexedDB
}

export interface NoteRecord {
  notePath: string;
  mtime: number;
  indexedAt: number;
}
