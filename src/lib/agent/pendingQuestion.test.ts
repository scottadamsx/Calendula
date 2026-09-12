import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { unansweredQuestionIds, userMessageAnswering } from "./pendingQuestion";

const question: Anthropic.MessageParam = {
  role: "assistant",
  content: [
    { type: "text", text: "Which day?" },
    { type: "tool_use", id: "toolu_q1", name: "ask_multiple_choice", input: { question: "Which day?", options: ["Tue", "Thu"] } },
  ],
};

describe("typing instead of clicking a multiple-choice option", () => {
  it("finds the unanswered question only when it is the last thing the assistant said", () => {
    expect(unansweredQuestionIds([question])).toEqual(["toolu_q1"]);
    const answered: Anthropic.MessageParam[] = [
      question,
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_q1", content: "Tue" }] },
      { role: "assistant", content: [{ type: "text", text: "Done." }] },
    ];
    expect(unansweredQuestionIds(answered)).toEqual([]);
  });

  it("delivers the typed text as the question's answer — tool_result first, then the text", () => {
    const msg = userMessageAnswering([question], "never mind, forget it");
    expect(Array.isArray(msg.content) && msg.content.map((b) => b.type)).toEqual(["tool_result", "text"]);
    const [result] = msg.content as Anthropic.ToolResultBlockParam[];
    expect(result.tool_use_id).toBe("toolu_q1");
  });

  it("is a plain text message when nothing is pending", () => {
    const msg = userMessageAnswering([{ role: "assistant", content: [{ type: "text", text: "Hi" }] }], "hello");
    expect(msg.content).toEqual([{ type: "text", text: "hello" }]);
  });
});
