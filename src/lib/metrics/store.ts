import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { MetricDefinition, MetricSetting, ResolvedMetric } from "./types";

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export function useMetricDefinitions() {
  return useQuery({
    queryKey: ["metrics"],
    queryFn: async (): Promise<MetricDefinition[]> => {
      const { data, error } = await supabase
        .from("metrics")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((m) => ({
        ...m,
        default_target: num(m.default_target),
        default_min: num(m.default_min),
        default_max: num(m.default_max),
        default_weight: Number(m.default_weight),
        calculation_definition: (m.calculation_definition ?? {}) as Record<string, unknown>,
      })) as MetricDefinition[];
    },
  });
}

export function useMetricSettings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["user_metric_settings", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<MetricSetting[]> => {
      const { data, error } = await supabase.from("user_metric_settings").select("*");
      if (error) throw error;
      return (data ?? []).map((s) => ({
        metric_id: s.metric_id,
        enabled: s.enabled,
        target_value: num(s.target_value),
        minimum_value: num(s.minimum_value),
        maximum_value: num(s.maximum_value),
        weight: Number(s.weight),
        scoring_method: s.scoring_method,
      }));
    },
  });
}

/** دمج تعريف المقياس مع إعداد المستخدم؛ عند غياب الإعداد تُستخدم القيم الافتراضية. */
export function useResolvedMetrics() {
  const defs = useMetricDefinitions();
  const settings = useMetricSettings();

  const metrics = useMemo<ResolvedMetric[]>(() => {
    const byId = new Map((settings.data ?? []).map((s) => [s.metric_id, s]));
    return (defs.data ?? []).map((d) => {
      const s = byId.get(d.id);
      return {
        ...d,
        metric_id: d.id,
        enabled: s?.enabled ?? d.is_available,
        target_value: s?.target_value ?? d.default_target,
        minimum_value: s?.minimum_value ?? d.default_min,
        maximum_value: s?.maximum_value ?? d.default_max,
        weight: s?.weight ?? d.default_weight,
        scoring_method: s?.scoring_method ?? d.default_scoring_method,
      };
    });
  }, [defs.data, settings.data]);

  return { metrics, isLoading: defs.isLoading || settings.isLoading };
}

/** حفظ عدة إعدادات دفعة واحدة (يُستخدم عند إعادة توزيع الأوزان). */
export function useSaveMetricSettings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (settings: MetricSetting[]) => {
      if (!user) throw new Error("يجب تسجيل الدخول");
      const rows = settings.map((s) => ({
        owner_id: user.id,
        metric_id: s.metric_id,
        enabled: s.enabled,
        target_value: s.target_value,
        minimum_value: s.minimum_value,
        maximum_value: s.maximum_value,
        weight: s.weight,
        scoring_method: "binary",
      }));
      const { error } = await supabase
        .from("user_metric_settings")
        .upsert(rows, { onConflict: "owner_id,metric_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["user_metric_settings"] });
    },
  });
}

export function useSaveMetricSetting() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (setting: MetricSetting) => {
      if (!user) throw new Error("يجب تسجيل الدخول");
      const { error } = await supabase.from("user_metric_settings").upsert(
        {
          owner_id: user.id,
          metric_id: setting.metric_id,
          enabled: setting.enabled,
          target_value: setting.target_value,
          minimum_value: setting.minimum_value,
          maximum_value: setting.maximum_value,
          weight: setting.weight,
          scoring_method: setting.scoring_method,
        },
        { onConflict: "owner_id,metric_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["user_metric_settings"] });
    },
  });
}
