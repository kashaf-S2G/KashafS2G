/** معلومات الإصدار المحقونة وقت البناء (تتحدث تلقائيًا مع كل نشر). */
declare const __BUILD_INFO__: {
  commitSha: string | null;
  commitCount: number | null;
  commitDate: string | null;
  builtAt: string;
  lovableProjectId: string | null;
};

export const BUILD_INFO =
  typeof __BUILD_INFO__ !== "undefined"
    ? __BUILD_INFO__
    : { commitSha: null, commitCount: null, commitDate: null, builtAt: "", lovableProjectId: null };
