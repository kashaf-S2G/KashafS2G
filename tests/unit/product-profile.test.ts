import { describe, expect, it } from "vitest";
import {
  EMPTY_PROFILE,
  isEmptyProfile,
  mergeProfile,
  parseProfile,
  profileDigest,
} from "../../src/lib/product-profile";

describe("بطاقة الوصف المعيارية للمنتج", () => {
  it("تقرأ ناتج النموذج الناقص بشكل آمن", () => {
    const p = parseProfile({ real_name: " ساعة ذكية ", synonyms: ["smart watch", "", "smart watch"] });
    expect(p.real_name).toBe("ساعة ذكية");
    expect(p.synonyms).toEqual(["smart watch"]);
    expect(p.features).toEqual([]);
  });

  it("تدمج المعرفة الجديدة دون فقدان القديمة", () => {
    const base = parseProfile({ real_name: "ساعة ذكية", synonyms: ["smart watch"], usage: "تتبع رياضي" });
    const next = parseProfile({ real_name: "ساعة", synonyms: ["Smart Watch", "ساعة يد ذكية"], usage: "إشعارات" });
    const merged = mergeProfile(base, next);
    expect(merged.real_name).toBe("ساعة ذكية");
    expect(merged.usage).toBe("تتبع رياضي");
    expect(merged.synonyms).toEqual(["smart watch", "ساعة يد ذكية"]);
  });

  it("تكشف البطاقة الفارغة وتلخّص الممتلئة", () => {
    expect(isEmptyProfile(EMPTY_PROFILE)).toBe(true);
    const digest = profileDigest(parseProfile({ real_name: "شاحن سيارة", usage: "شحن الهاتف" }), "x");
    expect(digest).toContain("شاحن سيارة");
    expect(digest).toContain("شحن الهاتف");
  });
});
