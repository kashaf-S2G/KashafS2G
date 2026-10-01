/**
 * أنواع منظومة زحف المنتجات (الإعلان هو وحدة البحث الأساسية).
 * ملف نقي صالح للمتصفح والخادم معًا.
 */

/** ملف بحث مؤقت للمنتج — يُستخدم للبحث والمطابقة فقط ولا يعدّل المنتج الأصلي. */
export type ResearchProfile = {
  real_name: string;
  alt_names: string[];
  synonyms: string[];
  description: string;
  category: string;
  usage: string;
  function_use: string;
  features: string[];
  specs: string[];
  form_design: string;
  sizes: string[];
  capacity: string;
  material: string;
  brand: string;
  identifiers: string[];
  distinguishing: string[];
};

export const EMPTY_RESEARCH: ResearchProfile = {
  real_name: "",
  alt_names: [],
  synonyms: [],
  description: "",
  category: "",
  usage: "",
  function_use: "",
  features: [],
  specs: [],
  form_design: "",
  sizes: [],
  capacity: "",
  material: "",
  brand: "",
  identifiers: [],
  distinguishing: [],
};

export type PcrawlPhase =
  | "idle"
  | "profiles"
  | "vocabulary"
  | "review"
  | "search"
  | "analysis"
  | "done";

/** تقدّم التشغيل كما تعرضه الواجهة. */
export type PcrawlProgress = {
  runId: string;
  scope: string;
  phase: PcrawlPhase;
  done: boolean;
  paused: string | null;
  currentKey: string | null;
  productsTotal: number;
  profilesReady: number;
  keysTotal: number;
  keysDone: number;
  adsFound: number;
  adsNew: number;
  adsAnalyzed: number;
  adsPending: number;
  matches: number;
  pagesCandidates: number;
};

export type PcrawlKeyRow = {
  id: string;
  keyText: string;
  kind: string;
  status: string;
  found: number;
  productIds: string[];
  searchedAt: string | null;
};

export type PcrawlMatchRow = {
  id: string;
  adId: string;
  adText: string;
  adImageUrl: string | null;
  adSourceUrl: string | null;
  pageId: string | null;
  pageName: string;
  pageUrl: string;
  productId: string;
  productName: string;
  productCode: string;
  score: number;
  decision: string;
  reasons: string[];
  differences: string[];
  extractedName: string | null;
  searchKey: string | null;
  createdAt: string;
  /** حالة الصفحة الناتجة في مسار الموافقة (إن وُجدت). */
  pageRowId: string | null;
  pageStatus: string | null;
};

export type PcrawlOverview = {
  status: string;
  pausedReason: string | null;
  runningId: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  scope: string | null;
  productsTotal: number;
  keysTotal: number;
  keysDone: number;
  adsTotal: number;
  adsPending: number;
  matches: number;
  pagesPending: number;
};
