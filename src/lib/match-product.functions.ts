import { createServerFn } from "@tanstack/react-start";

type MatchInput = {
  image: string; // base64 JPEG (no data: prefix)
  products: { id: string; name: string }[];
};

export const matchProductByPhoto = createServerFn({ method: "POST" })
  .inputValidator((input: MatchInput) => {
    if (!input?.image || !Array.isArray(input?.products)) {
      throw new Error("image and products are required");
    }
    return { image: input.image, products: input.products.slice(0, 400) };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const catalog = data.products
      .map((p) => `${p.id} :: ${p.name}`)
      .join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          {
            role: "system",
            content:
              "You identify a retail product from a photo and match it against a catalog. " +
              "Reply ONLY with a JSON object: {\"matches\":[\"<id>\", ...]} using ids from the catalog, " +
              "best match first, max 8 ids. If nothing matches, reply {\"matches\":[]}.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Catalog (id :: name):\n${catalog}` },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${data.image}` },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) {
        return { matches: [] as string[], rateLimited: true, error: "Rate limited, retrying shortly." };
      }
      if (res.status === 402) {
        return { matches: [] as string[], error: "AI credits exhausted. Please add credits." };
      }
      throw new Error(`AI request failed [${res.status}]: ${body}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    let matches: string[] = [];
    try {
      const parsed = JSON.parse(cleaned) as { matches?: unknown };
      if (Array.isArray(parsed.matches)) {
        matches = parsed.matches.filter((m): m is string => typeof m === "string");
      }
    } catch {
      const ids = new Set(data.products.map((p) => p.id));
      matches = cleaned.split(/[^0-9a-zA-Z-]+/).filter((t) => ids.has(t));
    }
    return { matches: matches.slice(0, 8), rateLimited: false };
  });
