import { describe, expect, it } from "vitest";
import { adDurationDays, formatDate, friendlyError, nextAdStatus } from "../../src/lib/kashaf";

/**
 * PH-03-ADS — مدة الإعلان يجب أن تُحسب بتوقيت موحّد (UTC) لا بتوقيت الجهاز.
 * مصدر الحقيقة في التطبيق هو العرض ads_with_duration؛ هذه الاختبارات تغطي
 * النسخة النقية المطابقة له.
 */
describe("adDurationDays", () => {
  it("يحسب المدة للإعلان النشط حتى تاريخ اليوم الممرَّر", () => {
    expect(
      adDurationDays({ creation_date: "2026-09-01", end_date: null, status: "active" }, "2026-09-10"),
    ).toBe(9);
  });

  it("يستخدم تاريخ الانتهاء للإعلان غير النشط", () => {
    expect(
      adDurationDays(
        { creation_date: "2026-09-01", end_date: "2026-09-05", status: "inactive" },
        "2026-09-10",
      ),
    ).toBe(4);
  });

  it("لا يعيد قيمة سالبة عندما يكون تاريخ الإنشاء في المستقبل", () => {
    expect(
      adDurationDays({ creation_date: "2026-10-01", end_date: null, status: "active" }, "2026-09-10"),
    ).toBe(0);
  });

  it("يتخطى حدود الشهر والسنة بشكل صحيح", () => {
    expect(
      adDurationDays(
        { creation_date: "2025-12-25", end_date: "2026-01-05", status: "inactive" },
        "2026-09-10",
      ),
    ).toBe(11);
  });

  it("لا يتأثر بتوقيت جهاز المستخدم", () => {
    const original = process.env["TZ"];
    const input = { creation_date: "2026-09-01", end_date: null, status: "active" as const };
    const results = ["UTC", "Pacific/Kiritimati", "Pacific/Midway", "Africa/Cairo"].map((tz) => {
      process.env["TZ"] = tz;
      return adDurationDays(input, "2026-09-10");
    });
    process.env["TZ"] = original;
    expect(new Set(results).size).toBe(1);
  });
});

describe("nextAdStatus", () => {
  it("يوقف الإعلان النشط ويضع تاريخ اليوم بتوقيت UTC نهايةً له", () => {
    expect(nextAdStatus({ status: "active", end_date: null }, "2026-09-10")).toEqual({
      status: "inactive",
      end_date: "2026-09-10",
    });
  });

  it("يحافظ على تاريخ الانتهاء الموجود مسبقًا", () => {
    expect(nextAdStatus({ status: "active", end_date: "2026-08-01" }, "2026-09-10")).toEqual({
      status: "inactive",
      end_date: "2026-08-01",
    });
  });

  it("يمسح تاريخ الانتهاء عند إعادة التفعيل", () => {
    expect(nextAdStatus({ status: "inactive", end_date: "2026-08-01" }, "2026-09-10")).toEqual({
      status: "active",
      end_date: null,
    });
  });
});

describe("formatDate", () => {
  it("يعرض شرطة عند غياب التاريخ", () => {
    expect(formatDate(null)).toBe("—");
  });

  it("ينسّق التاريخ بالتقويم الميلادي العربي دون انزياح المنطقة الزمنية", () => {
    // ar-EG تستخدم الأرقام العربية الهندية، لذلك نقارن بالسنة كما تنسّقها المنصة
    const year = new Intl.NumberFormat("ar-EG", { useGrouping: false }).format(2026);
    expect(formatDate("2026-09-10")).toContain(year);
  });

  it("لا يتغير الناتج باختلاف المنطقة الزمنية للجهاز", () => {
    const original = process.env["TZ"];
    const results = ["UTC", "Pacific/Kiritimati", "Pacific/Midway"].map((tz) => {
      process.env["TZ"] = tz;
      return formatDate("2026-09-10");
    });
    process.env["TZ"] = original;
    expect(new Set(results).size).toBe(1);
  });

});

describe("friendlyError", () => {
  it("يترجم خطأ الرابط المكرر", () => {
    expect(friendlyError(new Error('duplicate key value violates "competitors_competitor_url_key"'))).toContain(
      "مُضاف بالفعل",
    );
  });

  it("يترجم خطأ الصلاحيات", () => {
    expect(friendlyError(new Error("new row violates row-level security policy"))).toContain(
      "صلاحية",
    );
  });
});
