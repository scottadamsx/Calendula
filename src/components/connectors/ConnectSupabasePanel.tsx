"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { connectSupabase, type ConnectResult } from "@/app/actions/connectSupabase";

const initialState: ConnectResult | null = null;

export function ConnectSupabasePanel({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(connectSupabase, initialState);

  if (!open) {
    return (
      <div className="flex justify-end mt-3">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          {configured ? "Reconnect" : "Connect"}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 w-full flex flex-col gap-4 border-t border-line pt-4">
      <div className="text-xs text-ink-soft leading-relaxed">
        <p className="font-semibold text-ink mb-1">1. Create a project</p>
        <p>
          At{" "}
          <a
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="text-brand-600 hover:text-brand-700 underline"
          >
            supabase.com/dashboard
          </a>{" "}
          — free, no card required.
        </p>
        <p className="font-semibold text-ink mt-3 mb-1">2. Copy four values</p>
        <p>
          Project Settings → API for the URL, anon key, and service role key. Project Settings →
          Database → Connection string (URI) for the database URL.
        </p>
        <p className="font-semibold text-ink mt-3 mb-1">3. Paste below</p>
        <p>
          This app tests the connection, applies the schema itself, and saves everything to{" "}
          <code className="font-data">.env.local</code> — nothing else to run.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <Field label="Project URL" name="url" placeholder="https://xxxx.supabase.co" />
        <Field label="anon public key" name="anonKey" placeholder="eyJ..." />
        <Field label="service role key" name="serviceRoleKey" placeholder="eyJ..." secret />
        <Field
          label="Database URL (connection string)"
          name="dbUrl"
          placeholder="postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres"
          secret
        />

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Connecting…" : "Save & connect"}
          </Button>
          <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>

      {state && (
        <ul className="flex flex-col gap-2">
          {state.steps.map((step) => (
            <li key={step.label} className="flex items-start gap-2">
              <Badge tone={step.ok ? "success" : "danger"}>{step.ok ? "OK" : "Failed"}</Badge>
              <div>
                <div className="text-xs font-semibold text-ink">{step.label}</div>
                <div className="text-xs text-ink-soft">{step.detail}</div>
              </div>
            </li>
          ))}
          {state.ok && (
            <li className="text-xs text-accent-habit font-semibold mt-1">
              Connected. Refresh Settings to see it reflected.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Field({
  label,
  name,
  placeholder,
  secret,
}: {
  label: string;
  name: string;
  placeholder: string;
  secret?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <input
        type={secret ? "password" : "text"}
        name={name}
        required
        placeholder={placeholder}
        className="font-data h-10 px-3 text-xs rounded-sm border border-line bg-surface text-ink placeholder:text-ink-faint focus-visible:outline-none"
      />
    </label>
  );
}
