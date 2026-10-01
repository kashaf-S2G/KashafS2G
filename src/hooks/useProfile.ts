import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const profileQueryKey = (userId: string | null) => ["profile", userId] as const;

export function useProfile() {
  const { userId } = useAuth();

  return useQuery({
    queryKey: profileQueryKey(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
      if (error) throw error;

      let avatarUrl: string | null = null;
      if (data.avatar_path) {
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(data.avatar_path, 60 * 60);
        avatarUrl = signed?.signedUrl ?? null;
      }

      return { ...data, avatarUrl };
    },
  });
}