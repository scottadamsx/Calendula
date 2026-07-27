"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { QaPhaseState } from "@/lib/qa/store";

type FormAction = (formData: FormData) => void | Promise<void>;

export function PhaseRow({
  name,
  detail,
  qaState,
  markVerified,
  reportBug,
  resolveBug,
}: {
  name: string;
  detail: string;
  qaState: QaPhaseState;
  markVerified: FormAction;
  reportBug: FormAction;
  resolveBug: (bugId: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);

  const openBugs = qaState.bugs.filter((b) => !b.resolvedAt);
  const resolvedBugs = qaState.bugs.filter((b) => b.resolvedAt);

  const badge =
    openBugs.length > 0
      ? { tone: "danger" as const, label: `${openBugs.length} bug${openBugs.length > 1 ? "s" : ""} reported` }
      : qaState.verified
        ? { tone: "success" as const, label: "Verified" }
        : { tone: "warn" as const, label: "Testing needed" };

  return (
    <li className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start justify-between gap-4 py-3 text-left"
      >
        <div>
          <div className="text-sm font-medium text-ink">{name}</div>
          <div className="text-xs text-ink-soft mt-0.5">{detail}</div>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </button>

      {expanded && (
        <div className="pb-4 flex flex-col gap-3">
          {qaState.verified && !openBugs.length && qaState.verifiedAt && (
            <p className="text-xs text-ink-faint">
              Confirmed working {new Date(qaState.verifiedAt).toLocaleString()}.
            </p>
          )}

          {qaState.bugs.length > 0 && (
            <ul className="flex flex-col gap-2">
              {[...openBugs, ...resolvedBugs].map((bug) => (
                <li
                  key={bug.id}
                  className={`border-l-2 pl-3 py-1 ${bug.resolvedAt ? "border-line" : "border-danger"}`}
                >
                  <p className={`text-xs ${bug.resolvedAt ? "text-ink-faint line-through" : "text-ink"}`}>
                    {bug.text}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-data text-[11px] text-ink-faint">
                      {new Date(bug.reportedAt).toLocaleString()}
                    </span>
                    {!bug.resolvedAt && (
                      <form action={resolveBug.bind(null, bug.id)}>
                        <button
                          type="submit"
                          className="text-[11px] font-semibold text-brand-600 hover:text-brand-700"
                        >
                          Mark resolved
                        </button>
                      </form>
                    )}
                    {bug.resolvedAt && (
                      <span className="text-[11px] text-ink-faint">
                        resolved {new Date(bug.resolvedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <form action={markVerified}>
              <Button type="submit" variant="primary" size="sm">
                Confirm it works
              </Button>
            </form>
          </div>

          <form action={reportBug} className="flex flex-col gap-2">
            <textarea
              name="bug"
              required
              rows={2}
              placeholder="What's broken? Be specific — page, action, what you expected vs. saw."
              className="text-sm rounded-sm border border-line bg-surface p-2 text-ink placeholder:text-ink-faint focus-visible:outline-none"
            />
            <div>
              <Button type="submit" variant="danger" size="sm">
                Report a bug
              </Button>
            </div>
          </form>
        </div>
      )}
    </li>
  );
}
