"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/Button";
import { CalendulaMark } from "@/components/brand/CalendulaMark";
import { sendChatMessage, answerMultipleChoice } from "@/app/actions/chat";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | { type: string; [key: string]: unknown };

export interface StoredMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

const SHELL_BOTTOM_PADDING_PX = 32; // AppShell's py-8

const TOOL_LABELS: Record<string, { label: string; tone: string }> = {
  create_task: { label: "Added a task", tone: "bg-brand-600" },
  create_habit: { label: "Added a habit", tone: "bg-accent-habit" },
  create_fixed_block: { label: "Added a commitment", tone: "bg-ink" },
  create_reminder: { label: "Added a reminder", tone: "bg-accent-reminder" },
  get_week_overview: { label: "Checked the week", tone: "bg-ink-faint" },
  list_calendar_items: { label: "Looked up the calendar", tone: "bg-ink-faint" },
  delete_calendar_item: { label: "Deleted", tone: "bg-danger" },
};

/** Claude-style prose: the model writes light markdown; render it as real typography, never raw symbols. */
const MD_COMPONENTS = {
  p: (props: React.ComponentProps<"p">) => <p className="mb-3 last:mb-0" {...props} />,
  ul: (props: React.ComponentProps<"ul">) => <ul className="mb-3 last:mb-0 pl-5 list-disc marker:text-ink-faint space-y-1" {...props} />,
  ol: (props: React.ComponentProps<"ol">) => <ol className="mb-3 last:mb-0 pl-5 list-decimal marker:text-ink-faint space-y-1" {...props} />,
  li: (props: React.ComponentProps<"li">) => <li className="pl-1" {...props} />,
  strong: (props: React.ComponentProps<"strong">) => <strong className="font-semibold text-ink" {...props} />,
  em: (props: React.ComponentProps<"em">) => <em className="italic" {...props} />,
  code: (props: React.ComponentProps<"code">) => <code className="font-data text-[13px] rounded-sm border border-line bg-paper px-1 py-px" {...props} />,
  a: (props: React.ComponentProps<"a">) => <a className="text-brand-700 underline underline-offset-2" {...props} />,
  h1: (props: React.ComponentProps<"h1">) => <p className="font-semibold text-ink mb-2" {...props} />,
  h2: (props: React.ComponentProps<"h2">) => <p className="font-semibold text-ink mb-2" {...props} />,
  h3: (props: React.ComponentProps<"h3">) => <p className="font-semibold text-ink mb-2" {...props} />,
};

function tidy(text: string) {
  return text.replace(/\s*—\s*/g, ", ").replace(/\s*–\s*(?=[A-Za-z])/g, ", ");
}

function findAnsweredText(messages: StoredMessage[], toolUseId: string): string | null {
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const block of m.content) {
      if (block.type === "tool_result" && (block as { tool_use_id: string }).tool_use_id === toolUseId) {
        const content = (block as { content: unknown }).content;
        const raw = typeof content === "string" ? content : JSON.stringify(content);
        return raw.startsWith("The user didn't pick") ? "(answered in the next message)" : raw;
      }
    }
  }
  return null;
}

