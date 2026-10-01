import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdExtraction = {
  product_name: string;
  niche: string;
  product_description: string;
  image_data_url?: string | null;
};

/** يفك ترميز نص JSON المضمّن داخل صفحات فيسبوك. */
function unescapeJson(raw: string) {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\\//g, "/");
  }
}

/** يستخرج بيانات الإعلان من بيانات مكتبة إعلانات فيسبوك المضمّنة في الصفحة. */
function parseFacebookAd(html: string): { text: string; image?: string } | null {
  const grab = (field: string) => {
    const m = html.match(new RegExp(`"${field}":"((?:[^"\\\\]|\\\\.)*)"`));
    return m?.[1] ? unescapeJson(m[1]) : "";
  };
  const bodyText = html.match(/"body":\{"text":"((?:[^"\\]|\\.)*)"/)?.[1];
  const parts = [
    grab("title"),
    grab("link_description"),
    bodyText ? unescapeJson(bodyText) : "",
    grab("page_name"),
    grab("caption"),
  ].filter(Boolean);
  const image =
    grab("original_image_url") || grab("resized_image_url") || grab("video_preview_image_url");
  if (!parts.length && !image) return null;
  return image ? { text: parts.join("\n").slice(0, 4000), image } : { text: parts.join("\n").slice(0, 4000) };
}

/** يجلب صفحة الإعلان ويستخرج نصوصها وصورتها الرئيسية (أفضل جهد). */
async function fetchPageInfo(url: string): Promise<{ text: string; image?: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        // فيسبوك يحجب متصفحًا عاديًا لكنه يقدّم بيانات الإعلان لزاحف المعاينة.
        "User-Agent": "facebookexternalhit/1.1",
        "Accept-Language": "ar,en;q=0.8",
      },
    });
    if (!res.ok) return { text: "" };
    const html = (await res.text()).slice(0, 2_000_000);
    const fb = parseFacebookAd(html);
    if (fb) return fb;
    const meta = (prop: string) => {
      const re = new RegExp(
        `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
        "i",
      );
      const alt = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`,
        "i",
      );
      return html.match(re)?.[1] ?? html.match(alt)?.[1] ?? "";
    };
    const title = meta("og:title") || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "";
    const desc = meta("og:description") || meta("description");
    const image = meta("og:image") || meta("twitter:image");
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    const decoded = [title, desc, body]
      .filter(Boolean)
      .join("\n")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'");
    return image ? { text: decoded, image: image.replace(/&amp;/g, "&") } : { text: decoded };
  } catch {
    return { text: "" };
  }
}

/** يحمّل الصورة ويحوّلها إلى data URL لعرضها ورفعها. */
async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 6_000_000) return null;
    let binary = "";
    for (let i = 0; i < buf.length; i += 1) binary += String.fromCharCode(buf[i]!);
    return `data:${type};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

type ExtractInput = {
  /** صورة الإعلان بصيغة data URL (base64). */
  imageDataUrl?: string | null;
  /** رابط الإعلان أو نصه المنسوخ. */
  text?: string | null;
  /** الفئات الموجودة حاليًا لمساعدة النموذج على استخدام نفس التسمية. */
  niches?: string[];
};

const SCHEMA = {
  type: "json_schema" as const,
  name: "ad_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      product_name: { type: "string", description: "اسم المنتج المُعلن عنه بالعربية، كلمات قليلة" },
      niche: { type: "string", description: "فئة المنتج بالعربية مثل ملابس، إكسسوار، أدوات منزلية" },
      product_description: {
        type: "string",
        description: "وصف واضح وكامل للمنتج بالعربية يذكر خصائصه واستخدامه دون قطع النص",
      },
    },
    required: ["product_name", "niche", "product_description"],
  },
};

export const extractAdDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ExtractInput) => input)
  .handler(async ({ data, context }): Promise<AdExtraction> => {
    const { AI_MODEL, aiApiKey, aiResponses } = await import("@/lib/ai-endpoint.server");
    const apiKey = await aiApiKey();
    if (!apiKey) throw new Error("خدمة الذكاء الاصطناعي غير مهيأة.");

    let image = data.imageDataUrl?.trim() || "";
    const text = data.text?.trim();
    if (!image && !text) throw new Error("ألصق رابط الإعلان أو أضف صورته أولًا.");

    // إذا كان المُدخل رابطًا، نجلب محتوى الصفحة وصورتها لنعطي النموذج معلومات حقيقية.
    let pageText = "";
    if (text && /^https?:\/\//i.test(text)) {
      const info = await fetchPageInfo(text);
      pageText = info.text;
      if (!image && info.image) image = (await toDataUrl(info.image)) ?? "";
    }


    const niches = (data.niches ?? []).filter(Boolean).slice(0, 40);
    const hint = niches.length
      ? `الفئات المستخدمة حاليًا: ${niches.join("، ")}. استخدم واحدة منها إن كانت مناسبة، وإلا اقترح فئة جديدة قصيرة.`
      : "اقترح فئة قصيرة مناسبة.";

    const content: Array<Record<string, unknown>> = [
      {
        type: "input_text",
        text: `استخرج اسم المنتج وفئته ووصفًا واضحًا له من إعلان تجاري. الاسم والفئة بكلمات قليلة جدًا، والوصف يشمل ما يتوفر من خصائص واستخدامات دون حذف المعلومات. ${hint}${
          text ? `\nرابط أو نص الإعلان: ${text}` : ""
        }${pageText ? `\nمحتوى صفحة الإعلان:\n${pageText}` : ""}`,
      },
    ];
    if (image) content.push({ type: "input_image", image_url: image });

    const res = await aiResponses(apiKey, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        input: [{ role: "user", content }],
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        text: { format: SCHEMA },
      }),
    }, context.userId, "ad_extract");

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      if (res.status === 402) throw new Error("انتهى رصيد الذكاء الاصطناعي، يرجى إضافة رصيد.");
      if (res.status === 429) throw new Error("الخدمة مشغولة الآن، حاول بعد قليل.");
      throw new Error(`تعذّر تحليل الإعلان (${res.status}) ${detail.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let out = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as {
            type?: string;
            delta?: string;
            response?: { output_text?: string };
          };
          if (event.type === "response.output_text.delta" && event.delta) out += event.delta;
          else if (event.type === "response.completed" && event.response?.output_text) {
            out = event.response.output_text;
          }
        } catch {
          // نتجاهل الأحداث غير المكتملة
        }
      }
    }

    try {
      const parsed = JSON.parse(out) as Partial<AdExtraction>;
      const product = parsed.product_name?.trim();
      if (!product) throw new Error("empty");
      return {
        product_name: product,
        niche: parsed.niche?.trim() ?? "",
        product_description: parsed.product_description?.trim() ?? "",
        image_data_url: image || null,
      };
    } catch {
      throw new Error("لم يتمكن الذكاء الاصطناعي من التعرف على المنتج، جرّب صورة أوضح.");
    }
  });
