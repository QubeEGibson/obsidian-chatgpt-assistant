export function extractStructuredJson(resp: any): any | null {
  // Some SDKs provide parsed output here
  if (resp && typeof resp.output_parsed === "object") return resp.output_parsed;

  // Most reliable for /v1/responses in plugin fetch: output_text is usually the JSON string
  if (typeof resp?.output_text === "string") {
    const s = resp.output_text.trim();
    if (s) {
      try { return JSON.parse(s); } catch { /* ignore */ }
    }
  }

  // Fallback: walk output message content parts and parse first JSON-looking text
  const items = Array.isArray(resp?.output) ? resp.output : [];
  for (const item of items) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const t = typeof part?.text === "string" ? part.text.trim() : "";
      if (!t) continue;
      try { return JSON.parse(t); } catch { /* ignore */ }
    }
  }

  return null;
}
