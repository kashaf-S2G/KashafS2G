import { AI_MODEL, aiResponses } from "@/lib/ai-endpoint.server";

/**
 * أدوات الزحف على مكتبة إعلانات فيسبوك: قراءة نتائج البحث عن صفحة،
 * تصنيف الإعلان بالذكاء الاصطناعي، وتحميل صورته.
 * ملف خادم فقط — لا يُستورد من كود المتصفح.
 */

export type { CrawledAd } from "@/lib/fb-library.server";
export { normalizeName, searchUrl, pageAdsUrl, libraryRequestUrls, fetchLibraryPage, fetchAllLibraryAds } from "@/lib/fb-library.server";

export class AiBlockedError extends Error {}

export type AdIdentity = {
  product_name: string;
  niche: string;
  product_description: string;
  /** الوظيفة والاستخدام الفعلي للمنتج. */
  function_use: string;
  /** العلامة التجارية إن ظهرت. */
  brand: string;
  /** الحجم أو القدرة أو المقاس. */
  size: string;
  /** الشكل والتصميم كما يظهر في الصورة. */
  form: string;
  /** المواصفات والخصائص. */
  specs: string[];
  /** ما يميّز هذا المنتج عن منتج آخر يشبهه في الاسم. */
  distinguishing: string[];
  /** ملخّص كل الأدلة، يُمرّر لفلتر توحيد المنتجات. */
  evidence: string;
};

