/**
 * إعدادات الذكاء الاصطناعي غير السرية — تنتقل مع المشروع في Git.
 * ممنوع وضع أي مفتاح أو قيمة سرية هنا؛ الأسرار تُقرأ من runtime-config.server.ts فقط.
 */

/** معرّف النموذج كما يُرسل إلى بوابة Lovable. */
export const AI_MODEL_ID = "openai/gpt-6-luna";

/** اسم النموذج كما يُرسل مباشرة إلى OpenAI. */
export const OPENAI_MODEL_NAME = "gpt-6-luna";

/** مسار Responses API لدى OpenAI مباشرة. */
export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/** مسار قراءة تكاليف المؤسسة عبر مفتاح الإدارة. */
export const OPENAI_ORG_COSTS_URL = "https://api.openai.com/v1/organization/costs";

/** مسار بوابة Lovable الاحتياطية. */
export const LOVABLE_GATEWAY_RESPONSES_URL = "https://ai.gateway.lovable.dev/v1/responses";
