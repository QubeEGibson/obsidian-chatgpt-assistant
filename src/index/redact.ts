export function redact(text: string, patterns: string[]): string {
  let out = text;
  for (const p of patterns) {
    try {
      const re = new RegExp(p, "g");
      out = out.replace(re, "[REDACTED]");
    } catch {
      // ignore invalid regex
    }
  }
  return out;
}
