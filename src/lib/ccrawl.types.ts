/** أنواع زحف الفئات (بنك المصطلحات والفئات). ملف نقي صالح للمتصفح والخادم. */

/** نسبة التطابق التي يجب أن تتخطاها الصفحة مع الفئات المحددة. */
export const CATEGORY_MATCH_THRESHOLD = 70;

export type CcrawlPhase = "idle" | "search" | "analysis" | "done";

export type CcrawlProgress = {
  runId: string;
  scope: string;
  phase: CcrawlPhase;
  done: boolean;
  currentKey: string | null;
  categories: string[];
  keysTotal: number;
  keysDone: number;
  pagesFound: number;
  pagesAnalyzed: number;
  pagesPending: number;
  matches: number;
};

export type CcrawlKeyRow = { id: string; keyText: string; status: string; found: number };

export type CcrawlPageRow = {
  id: string;
  pageId: string;
  pageName: string;
  pageUrl: string;
  imageUrl: string | null;
  adsSample: string[];
  adIds: string[];
  searchKey: string | null;
  score: number;
  decision: string | null;
  matchedCategories: string[];
  reasons: string[];
  differences: string[];
  /** سجل الصفحة في مسار الموافقة (إن وُجد). */
  pageRowId: string | null;
  pageStatus: string | null;
};
