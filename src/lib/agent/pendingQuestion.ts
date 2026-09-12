import type Anthropic from "@anthropic-ai/sdk";

/**
 * A paused `ask_multiple_choice` is just an unanswered `tool_use` at the end
 * of the transcript (see chat.ts). The API refuses any next message that
 * doesn't answer it, so when the user types instead of clicking an option,
 * the typed text has to be delivered *as* that answer — a tool_result first,
 * then the text — rather than as a bare new message.
 */
export function unansweredQuestionIds(history: Anthropic.MessageParam[]): string[] {
  const last = history[history.length - 1];
  if (!last || last.role !== "assistant" || typeof last.content === "string") return [];
  return last.content
    .filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use" && b.name === "ask_multiple_choice")
    .map((b) => b.id);
}

export function userMessageAnswering(
  history: Anthropic.MessageParam[],
  text: string,
): Anthropic.MessageParam {
  const pending = unansweredQuestionIds(history);
  if (pending.length === 0) return { role: "user", content: [{ type: "text", text }] };
  return {
    role: "user",
    content: [
      ...pending.map(
        (id): Anthropic.ToolResultBlockParam => ({
          type: "tool_result",
          tool_use_id: id,
          content: "The user didn't pick one of the options — they typed a reply instead. Treat their message as the answer.",
        }),
      ),
      { type: "text", text },
    ],
  };
}
