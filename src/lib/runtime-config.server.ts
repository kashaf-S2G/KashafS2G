/**
 * السجل المركزي لجميع الأسرار ومتغيرات البيئة في المشروع — ملف خادم فقط.
 *
 * الهدف: أن يعمل المشروع بنفس المفاتيح بعد نقله بين حسابات Lovable مختلفة
 * أو استعادته من GitHub، دون توليد مفاتيح جديدة.
 *
 * التصنيف:
 * - external: قيمة تخص خدمة خارجية (OpenAI / Supabase) ومستقلة تمامًا عن Lovable.
 *   تُنقل كما هي: يكفي لصق نفس القيمة في خزانة أسرار المشروع الجديد.
 * - platform: مرتبط بحساب/مساحة عمل Lovable ولا يمكن نقله تقنيًا
 *   (NON-TRANSFERABLE BY PLATFORM) — تنشئه المنصة تلقائيًا في الحساب الجديد.
 *
 * ممنوع كتابة أي قيمة سرية داخل هذا الملف.
 */

export type SecretScope = "external" | "platform";

export type SecretSpec = {
  /** اسم متغير البيئة. */
  name: string;
  /** الخدمة التي يستخدمها. */
  service: "openai" | "supabase" | "lovable";
  /** وصف مختصر للاستخدام. */
  purpose: string;
  scope: SecretScope;
  /** هل يمكن الاحتفاظ بنفس القيمة عند نقل المشروع؟ */
  transferable: boolean;
  /** هل يتعطل المشروع بالكامل بدونه؟ */
  required: boolean;
};

/** خريطة كل الأسرار التي يقرأها كود الخادم فعليًا. */
export const SECRET_REGISTRY: SecretSpec[] = [
  {
    name: "SUPABASE_URL",
    service: "supabase",
    purpose: "عنوان مشروع Supabase (نفس المشروع دائمًا).",
    scope: "external",
    transferable: true,
    required: true,
  },
  {
    name: "SUPABASE_PUBLISHABLE_KEY",
    service: "supabase",
    purpose: "المفتاح العام لقراءة البيانات ضمن سياسات RLS.",
    scope: "external",
    transferable: true,
    required: true,
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    service: "supabase",
    purpose: "مفتاح الخادم للعمليات الإدارية (خادم فقط).",
    scope: "external",
    transferable: true,
    required: true,
  },
  {
    name: "OPENAI_API_KEY",
    service: "openai",
    purpose: "تشغيل جميع عمليات الذكاء الاصطناعي مباشرة عبر OpenAI.",
    scope: "external",
    transferable: true,
    required: false,
  },
  {
    name: "OPENAI_ADMIN_API_KEY",
    service: "openai",
    purpose: "قراءة تكاليف حساب OpenAI فقط — لا يُستخدم للتنفيذ إطلاقًا.",
    scope: "external",
    transferable: true,
    required: false,
  },
  {
    name: "LOVABLE_API_KEY",
    service: "lovable",
    purpose: "بوابة Lovable كخيار احتياطي عند غياب مفتاح OpenAI.",
    scope: "platform",
    transferable: false,
    required: false,
  },
];

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** يقرأ متغيرًا مطلوبًا ويرمي رسالة واضحة عند غيابه. */
export function requireEnv(name: string): string {
  const value = read(name);
  if (!value) {
    const spec = SECRET_REGISTRY.find((s) => s.name === name);
    const hint = spec?.transferable
      ? "أعد لصق نفس القيمة القديمة في أسرار المشروع؛ لا حاجة لتوليد مفتاح جديد."
      : "هذا المفتاح تديره منصة Lovable ويُنشأ تلقائيًا في الحساب الجديد.";
    throw new Error(`المتغير ${name} غير مضبوط في هذا المشروع. ${hint}`);
  }
  return value;
}

/** إعدادات Supabase الخاصة بالخادم — نفس مشروع Supabase في أي حساب Lovable. */
export function supabaseServerConfig() {
  return {
    url: requireEnv("SUPABASE_URL"),
    publishableKey: requireEnv("SUPABASE_PUBLISHABLE_KEY"),
  };
}

/**
 * مفاتيح OpenAI لا تُقرأ من هنا إطلاقًا.
 * المصدر الوحيد لها هو الطبقة الموحّدة في secrets.server.ts:
 * بيئة المشروع أولًا ثم خزانة Supabase، حتى تبقى فعّالة بعد نقل المشروع.
 */

/**
 * مفتاح بوابة Lovable.
 * NON-TRANSFERABLE BY PLATFORM: مرتبط بحساب/مساحة عمل Lovable ومحاسبتها،
 * ولا ينتقل مع المشروع. وجوده اختياري ولا يعتمد عليه أي مفتاح خارجي آخر.
 */
export function lovableGatewayKey(): string | undefined {
  return read("LOVABLE_API_KEY");
}


/** تقرير حالة الأسرار بدون كشف أي قيمة — للاستخدام الإداري ولفحص ما بعد النقل. */
export function secretsHealth() {
  return SECRET_REGISTRY.map((spec) => ({
    name: spec.name,
    service: spec.service,
    purpose: spec.purpose,
    scope: spec.scope,
    transferable: spec.transferable,
    required: spec.required,
    configured: Boolean(read(spec.name)),
  }));
}
