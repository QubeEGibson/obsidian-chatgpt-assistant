export class OpenAIClient {
  constructor(
    private getApiKey: () => string,
    private getBaseUrl: () => string
  ) { }

  private headers() {
    const key = this.getApiKey();
    if (!key) throw new Error("Missing OpenAI API key");
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    };
  }

  async embed(model: string, input: string): Promise<number[]> {
    const url = `${this.getBaseUrl()}/v1/embeddings`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model, input })
    });
    if (!res.ok) throw new Error(`Embeddings error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.data[0].embedding as number[];
  }

  async respond(payload: any): Promise<any> {
    const url = `${this.getBaseUrl()}/v1/responses`;

    // 🔍 LOG REQUEST (safe to copy)
    console.group("[VaultPilot] OpenAI Responses request");
    console.log("URL:", url);
    console.log("Payload:", payload);
    console.groupEnd();

    let res: Response;
    let text: string;

    try {
      res = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.error("[VaultPilot] Network error calling OpenAI", e);
      throw e;
    }

    text = await res.text();

    // 🔍 LOG RAW RESPONSE (always log before parsing)
    console.group("[VaultPilot] OpenAI raw response");
    console.log("HTTP status:", res.status);
    console.log("Raw text:", text);
    console.groupEnd();

    if (!res.ok) {
      // Try to parse JSON error if possible
      try {
        const json = JSON.parse(text);
        console.error("[VaultPilot] OpenAI error JSON:", json);
        throw new Error(
          json?.error?.message ??
          json?.message ??
          `OpenAI error ${res.status}`
        );
      } catch {
        console.error("[VaultPilot] OpenAI error (non-JSON):", text);
        throw new Error(`OpenAI error ${res.status}: ${text}`);
      }
    }

    try {
      const json = JSON.parse(text);

      // 🔍 LOG PARSED RESPONSE
      console.group("[VaultPilot] OpenAI parsed response");
      console.log(json);
      console.groupEnd();

      return json;
    } catch (e) {
      console.error("[VaultPilot] Failed to parse OpenAI response JSON", e);
      throw e;
    }
  }
}
