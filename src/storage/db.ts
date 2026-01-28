// src/storage/db.ts
import Dexie, { Table } from "dexie";
import { ChunkRecord, NoteRecord } from "./types";

export class VaultPilotDB extends Dexie {
  chunks!: Table<ChunkRecord, string>;
  notes!: Table<NoteRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      chunks: "id, notePath, mtime, hash",
      notes: "notePath, mtime, indexedAt"
    });
  }
}

export function makeDb(vaultId: string): VaultPilotDB {
  return new VaultPilotDB(`vaultpilot_${vaultId}`);
}
