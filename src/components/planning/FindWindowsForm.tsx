"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { searchFutureWindows, createActivityHold, type FindWindowsResult } from "@/app/actions/activityHolds";

const initialState: FindWindowsResult | null = null;
const inputClass = "h-10 px-3 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none";

function HoldButton({ activityTypeId, startDay, endDay }: { activityTypeId: string; startDay: string; endDay: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1 items-end">
      <Button
        variant="secondary"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await createActivityHold(activityTypeId, startDay, endDay);
            setMessage(result.message);
          })
        }
      >
        {isPending ? "Holding…" : "Hold this window"}
      </Button>
      {message && <span className="text-xs text-ink-soft max-w-[280px] text-right">{message}</span>}
    </div>
  );
}

export function FindWindowsForm({ activityTypes }: { activityTypes: { id: string; name: string }[] }) {
  const [state, formAction, isPending] = useActionState(searchFutureWindows, initialState);

  return (
    <Panel>
      <h2 className="text-base font-semibold mb-1">Find a window</h2>
      <p className="text-xs text-ink-soft mb-3">
        Scores candidate day-runs by how busy the surrounding stretch already is, not just whether
        the calendar is blank right now.
      </p>
      {activityTypes.length === 0 ? (
        <p className="text-xs text-ink-faint">Add an activity type above first.</p>
      ) : (
        <>
          <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
            <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <span className="text-xs font-medium text-ink-soft">Activity</span>
              <select name="activityTypeId" required className={inputClass}>
                {activityTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 w-[130px]">
              <span className="text-xs font-medium text-ink-soft">Within (days)</span>
              <input type="number" name="horizonDays" min={7} max={180} required defaultValue={90} className={`font-data ${inputClass}`} />
            </label>
            <Button type="submit" size="md" disabled={isPending}>
              {isPending ? "Searching…" : "Find windows"}
            </Button>
          </form>
          {state && (
            <div className="mt-3">
              <p className={`text-xs mb-2 ${state.ok ? "text-ink-soft" : "text-danger"}`}>{state.message}</p>
              {state.windows.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {state.windows.map((w) => (
                    <li
                      key={`${w.startDay}-${w.endDay}`}
                      className="flex items-center justify-between gap-3 pl-2 border-l-2 border-brand-600"
                    >
                      <div>
                        <span className="font-data text-sm text-ink">
                          {w.startDay} – {w.endDay}
                        </span>
                        <span className="text-xs text-ink-soft ml-2">score {w.score.toFixed(2)}</span>
                        <div className="text-xs text-ink-faint">
                          load in window {(w.reasons.loadIn * 100).toFixed(0)}%, flanking{" "}
                          {(w.reasons.loadFlank * 100).toFixed(0)}%
                          {w.reasons.deadlinePenalty > 0 && `, a deadline lands right after`}
                        </div>
                      </div>
                      <HoldButton activityTypeId={state.activityTypeId ?? ""} startDay={w.startDay} endDay={w.endDay} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
