import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, KeyRound, Loader2, LockKeyhole, Save, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { profileQueryKey, useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";

type FormState = {
  fullName: string;
  jobTitle: string;
  email: string;
  phone: string;
  bio: string;
  language: "ar" | "en";
  timezone: string;
  darkMode: boolean;
};

const EMPTY_FORM: FormState = {
  fullName: "",
  jobTitle: "",
  email: "",
  phone: "",
  bio: "",
  language: "ar",
  timezone: "Africa/Cairo",
  darkMode: false,
};

export function ProfileSettingsDialog({ children }: { children: React.ReactNode }) {
  const { user, userId } = useAuth();
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [mfaQr, setMfaQr] = useState<string | null>(null);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      fullName: profile?.full_name ?? user?.user_metadata?.["full_name"] ?? "",
      jobTitle: profile?.job_title ?? "",
      email: user?.email ?? "",
      phone: profile?.phone ?? "",
      bio: profile?.bio ?? "",
      language: profile?.interface_language === "en" ? "en" : "ar",
      timezone: profile?.timezone ?? "Africa/Cairo",
      darkMode: profile?.dark_mode ?? false,
    });
    setAvatarPreview(profile?.avatarUrl ?? null);
  }, [open, profile, user]);

  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.toggle("dark", form.darkMode);
  }, [form.darkMode, open]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("يرجى اختيار ملف صورة صالح.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("حجم الصورة يجب ألا يتجاوز 5 ميجابايت.");
      return;
    }
    if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function saveChanges() {
    if (!userId || !form.fullName.trim()) {
      toast.error("يرجى إدخال الاسم الكامل.");
      return;
    }
    setSaving(true);
    try {
      let avatarPath = profile?.avatar_path ?? null;
      if (avatarFile) {
        const extension = avatarFile.name.split(".").pop()?.toLowerCase() || "jpg";
        avatarPath = `${userId}/avatar.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(avatarPath, avatarFile, { upsert: true, contentType: avatarFile.type });
        if (uploadError) throw uploadError;
      }

      const { error: profileError } = await supabase.from("profiles").upsert({
        id: userId,
        full_name: form.fullName.trim(),
        job_title: form.jobTitle.trim(),
        phone: form.phone.trim(),
        bio: form.bio.trim(),
        avatar_path: avatarPath,
        interface_language: form.language,
        timezone: form.timezone,
        dark_mode: form.darkMode,
      });
      if (profileError) throw profileError;

      const authChanges: { data?: { full_name: string }; email?: string } = {
        data: { full_name: form.fullName.trim() },
      };
      if (form.email.trim() && form.email.trim() !== user?.email) authChanges.email = form.email.trim();
      const { error: authError } = await supabase.auth.updateUser(authChanges);
      if (authError) throw authError;

      setAvatarFile(null);
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) });
      toast.success(
        authChanges.email
          ? "تم حفظ التغييرات. تحقق من بريدك لتأكيد العنوان الجديد."
          : "تم حفظ تغييرات الحساب بنجاح.",
      );
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ التغييرات.");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    if (!user?.email || !currentPassword || newPassword.length < 8) {
      toast.error("أدخل كلمة المرور الحالية وكلمة جديدة من 8 أحرف على الأقل.");
      return;
    }
    setChangingPassword(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signInError) throw new Error("كلمة المرور الحالية غير صحيحة.");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword("");
      setNewPassword("");
      toast.success("تم تغيير كلمة المرور بنجاح.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تغيير كلمة المرور.");
    } finally {
      setChangingPassword(false);
    }
  }

  async function startMfa() {
    setMfaBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Kashaf Authenticator",
      });
      if (error) throw error;
      setMfaFactorId(data.id);
      setMfaQr(data.totp.qr_code);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر بدء إعداد المصادقة الثنائية.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function verifyMfa() {
    if (!mfaFactorId || mfaCode.length !== 6) return;
    setMfaBusy(true);
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
      if (challengeError) throw challengeError;
      const { error } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challenge.id,
        code: mfaCode,
      });
      if (error) throw error;
      setMfaQr(null);
      setMfaCode("");
      toast.success("تم تفعيل المصادقة الثنائية بنجاح.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "رمز التحقق غير صحيح.");
    } finally {
      setMfaBusy(false);
    }
  }

  const initials = (form.fullName || user?.email || "—").slice(0, 2).toUpperCase();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        dir="rtl"
        className="bottom-0 left-0 top-auto h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden overscroll-contain rounded-none border-x-0 border-b-0 p-0 sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[92dvh] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border"
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pl-12 text-right sm:px-6 sm:py-4 sm:pl-12">
          <DialogTitle>إعدادات الحساب</DialogTitle>
          <DialogDescription className="line-clamp-1">حدّث ملفك الشخصي وتفضيلاتك وخيارات الأمان.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="personal" dir="rtl" className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border px-3 py-2 sm:px-4">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
              <TabsTrigger value="personal" className="h-9 min-w-0 gap-1.5 px-2"><UserRound className="size-4 shrink-0" />الشخصية</TabsTrigger>
              <TabsTrigger value="avatar" className="h-9 min-w-0 gap-1.5 px-2"><Camera className="size-4 shrink-0" />الصورة</TabsTrigger>
              <TabsTrigger value="preferences" className="h-9 min-w-0 gap-1.5 px-2"><Save className="size-4 shrink-0" />التفضيلات</TabsTrigger>
              <TabsTrigger value="security" className="h-9 min-w-0 gap-1.5 px-2"><ShieldCheck className="size-4 shrink-0" />الأمان</TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
            <TabsContent value="personal" className="mt-0 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="الاسم الكامل" htmlFor="full-name"><Input id="full-name" value={form.fullName} onChange={(e) => update("fullName", e.target.value)} /></Field>
                <Field label="المسمى الوظيفي" htmlFor="job-title"><Input id="job-title" value={form.jobTitle} onChange={(e) => update("jobTitle", e.target.value)} /></Field>
                <Field label="البريد الإلكتروني" htmlFor="profile-email"><Input id="profile-email" type="email" dir="ltr" value={form.email} onChange={(e) => update("email", e.target.value)} /></Field>
                <Field label="رقم الهاتف" htmlFor="phone"><Input id="phone" type="tel" dir="ltr" value={form.phone} onChange={(e) => update("phone", e.target.value)} /></Field>
              </div>
              <Field label="النبذة / السيرة الذاتية" htmlFor="bio"><Textarea id="bio" rows={4} value={form.bio} onChange={(e) => update("bio", e.target.value)} /></Field>
            </TabsContent>

            <TabsContent value="avatar" className="mt-0">
              <div className="flex flex-col items-center gap-4 py-2 text-center sm:gap-5 sm:py-4">
                <Avatar className="size-28 border-4 border-background shadow-lg ring-2 ring-primary/20 sm:size-32">
                  {avatarPreview ? <AvatarImage src={avatarPreview} alt="معاينة صورة الملف الشخصي" className="object-cover" /> : null}
                  <AvatarFallback className="bg-primary text-2xl font-bold text-primary-foreground">{initials}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold">صورة الملف الشخصي</p>
                  <p className="mt-1 text-sm text-muted-foreground">JPG أو PNG أو WebP، بحد أقصى 5 ميجابايت.</p>
                </div>
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={selectAvatar} />
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => fileInputRef.current?.click()}>
                  <Camera />اختيار صورة جديدة
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="preferences" className="mt-0 space-y-5">
              <Field label="لغة واجهة المستخدم" htmlFor="language">
                <Select value={form.language} onValueChange={(value: "ar" | "en") => update("language", value)}>
                  <SelectTrigger id="language"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ar">العربية</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="المنطقة الزمنية" htmlFor="timezone">
                <Select value={form.timezone} onValueChange={(value) => update("timezone", value)}>
                  <SelectTrigger id="timezone"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Africa/Cairo">القاهرة (UTC+3)</SelectItem>
                    <SelectItem value="Asia/Riyadh">الرياض (UTC+3)</SelectItem>
                    <SelectItem value="Asia/Dubai">دبي (UTC+4)</SelectItem>
                    <SelectItem value="UTC">التوقيت العالمي (UTC)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3 sm:p-4">
                <div><Label htmlFor="dark-mode">الوضع المظلم</Label><p className="mt-1 text-xs text-muted-foreground">استخدام مظهر داكن ومريح للعين.</p></div>
                <Switch id="dark-mode" checked={form.darkMode} onCheckedChange={(checked) => update("darkMode", checked)} />
              </div>
            </TabsContent>

            <TabsContent value="security" className="mt-0 space-y-6">
              <section className="space-y-4">
                <div className="flex items-center gap-2"><KeyRound className="size-5 text-primary" /><h3 className="font-semibold">تغيير كلمة المرور</h3></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="كلمة المرور الحالية" htmlFor="current-password"><Input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></Field>
                  <Field label="كلمة المرور الجديدة" htmlFor="new-password"><Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></Field>
                </div>
                <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={changingPassword} onClick={() => void changePassword()}>
                  {changingPassword ? <Loader2 className="animate-spin" /> : <LockKeyhole />}تغيير كلمة المرور
                </Button>
              </section>
              <section className="space-y-4 border-t border-border pt-5">
                <div><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><h3 className="font-semibold">المصادقة الثنائية</h3></div><p className="mt-1 text-sm text-muted-foreground">أضف رمزاً من تطبيق المصادقة لحماية تسجيل الدخول.</p></div>
                {!mfaQr ? (
                  <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={mfaBusy} onClick={() => void startMfa()}>{mfaBusy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}تفعيل المصادقة الثنائية</Button>
                ) : (
                  <div className="flex flex-col items-center gap-4 rounded-md border border-border p-3 sm:p-4">
                    <img src={mfaQr} alt="رمز إعداد المصادقة الثنائية" className="size-40 rounded-md bg-background p-2 sm:size-44" />
                    <p className="text-center text-sm text-muted-foreground">امسح الرمز بتطبيق المصادقة، ثم أدخل الرمز المكوّن من 6 أرقام.</p>
                    <div className="flex w-full max-w-xs flex-col gap-2 sm:flex-row"><Input inputMode="numeric" dir="ltr" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} /><Button type="button" disabled={mfaBusy || mfaCode.length !== 6} onClick={() => void verifyMfa()}>تحقق</Button></div>
                  </div>
                )}
              </section>
            </TabsContent>
          </div>
        </Tabs>
        <div className="shrink-0 border-t border-border bg-muted/40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex sm:justify-end sm:px-6 sm:py-4">
          <Button type="button" size="lg" className="w-full sm:w-auto" disabled={saving} onClick={() => void saveChanges()}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}حفظ التغييرات
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>;
}