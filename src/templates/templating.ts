// Very small placeholder engine:
// - {{key}} replaces with value
// - {{#if key}}...{{/if}} supports presence check
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let out = template;

  // if blocks
  out = out.replace(/{{#if\s+([\w.-]+)\s*}}([\s\S]*?){{\/if}}/g, (_, key: string, inner: string) => {
    const v = vars[key];
    return v && v.trim().length > 0 ? inner : "";
  });

  // simple vars
  out = out.replace(/{{\s*([\w.-]+)\s*}}/g, (_, key: string) => {
    return vars[key] ?? "";
  });

  return out;
}

export function slugifyFileName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
