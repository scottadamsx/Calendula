import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server Component / route handler client — reads and writes the session cookie. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component with no response to attach to.
            // Fine as long as middleware.ts is also refreshing the session.
          }
        },
      },
    },
  );
}
