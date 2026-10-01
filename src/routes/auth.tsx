import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Radar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyError } from "@/lib/kashaf";

export const Route = createFileRoute("/auth")({
  // Client-only: auth state lives in the browser, so SSR would render a
  // Suspense fallback that mismatches the client's first paint.
  ssr: false,
  head: () => ({
    meta: [
      { title: "تسجيل الدخول | Kashaf" },
      {
        name: "description",
        content: "سجّل الدخول إلى كشاف لمتابعة المنافسين وإعلاناتهم بحساب خاص وآمن.",
      },
      { property: "og:title", content: "تسجيل الدخول | Kashaf" },
      {
        property: "og:description",
        content: "سجّل الدخول إلى كشاف لمتابعة المنافسين وإعلاناتهم بحساب خاص وآمن.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthRoute,
});

function AuthRoute() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/" });
  }, [loading, session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("تم إنشاء الحساب. إن طُلب تأكيد البريد فافتح رسالة التأكيد.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("مرحبًا بك مجددًا");
      }
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Radar className="size-5" />
          </span>
          <CardTitle className="mt-3">
            {mode === "signin" ? "تسجيل الدخول إلى كشاف" : "إنشاء حساب جديد"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">بياناتك خاصة بك ولا يراها أي شخص آخر.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input
                id="email"
                type="email"
                dir="ltr"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور</Label>
              <Input
                id="password"
                type="password"
                dir="ltr"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "جارٍ المعالجة..." : mode === "signin" ? "دخول" : "إنشاء الحساب"}
            </Button>
          </form>
          <Button
            variant="link"
            className="mt-3 w-full"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "ليس لديك حساب؟ أنشئ حسابًا" : "لديك حساب؟ سجّل الدخول"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
