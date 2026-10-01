import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";

config();

/**
 * PH-01-DATA-MODEL — اختبارات تكامل حقيقية ضد Supabase.
 * الهدف: إثبات أن بيانات pages/ads غير متاحة إطلاقًا للزائر (anon).
 */
const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
const anonKey =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

const anon = createClient(url!, anonKey!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

describe("RLS: anonymous access to pages/ads", () => {
  beforeAll(() => {
    expect(url, "SUPABASE_URL is required").toBeTruthy();
    expect(anonKey, "SUPABASE_PUBLISHABLE_KEY is required").toBeTruthy();
  });

  it("يمنع قراءة الصفحات", async () => {
    const { data, error } = await anon.from("competitors").select("*");
    expect(error).toBeTruthy();
    expect(data).toBeNull();
  });

  it("يمنع قراءة الإعلانات", async () => {
    const { data, error } = await anon.from("ads").select("*");
    expect(error).toBeTruthy();
    expect(data).toBeNull();
  });

  it("يمنع قراءة عرض مدة الإعلانات", async () => {
    const { data, error } = await anon.from("ads_with_duration").select("*");
    expect(error).toBeTruthy();
    expect(data).toBeNull();
  });

  it("يمنع إضافة صفحة", async () => {
    const { error } = await anon
      .from("competitors")
      .insert({ competitor_name: "x", competitor_url: "https://x.test/anon", platform: "Facebook", niche: "t" });
    expect(error).toBeTruthy();
  });

  it("يمنع إضافة إعلان", async () => {
    const { error } = await anon.from("ads").insert({
      competitor_id: "00000000-0000-0000-0000-000000000000",
      product_name: "x",
      creation_date: "2026-01-01",
      status: "active",
    });
    expect(error).toBeTruthy();
  });

  it("يمنع تعديل الصفحات", async () => {
    const { error } = await anon.from("competitors").update({ niche: "hacked" }).neq("id", "00000000-0000-0000-0000-000000000000");
    expect(error).toBeTruthy();
  });

  it("يمنع حذف الإعلانات", async () => {
    const { error } = await anon.from("ads").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    expect(error).toBeTruthy();
  });

  it("يمنع تنفيذ إجراء تبنّي السجلات القديمة بدون تسجيل دخول", async () => {
    const { error } = await anon.rpc("claim_legacy_records");
    expect(error).toBeTruthy();
  });
});

describe("مدة الإعلان تأتي محسوبة من قاعدة البيانات", () => {
  it("العرض ads_with_duration يعرّف عمود duration_days", async () => {
    // الزائر ممنوع، لذلك نتحقق من نوع الخطأ لا من غياب العرض
    const { error } = await anon.from("ads_with_duration").select("duration_days").limit(1);
    expect(error?.message ?? "").not.toContain("does not exist");
  });
});
