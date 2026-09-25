import { describe, it, expect } from "bun:test";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import {
  extractThinking,
  extractFinalResponse,
  sanitizeMessagesForModel,
} from "../src/interceptor-agents/pipeline/thinking";
import { extractAssistantText } from "../src/agent/messageExtractors";
import {
  convertMessageContentToParts,
  _FUNCTION_CALL_THOUGHT_SIGNATURES_MAP_KEY,
} from "../node_modules/@langchain/google-genai/dist/utils/common.js";

describe("Gemini 3 Thinking & Thought Signatures Flow", () => {
  it("extracts thinking from both modern LangChain 2.x 'thinking' parts and legacy 'thought' parts", () => {
    // Modern LangChain 2.x thinking format
    const modernMsg = new AIMessage({
      content: [
        { type: "thinking", thinking: "Step 1: Check requirements." },
        { type: "text", text: "Here is your answer." },
      ],
    });
    expect(extractThinking(modernMsg)).toBe("Step 1: Check requirements.");

    // Legacy thought format
    const legacyMsg = new AIMessage({
      content: [
        { type: "thought", text: "Legacy thought process." },
        { type: "text", text: "Answer." },
      ],
    });
    expect(extractThinking(legacyMsg)).toBe("Legacy thought process.");

    // additional_kwargs thinking fallback
    const kwargsMsg = new AIMessage({
      content: "Result text",
      additional_kwargs: { thinking: "Kwargs thinking trace." },
    });
    expect(extractThinking(kwargsMsg)).toBe("Kwargs thinking trace.");
  });

  it("extractFinalResponse isolates user-facing response from internal thinking parts", () => {
    const messages = [
      new AIMessage({
        content: [
          { type: "thinking", thinking: "Internal calculation..." },
          { type: "text", text: "All systems nominal." },
        ],
      }),
    ];

    const { response, thinking } = extractFinalResponse(messages);
    expect(response).toBe("All systems nominal.");
    expect(thinking).toBe("Internal calculation...");
  });

  it("sanitizeMessagesForModel strips thinking blocks while preserving thought signature metadata", () => {
    const original = new AIMessage({
      content: [
        { type: "thinking", thinking: "Secret internal chain of thought" },
        { type: "text", text: "I will call push_intent" },
      ],
      tool_calls: [
        {
          name: "push_intent",
          args: { kind: "request", description: "test" },
          id: "call_abc123",
          type: "tool_call",
        },
      ],
      additional_kwargs: {
        [_FUNCTION_CALL_THOUGHT_SIGNATURES_MAP_KEY]: {
          call_abc123: "cryptographic_sig_xyz",
        },
      },
    });

    const [sanitized] = sanitizeMessagesForModel([original]);
    // Thinking part should be stripped from content
    expect(Array.isArray(sanitized.content)).toBe(true);
    if (Array.isArray(sanitized.content)) {
      expect(
        sanitized.content.some(
          (p) =>
            typeof p === "object" &&
            p !== null &&
            ("thinking" in p ||
              ("type" in p && (p.type === "thinking" || p.type === "thought")))
        )
      ).toBe(false);
    }

    // Metadata for thought signature must remain intact
    expect(
      sanitized.additional_kwargs?.[_FUNCTION_CALL_THOUGHT_SIGNATURES_MAP_KEY]?.["call_abc123"]
    ).toBe("cryptographic_sig_xyz");
  });

  it("convertMessageContentToParts encodes thoughtSignature on functionCall parts for Gemini 3", () => {
    const toolCallId = "call_gemini_3";
    const explicitSig = "sig_token_abcdef123";

    const aiMessage = new AIMessage({
      content: "",
      tool_calls: [
        {
          name: "push_intent",
          args: { kind: "request", description: "test intent" },
          id: toolCallId,
          type: "tool_call",
        },
      ],
      additional_kwargs: {
        [_FUNCTION_CALL_THOUGHT_SIGNATURES_MAP_KEY]: {
          [toolCallId]: explicitSig,
        },
      },
    });

    const parts = convertMessageContentToParts(aiMessage, true, [], "gemini-3.8-flash");
    expect(parts.length).toBe(1);

    const [callPart] = parts;
    expect(typeof callPart === "object" && callPart !== null).toBe(true);
    if (typeof callPart !== "object" || callPart === null) return;

    expect("functionCall" in callPart).toBe(true);
    expect("thoughtSignature" in callPart).toBe(true);
    if (
      "functionCall" in callPart &&
      typeof callPart.functionCall === "object" &&
      callPart.functionCall !== null &&
      "name" in callPart.functionCall
    ) {
      expect(callPart.functionCall.name).toBe("push_intent");
    }
    if ("thoughtSignature" in callPart) {
      expect(callPart.thoughtSignature).toBe(explicitSig);
    }
  });

  it("convertMessageContentToParts injects DUMMY_SIGNATURE for gemini-3 when signature was not cached", () => {
    const unsavedCallId = "call_no_cached_sig";
    const aiMessage = new AIMessage({
      content: "",
      tool_calls: [
        {
          name: "push_intent",
          args: { kind: "request", description: "synthetic intent" },
          id: unsavedCallId,
          type: "tool_call",
        },
      ],
    });

    // When targeting gemini-3 model without a cached signature, @langchain/google-genai injects DUMMY_SIGNATURE
    const parts = convertMessageContentToParts(aiMessage, true, [], "gemini-3.8-flash");
    const [callPart] = parts;
    expect(typeof callPart === "object" && callPart !== null).toBe(true);
    if (typeof callPart !== "object" || callPart === null) return;

    expect("functionCall" in callPart).toBe(true);
    expect("thoughtSignature" in callPart).toBe(true);
    if (
      "functionCall" in callPart &&
      typeof callPart.functionCall === "object" &&
      callPart.functionCall !== null &&
      "name" in callPart.functionCall
    ) {
      expect(callPart.functionCall.name).toBe("push_intent");
    }
    if ("thoughtSignature" in callPart && typeof callPart.thoughtSignature === "string") {
      expect(callPart.thoughtSignature.length).toBeGreaterThan(0);
    }
  });

  it("extractFinalResponse and extractAssistantText do not leak Turn 1 text or thinking when Turn 2 pauses on a tool", () => {
    // Multi-turn history:
    // Turn 1: User says Hello, AI replies with greeting
    // Turn 2: User says append, AI calls tool, Tool pauses on PENDING_APPROVAL
    const multiTurnMessages = [
      new HumanMessage("Hello"),
      new AIMessage({
        content: [
          { type: "thinking", thinking: "Greeting thinking trace" },
          { type: "text", text: "Hello! How can I help you today?" },
        ],
      }),
      new HumanMessage("append hello to foo.txt"),
      new AIMessage({
        content: [{ type: "thinking", thinking: "Tool selection thinking trace" }],
        tool_calls: [
          {
            name: "write_file",
            args: { filePath: "foo.txt", content: "hello" },
            id: "tc_123",
            type: "tool_call",
          },
        ],
      }),
      new ToolMessage({
        content: "[PENDING_APPROVAL]: Write to foo.txt requires user approval",
        tool_call_id: "tc_123",
      }),
    ];

    // extractFinalResponse must return the PENDING_APPROVAL message text instead of an empty string
    const { response, thinking } = extractFinalResponse(multiTurnMessages);
    expect(response).toBe("[PENDING_APPROVAL]: Write to foo.txt requires user approval");
    expect(thinking).toBe("Tool selection thinking trace");
    expect(thinking.includes("Greeting thinking trace")).toBe(false);

    // extractAssistantText must NOT return Turn 1's greeting
    const assistantText = extractAssistantText(multiTurnMessages);
    expect(assistantText).toBe("");
  });
});
