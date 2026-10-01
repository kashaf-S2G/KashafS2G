import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, PlugZap, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VaultSecretDialog } from "@/components/VaultSecretDialog";
import { testOpenAiAdminKey, testOpenAiApiKey } from "@/lib/ai-pricing.functions";
import { getSecretsStatus, migrateSecretsToVault, type SecretLocation } from "@/lib/secrets.functions";

const LOCATION_LABEL: Record<SecretLocation, string> = {
  both: "بيئة المشروع + الخزانة",
  environment: "بيئة المشروع فقط",
  vault: "الخزانة فقط",
  missing: "غير موجود",
};

function locationVariant(location: SecretLocation): "default" | "secondary" | "outline" | "destructive" {
  if (location === "both" || location === "vault") return "default";
  if (location === "environment") return "secondary";
  return "destructive";
}

/** لوحة حالة الأسرار الخارجية ونقلها إلى خزانة Supabase — لا تعرض أي قيمة سرية. */
export function SecretsVaultPanel() {
  const queryClient = useQueryClient();
  const loadStatus = useServerFn(getSecretsStatus);
  const migrate = useServerFn(migrateSecretsToVault);
  const testAdminKey = useServerFn(testOpenAiAdminKey);
  const testApiKey = useServerFn(testOpenAiApiKey);

  const adminTest = useMutation({
    mutationFn: () => testAdminKey(),
    onSuccess: (result) => {
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    },
    onError: (error: Error) => toast.error(error.message || "تعذر تجربة المفتاح."),
  });

  const apiTest = useMutation({
    mutationFn: () => testApiKey(),
    onSuccess: (result) => {
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    },
    onError: (error: Error) => toast.error(error.message || "تعذر تجربة المفتاح."),
  });

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: ["secrets-status"],
    queryFn: () => loadStatus(),
  });

  const mutation = useMutation({
    mutationFn: () => migrate(),
    onSuccess: (result) => {
      const stored = result.results.filter((r) => r.status === "stored").length;
      const failed = result.results.filter((r) => r.status === "failed").length;
      if (failed > 0) toast.error("تعذر حفظ بعض المفاتيح في الخزانة.");
      else if (stored > 0) toast.success(`تم حفظ ${stored} مفتاح في الخزانة.`);
      else toast.info("لا توجد مفاتيح في بيئة المشروع لنقلها.");
      void queryClient.invalidateQueries({ queryKey: ["secrets-status"] });
    },
    onError: (error: Error) => toast.error(error.message || "تعذر تنفيذ النقل."),
  });

  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> جارٍ قراءة حالة المفاتيح...
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          نقل المفاتيح الحالية إلى الخزانة
        </Button>
        <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "size-4 animate-spin" : "size-4"} />
          تحديث الحالة
        </Button>
      </div>

      <div className="space-y-2">
        {(data?.secrets ?? []).map((secret) => (
          <div
            key={secret.name}
            className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-3"
          >
            <div className="min-w-0 space-y-1">
              <p className="font-mono text-sm font-semibold">{secret.name}</p>
              <p className="text-xs text-muted-foreground">{secret.purpose}</p>
              {!secret.transferable && (
                <p className="text-xs text-muted-foreground">
                  تديره منصة Lovable ولا ينتقل مع المشروع؛ لا يُحفظ في الخزانة.
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {secret.vaultEligible && (
                <VaultSecretDialog
                  name={secret.name}
                  label={secret.inVault ? `تحديث ${secret.name} في الخزانة` : `حفظ ${secret.name} في الخزانة`}
                />
              )}
              {secret.name === "OPENAI_API_KEY" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => apiTest.mutate()}
                  disabled={apiTest.isPending}
                >
                  {apiTest.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <PlugZap className="size-4" />
                  )}
                  تجربة المفتاح
                </Button>
              )}
              {secret.name === "OPENAI_ADMIN_API_KEY" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => adminTest.mutate()}
                  disabled={adminTest.isPending}
                >
                  {adminTest.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <PlugZap className="size-4" />
                  )}
                  تجربة المفتاح
                </Button>
              )}
              <Badge variant={locationVariant(secret.location)}>{LOCATION_LABEL[secret.location]}</Badge>
            </div>
          </div>
        ))}
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        تُعرض الحالة فقط ولا تُقرأ قيمة أي مفتاح في المتصفح. القراءة أثناء التشغيل: بيئة المشروع أولًا ثم الخزانة.
      </p>
    </div>
  );
}
