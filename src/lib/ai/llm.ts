// Thin OpenAI client shared by every reader. The app runs in the browser, so this is plain fetch
// against Chat Completions with a strict JSON schema rather than a server-side SDK.

import { z } from "zod";

export const DEFAULT_MODEL = "gpt-6-luna";

export type Part = { text: string } | { inline: { mimeType: string; data: string } };

function toContent(parts: Part[]) {
  return parts.map((p) => {
    if ("text" in p) return { type: "text", text: p.text };
    const url = `data:${p.inline.mimeType};base64,${p.inline.data}`;
    return p.inline.mimeType.startsWith("image/")
      ? { type: "image_url", image_url: { url } }
      : { type: "file", file: { filename: "document.pdf", file_data: url } };
  });
}

/** Runs one prompt and returns the response parsed against `schema`. */
export async function generateJson<S extends z.ZodType>(opts: { apiKey: string; model: string; system: string; parts: Part[]; schema: S }): Promise<z.infer<S>> {
  const { $schema: _omit, ...jsonSchema } = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: toContent(opts.parts) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: jsonSchema } },
    }),
  });
  if (!res.ok) {
    const detail = await res.json().then((j) => j?.error?.message as string | undefined).catch(() => undefined);
    throw new Error(`OpenAI ${res.status}: ${detail ?? res.statusText}`);
  }
  const body = await res.json();
  const choice = body.choices?.[0];
  const text: string | undefined = choice?.message?.content;
  if (!text) throw new Error(`OpenAI returned no output (${choice?.message?.refusal ?? choice?.finish_reason ?? "unknown"})`);
  return opts.schema.parse(JSON.parse(text));
}
