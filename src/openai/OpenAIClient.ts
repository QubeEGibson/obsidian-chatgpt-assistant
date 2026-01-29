import { requestUrl } from "obsidian";

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

    try {
      const res = await requestUrl({
        url,
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ model, input })
      });

      const json = JSON.parse(res.text);
      const emb = json?.data?.[0]?.embedding;
      if (!Array.isArray(emb)) {
        throw new Error("Embeddings response missing data[0].embedding");
      }
      return emb;
    } catch (e: any) {
      // 🔴 THIS IS THE IMPORTANT PART
      console.group("[VaultPilot] Embeddings ERROR");
      console.error("Model:", model);
      console.error("Input length:", input?.length);
      console.error("Error object:", e);

      // requestUrl sometimes attaches these:
      console.error("Status:", e?.status);
      console.error("Text:", e?.text);
      console.error("JSON:", e?.json);

      // Sometimes message contains the JSON string
      console.error("Message:", e?.message);

      console.groupEnd();
      throw e;
    }
  }

  async respond(payload: any): Promise<any> {
    const url = `${this.getBaseUrl()}/v1/responses`;

    console.group("[VaultPilot] OpenAI Responses request");
    console.log("URL:", url);
    console.log("Payload:", payload);
    console.groupEnd();

    if ((payload as any).response_format) {
      console.warn("[VaultPilot] response_format is present; this is likely wrong for /v1/responses", (payload as any).response_format);
    }
    if (!(payload as any).text?.format) {
      console.warn("[VaultPilot] text.format missing for /v1/responses", payload);
    }

    try {
      const res = await requestUrl({
        url,
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
        throw: false

      });

      const json = JSON.parse(res.text);
      console.group("[VaultPilot] OpenAI raw response");
      console.log("HTTP status:", res.status);
      console.log("Text:", res.text);
      console.groupEnd();

      if (res.status < 200 || res.status >= 300) {
        try {
          const json = JSON.parse(res.text);
          console.error("[VaultPilot] OpenAI error JSON:", json);
          throw new Error(
            json?.error?.message ??
            json?.message ??
            `OpenAI error ${res.status}`
          );
        } catch {
          throw new Error(`OpenAI error ${res.status}: ${res.text}`);
        }
      }

      try {
        const json = JSON.parse(res.text);

        console.group("[VaultPilot] OpenAI parsed response");
        console.log(json);
        console.groupEnd();

        return json;
      } catch (e) {
        console.error("[VaultPilot] Failed to parse OpenAI response JSON", e);
        throw e;
      }

    } catch (e: any) {
      console.group("[VaultPilot] OpenAI Responses ERROR");
      console.error("Status:", e?.status);
      console.error("Text:", e?.text);
      console.error("JSON:", e?.json);
      console.error("Message:", e?.message);
      console.groupEnd();
      throw e;
    }
  }
}
