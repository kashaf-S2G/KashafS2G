import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

/**
 * Client-side function middleware that attaches the current Supabase session
 * access token to outgoing server function requests as an
 * `Authorization: Bearer <token>` header.
 *
 * This is required for server functions guarded by `requireSupabaseAuth` to
 * receive a valid JWT and authenticate the caller.
 */
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (token) {
      return next({
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    return next();
  },
);
