"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

function Field({ label, name, type }: { label: string; name: string; type: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <input
        type={type}
        name={name}
        required
        className="font-data h-10 px-3 text-xs rounded-sm border border-line bg-surface text-ink focus-visible:outline-none"
      />
    </label>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  async function handleSignIn(formData: FormData) {
    setError(null);
    setSigningIn(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    setSigningIn(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/week");
    router.refresh();
  }

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Sign in"
        lead="Calendula is single-tenant in v1 (spec §4) and shares its Supabase project's auth with heyscottybro — sign in with that same account."
      />

      <div className="max-w-[420px]">
        <Panel>
          <form action={handleSignIn} className="flex flex-col gap-3">
            <Field label="Email" name="email" type="email" />
            <Field label="Password" name="password" type="password" />
            <div>
              <Button type="submit" size="sm" disabled={signingIn}>
                {signingIn ? "Signing in…" : "Sign in"}
              </Button>
            </div>
            {error && <p className="text-xs text-danger">{error}</p>}
          </form>
        </Panel>
      </div>
    </>
  );
}
