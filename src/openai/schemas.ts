export const VaultQAOutputSchema = {
  name: "VaultQAOutput",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer_markdown: { type: "string" },
      citations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            notePath: { type: "string" },
            heading: { type: "string" },
            blockId: { type: "string" },
            chunkId: { type: "string" },
            quote: { type: "string" }
          },
          required: ["notePath", "heading", "blockId", "chunkId", "quote"]
        }
      }
    },
    required: ["answer_markdown", "citations"]
  }
};

export const MeetingExtractSchema = {
  name: "MeetingExtract",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      date: { type: "string", description: "ISO date YYYY-MM-DD if known, else empty string" },
      startTime: { type: "string", description: "Optional time like 09:30, else empty string" },
      attendees: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
      decisions: { type: "array", items: { type: "string" } },
      action_items: { type: "array", items: { type: "string" } }
    },
    required: ["title", "date", "startTime", "attendees", "summary", "decisions", "action_items"]
  }
};

export const PersonExtractSchema = {
  name: "PersonExtract",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      people: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            fullName: { type: "string" },
            notes: { type: "string" }
          },
          required: ["fullName", "notes"]
        }
      }
    },
    required: ["people"]
  }
};