function QuestionButtons({
  toolUseId,
  question,
  options,
  answered,
  disabled,
  onAnswer,
}: {
  toolUseId: string;
  question: string;
  options: string[];
  answered: string | null;
  disabled: boolean;
  onAnswer: (toolUseId: string, option: string) => void;
}) {
  return (
    <div className="mt-1 rounded-lg border border-line bg-surface p-4 max-w-[64ch]">
      <p className="text-[15px] leading-6 text-ink mb-3">{question}</p>
      {answered ? (
        <span className="inline-flex h-8 items-center rounded-full bg-brand-50 border border-brand-200 px-3 text-xs font-semibold text-brand-700">
          {answered}
        </span>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => (
            <Button key={opt} variant="secondary" size="sm" disabled={disabled} onClick={() => onAnswer(toolUseId, opt)}>
              {opt}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatInterface({ initialMessages }: { initialMessages: StoredMessage[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [height, setHeight] = useState("60dvh");

  // The header above this component isn't a fixed size (it wraps on narrow
  // screens), so measure where the chat actually starts and fill exactly the
  // rest of the viewport — a hard-coded offset left the page itself scrolling.
  useEffect(() => {
    function fit() {
      const top = rootRef.current?.getBoundingClientRect().top ?? 0;
      setHeight(`calc(100dvh - ${Math.round(top + window.scrollY)}px - ${SHELL_BOTTOM_PADDING_PX}px)`);
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isPending]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  function handleSend() {
    const text = input.trim();
    if (!text || isPending) return;
    setError(null);
    setInput("");
    const optimisticUserMessage: StoredMessage = { role: "user", content: [{ type: "text", text }] };
    setMessages((prev) => [...prev, optimisticUserMessage]);
    startTransition(async () => {
      const result = await sendChatMessage(text);
      if (!result.ok) {
        setError(result.message ?? "Something went wrong.");
        setMessages((prev) => prev.slice(0, -1));
        return;
      }
      setMessages((prev) => [...prev.slice(0, -1), ...((result.newMessages as StoredMessage[]) ?? [])]);
    });
  }

  function handleAnswer(toolUseId: string, option: string) {
    setError(null);
    startTransition(async () => {
      const result = await answerMultipleChoice(toolUseId, option);
      if (!result.ok) {
        setError(result.message ?? "Something went wrong.");
        return;
      }
      setMessages((prev) => [...prev, ...((result.newMessages as StoredMessage[]) ?? [])]);
    });
  }

  // Group consecutive assistant rows (tool loop iterations) into one visual turn.
  const turns: { role: "user" | "assistant"; blocks: { block: ContentBlock; key: string }[] }[] = [];
  messages.forEach((m, i) => {
    const visible = m.content.filter((b) => {
      if (m.role === "user") return b.type === "text";
      if (b.type === "text") return Boolean((b as { text?: string }).text?.trim());
      return b.type === "tool_use";
    });
    if (visible.length === 0) return;
    const last = turns[turns.length - 1];
    const entries = visible.map((block, j) => ({ block, key: `${i}-${j}` }));
    if (last && last.role === m.role && m.role === "assistant") last.blocks.push(...entries);
    else turns.push({ role: m.role, blocks: entries });
  });

  return (
    <div ref={rootRef} className="flex flex-col min-h-[320px]" style={{ height }}>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[78ch] flex flex-col gap-6 pb-6 pr-1">
          {turns.length === 0 && (
            <p className="text-[15px] leading-7 text-ink-soft">
              Tell me what&rsquo;s going on. Add a task, block off your work hours, set a reminder, or ask what your week looks like.
            </p>
          )}
          {turns.map((turn, t) => {
            if (turn.role === "user") {
              const text = turn.blocks.map(({ block }) => (block as { text: string }).text).join("\n");
              return (
                <div key={t} className="flex justify-end">
                  <div className="max-w-[80%] rounded-lg bg-brand-50 border border-brand-200 px-4 py-2.5 text-[15px] leading-6 text-ink whitespace-pre-wrap">
                    {text}
                  </div>
                </div>
              );
            }
            return (
              <div key={t} className="flex gap-3">
                <div className="shrink-0 mt-1"><CalendulaMark size={20} /></div>
                <div className="min-w-0 flex-1 flex flex-col gap-2">
                  {turn.blocks.map(({ block, key }) => {
                    if (block.type === "text") {
                      return (
                        <div key={key} className="text-[15px] leading-7 text-ink">
                          <ReactMarkdown components={MD_COMPONENTS}>{tidy((block as { text: string }).text)}</ReactMarkdown>
                        </div>
                      );
                    }
                    if (block.type === "tool_use" && block.name === "ask_multiple_choice") {
                      const input = block.input as { question: string; options: string[] };
                      return (
                        <QuestionButtons
                          key={key}
                          toolUseId={block.id as string}
                          question={input.question}
                          options={input.options}
                          answered={findAnsweredText(messages, block.id as string)}
                          disabled={isPending}
                          onAnswer={handleAnswer}
                        />
                      );
                    }
                    const tool = block as { name?: string; input?: { title?: unknown } };
                    const meta = TOOL_LABELS[tool.name ?? ""] ?? { label: String(tool.name), tone: "bg-ink-faint" };
                    const title = typeof tool.input?.title === "string" ? tool.input.title : null;
                    return (
                      <div key={key} className="inline-flex items-center gap-2 text-xs text-ink-soft">
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.tone}`} />
                        <span className="font-medium">{meta.label}</span>
                        {title && <span className="text-ink-faint truncate max-w-[40ch]">{title}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {isPending && (
            <div className="flex gap-3">
              <div className="shrink-0 mt-1"><CalendulaMark size={20} /></div>
              <span className="text-sm text-ink-faint animate-pulse">Thinking</span>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[78ch]">
        {error && <p className="text-xs text-danger mb-2">{error}</p>}
        <div className="flex items-end gap-2 rounded-lg border border-line bg-surface p-2 focus-within:border-brand-400 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Message Calendula"
            rows={1}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-6 text-ink placeholder:text-ink-faint focus-visible:outline-none"
          />
          <Button size="sm" disabled={isPending || !input.trim()} onClick={handleSend}>
            {isPending ? "Sending" : "Send"}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">Enter to send, Shift+Enter for a new line.</p>
      </div>
    </div>
  );
}
