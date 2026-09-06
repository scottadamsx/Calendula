import Anthropic from "@anthropic-ai/sdk";
import { AGENT_TOOLS, executeAgentTool } from "./tools";

/**
 * The agent's manual tool-use loop (not the SDK's tool runner — the runner
 * drives the loop in one Node process, but this conversation is persisted
 * to Supabase and "paused" across separate HTTP requests whenever the
 * model asks a multiple-choice question the user answers by clicking a
 * button later. A manual loop that stops and returns control the moment it
 * sees `ask_multiple_choice` is the natural fit; the pause itself needs no
 * dedicated state — an unanswered `tool_use` block sitting as the last
 * message *is* the pause, and answering it is just the next turn's
 * `tool_result`.
 */
function systemPrompt(timezone: string): string {
  const now = new Date().toISOString();
  return [
    "You are Calendula's scheduling assistant. You read and update the user's real calendar through the tools you're given — you never invent a placement time yourself, the scheduler does that.",
    `The user's timezone is ${timezone}. The current UTC instant is ${now}. Always convert to their local time before reasoning about "today," "tomorrow," or a specific day.`,
    "Every date/time you pass to a tool must be a plain local datetime string \"YYYY-MM-DDTHH:mm\" with no timezone offset — the same format a browser's local date/time picker would send.",
    "Be direct and brief — this is a chat, not an essay. After calling a tool, summarize what actually happened in one or two sentences, including anything the tool reported (like a conflict or an unplaceable task) — never claim something worked if the tool result says it didn't.",
    "Use ask_multiple_choice only when you genuinely can't proceed without more information — a real ambiguity, not something you could reasonably default. Don't ask about things that don't matter (e.g. don't ask whether a task is 'important' if the user didn't bring it up).",
    "Use get_week_overview to check what's already scheduled before adding something time-sensitive, rather than guessing whether it conflicts.",
  ].join("\n\n");
}

/**
 * Runs one full turn starting from `history` (which already includes the
 * new user message or tool-result the caller is responding with) and
 * returns only the *new* messages produced this turn — the caller persists
 * those. Loops through tool calls automatically; stops and returns as soon
 * as the model either finishes (`end_turn`) or asks a multiple-choice
 * question (a pending, unanswered `ask_multiple_choice` tool_use is what
 * pauses the conversation for the user to respond to).
 */
export async function runAgentTurn(
  userId: string,
  timezone: string,
  history: Anthropic.MessageParam[],
): Promise<Anthropic.MessageParam[]> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [...history];
  const newMessages: Anthropic.MessageParam[] = [];

  // Hard ceiling so a misbehaving tool loop can't run away — a real turn
  // finishes in a handful of iterations at most.
  for (let iteration = 0; iteration < 10; iteration++) {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      system: systemPrompt(timezone),
      tools: AGENT_TOOLS,
      messages,
    });

    const assistantMessage: Anthropic.MessageParam = { role: "assistant", content: response.content };
    messages.push(assistantMessage);
    newMessages.push(assistantMessage);

    if (response.stop_reason !== "tool_use") break;

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const question = toolUseBlocks.find((b) => b.name === "ask_multiple_choice");
    if (question) break; // pause here — the UI renders the question and waits for a click

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const result = await executeAgentTool(block.name, block.input as Record<string, unknown>, { userId, timezone });
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    const toolResultMessage: Anthropic.MessageParam = { role: "user", content: toolResults };
    messages.push(toolResultMessage);
    newMessages.push(toolResultMessage);
  }

  return newMessages;
}