/** يستخرج هوية المنتج الحقيقية من الإعلان: نصه وصورته وأدلته كلها. */
export async function classifyAd(
  apiKey: string,
  input: {
    text: string;
    imageUrl?: string | null;
    niches: string[];
    knownProducts?: string[];
  },
  ownerId?: string | null,
): Promise<AdIdentity> {
  const hint = input.niches.length
    ? `الفئات المستخدمة حاليًا: ${input.niches.join("، ")}. استخدم واحدة منها إن كانت مناسبة، وإلا اقترح فئة جديدة قصيرة.`
    : "اقترح فئة قصيرة مناسبة.";
  const productsHint = input.knownProducts?.length
    ? `\nأسماء المنتجات المسجّلة لدينا: ${input.knownProducts.join("، ")}. إذا كان الإعلان لنفس المنتج فاستخدم الاسم المسجّل حرفيًا بدون تغيير، ولا تخترع اسمًا جديدًا لمنتج موجود.`
    : "";

  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text:
        `حدّد هوية المنتج الحقيقي في إعلان تجاري، بالاعتماد على نص الإعلان وصورته معًا.\n` +
        `اسم المتجر أو الصفحة أو البراند أو التصنيف العام ليس منتجًا.\n` +
         `أعطِ: اسم المنتج بكلمات قليلة جدًا، الفئة، وصفًا واضحًا يشمل خصائصه واستخدامه دون قطع المعلومات، ثم وظيفة المنتج واستخدامه، ` +
        `العلامة التجارية إن ظهرت، الحجم أو القدرة أو المقاس، الشكل والتصميم كما يظهر بالصورة، ` +
        `المواصفات والخصائص، وما يميّزه عن منتج آخر قد يشترك معه في الاسم.\n` +
        `اجعل الاسم دالًا على المنتج نفسه ووظيفته (مثال: "كريم" وحدها غير كافية؛ اكتب "كريم تنعيم الشعر").\n` +
        `${hint}${productsHint}\nنص الإعلان:\n${input.text}`,
    },
  ];
  if (input.imageUrl) content.push({ type: "input_image", image_url: input.imageUrl });

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
      text: {
        format: {
          type: "json_schema",
          name: "ad_extraction",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              product_name: { type: "string" },
              niche: { type: "string" },
              product_description: {
                type: "string",
                 description: "وصف واضح للمنتج بالعربية يذكر خصائصه واستخدامه دون قطع المعلومات",
              },
              function_use: { type: "string", description: "وظيفة المنتج واستخدامه" },
              brand: { type: "string", description: "العلامة التجارية أو نص فارغ" },
              size: { type: "string", description: "الحجم أو القدرة أو المقاس أو نص فارغ" },
              form: { type: "string", description: "الشكل والتصميم كما يظهر في الصورة" },
              specs: { type: "array", items: { type: "string" } },
              distinguishing: {
                type: "array",
                items: { type: "string" },
                description: "ما يميّز هذا المنتج عن منتج مشابه في الاسم",
              },
            },
            required: [
              "product_name",
              "niche",
              "product_description",
              "function_use",
              "brand",
              "size",
              "form",
              "specs",
              "distinguishing",
            ],
          },
        },
      },
    }),
  }, ownerId, "ad_classify");

  if (!res.ok || !res.body) {
    if (res.status === 402) throw new AiBlockedError("انتهى رصيد الذكاء الاصطناعي، يرجى إضافة رصيد.");
    if (res.status === 403) throw new AiBlockedError("خدمة الذكاء الاصطناعي موقوفة لهذا الحساب.");
    if (res.status === 429) throw new AiBlockedError("الخدمة مشغولة الآن، حاول لاحقًا.");
    throw new Error(`تعذّر تحليل الإعلان (${res.status})`);
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
        // أحداث غير مكتملة تُتجاهل
      }
    }
  }

  const parsed = JSON.parse(out) as Partial<{
    product_name: string;
    niche: string;
    product_description: string;
    function_use: string;
    brand: string;
    size: string;
    form: string;
    specs: string[];
    distinguishing: string[];
  }>;
  const product = parsed.product_name?.trim();
  if (!product) throw new Error("لم يتعرّف الذكاء الاصطناعي على المنتج.");
  const specs = (parsed.specs ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const distinguishing = (parsed.distinguishing ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
  const identity = {
    product_name: product,
    niche: parsed.niche?.trim() ?? "",
    product_description: parsed.product_description?.trim() ?? "",
    function_use: parsed.function_use?.trim() ?? "",
    brand: parsed.brand?.trim() ?? "",
    size: parsed.size?.trim() ?? "",
    form: parsed.form?.trim() ?? "",
    specs,
    distinguishing,
  };
  const evidence = [
    identity.function_use && `الوظيفة والاستخدام: ${identity.function_use}`,
    identity.brand && `العلامة التجارية: ${identity.brand}`,
    identity.size && `الحجم/المقاس: ${identity.size}`,
    identity.form && `الشكل والتصميم: ${identity.form}`,
    specs.length && `المواصفات: ${specs.join("، ")}`,
    distinguishing.length && `فروق جوهرية: ${distinguishing.join("، ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { ...identity, evidence };
}

/** قصر النص على عدد كلمات محدد. */
export function limitWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, max).join(" ");
}

/** تحميل صورة الإعلان ورفعها إلى التخزين الخاص، وإرجاع مسارها. */
export async function storeAdImage(
  ownerId: string,
  imageUrl: string,
): Promise<string | null> {
  return (await storeAdImageResult(ownerId, imageUrl)).path;
}

/** مثل storeAdImage لكن يعيد سبب الفشل عند تعذّر النسخ. */
export async function storeAdImageResult(
  ownerId: string,
  imageUrl: string,
): Promise<{ path: string | null; reason: string | null }> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return { path: null, reason: `http ${res.status}` };
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return { path: null, reason: `not image (${type})` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > 6_000_000) return { path: null, reason: `too large (${bytes.byteLength} bytes)` };
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.storage
      .from("ad-images")
      .upload(path, bytes, { contentType: type, upsert: false });
    if (error) return { path: null, reason: `storage: ${error.message}` };
    return { path, reason: null };
  } catch (e) {
    return { path: null, reason: e instanceof Error ? e.message : String(e) };
  }
}
