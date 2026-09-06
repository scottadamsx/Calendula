"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
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

const TOOL_LABELS: Record<string, string> = {
  create_task: "Added a task",
  create_habit: "Added a habit",
  create_fixed_block: "Added a fixed commitment",
  create_reminder: "Added a reminder",
  get_week_overview: "Checked the schedule",
};

function findAnsweredText(messages: StoredMessage[], toolUseId: string): string | null {
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const block of m.content) {
      if (block.type === "tool_result" && (block as { tool_use_id: string }).tool_use_id === toolUseId) {
        const content = (block as { content: unknown }).content;
        return typeof content === "string" ? content : JSON.stringify(content);
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
    <div className="mt-2 rounded-sm border border-line bg-brand-50/60 p-3 max-w-[70ch]">
      <p className="text-sm text-ink mb-2">{question}</p>
      {answered ? (
        <span className="text-xs font-medium text-brand-700">You chose: {answered}</span>
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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setError(null);
    setInput("");
    // Optimistic user bubble — replaced by the real persisted copy (with the
    // rest of the turn appended after it) once the action returns.
    const optimisticUserMessage: StoredMessage = { role: "user", content: [{ type: "text", text }] };
    setMessages((prev) => [...prev, optimisticUserMessage]);
    startTransition(async () => {
      const result = await sendChatMessage(text);
      if (!result.ok) {
        setError(result.message ?? "Something went wrong.");
        setMessages((prev) => prev.slice(0, -1)); // drop the optimistic bubble, nothing was actually saved
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

  return (
    <div className="flex flex-col h-[calc(100vh-160px)]">
      <div className="flex-1 overflow-y-auto flex flex-col gap-4 pb-4">
        {messages.length === 0 && (
          <p className="text-sm text-ink-faint">
            Tell me what you need — add a task, block off your work hours, set a reminder, or ask what your week looks like.
          </p>
        )}
        {messages.map((m, i) => {
          if (m.role === "user") {
            const textBlocks = m.content.filter((b): b is { type: "text"; text: string } => b.type === "text");
            if (textBlocks.length === 0) return null; // tool_result-only turns render inline under their question instead
            return (
              <div key={i} className="self-end max-w-[70ch] bg-brand-600 text-white rounded-sm px-4 py-2 text-sm">
                {textBlocks.map((b) => b.text).join("\n")}
              </div>
            );
          }

          return (
            <div key={i} className="flex flex-col gap-2 self-start max-w-[80ch]">
              {m.content.map((block, j) => {
                if (block.type === "text") {
                  const text = (block as { text?: string }).text;
                  if (!text) return null;
                  return (
                    <div key={j} className="bg-surface border border-line rounded-sm px-4 py-2 text-sm text-ink">
                      {text}
                    </div>
                  );
                }
                if (block.type === "tool_use" && block.name === "ask_multiple_choice") {
                  const input = block.input as { question: string; options: string[] };
                  const answered = findAnsweredText(messages, block.id as string);
                  return (
                    <QuestionButtons
                      key={j}
                      toolUseId={block.id as string}
                      question={input.question}
                      options={input.options}
                      answered={answered}
                      disabled={isPending}
                      onAnswer={handleAnswer}
                    />
                  );
                }
                if (block.type === "tool_use") {
                  const name = block.name as string;
                  return (
                    <span key={j} className="text-xs text-ink-faint">
                      {TOOL_LABELS[name] ?? name}
                    </span>
                  );
                }
                return null;
              })}
            </div>
          );
        })}
        {isPending && <span className="text-xs text-ink-faint self-start">Thinking…</span>}
        <div ref={bottomRef} />
      </div>

      {error && <p className="text-xs text-danger mb-2">{error}</p>}

      <div className="flex items-end gap-2 border-t border-line pt-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="e.g. I have work every day Monday to Friday, 9 to 5"
          rows={2}
          className="flex-1 px-3 py-2 text-sm rounded-sm border border-line bg-surface text-ink focus-visible:outline-none resize-none"
        />
        <Button size="md" disabled={isPending || !input.trim()} onClick={handleSend}>
          {isPending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
