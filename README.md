# VaultPilot (Obsidian Plugin)

Local-first vault Q&A + template-aware automations using OpenAI. Stores embeddings in IndexedDB.

## Install (dev)
1. Copy this repo into your vault: `.obsidian/plugins/vaultpilot/`
2. `npm install`
3. `npm run build`
4. In Obsidian: Settings → Community plugins → enable VaultPilot

## Usage
- Command Palette:
  - "VaultPilot: Reindex allowed folders"
  - "VaultPilot: Ask vault (with citations)"
  - "VaultPilot: Meeting assist (create meeting + people notes)"

## Privacy
By default, only retrieved chunks are sent to OpenAI (not your full vault).
Use frontmatter `ai: false` to opt-out individual notes.
