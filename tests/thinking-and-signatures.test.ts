import { describe, it, expect } from "bun:test";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import {
  extractThinking,
  extractFinalResponse,
  sanitizeMessagesForModel,
  stripThinking,
} from "../src/core/graph/thinking";
import {
  convertMessageContentToParts,
  _FUNCTION_CALL_THOUGHT_SIGNATURES_MAP_KEY,
} from "../node_modules/@langchain/google-genai/dist/utils/common.js";

describe("Gemini 3 Thinking & Thought Signatures Flow", () => {
  it("extracts thinking from both modern LangChain 2.x 'thinking' parts and legacy 'thought' parts", () => {
    const modernMsg = new AIMessage({
      content: [
        { type: "thinking", thinking: "Step 1: Check requirements." },
        { type: "text", text: "Here is your answer." },
      ],
    });
    expect(extractThinking(modernMsg)).toBe("Step 1: Check requirements.");

    const legacyMsg = new AIMessage({
      content: [
        { type: "thought", text: "Legacy thought process." },
        { type: "text", text: "Answer." },
      ],
    });
    expect(extractThinking(legacyMsg)).toBe("Legacy thought process.");

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

    const { response, thinking } = extractFinalResponse(messages, 0);
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
    expect(Array.isArray(sanitized.content)).toBe(true);
    if (Array.isArray(sanitized.content)) {
      expect(
        sanitized.content.some(
          (p) =>
            typeof p === "object" &&
            p !== null &&
            ("thinking" in p || ("type" in p && (p.type === "thinking" || p.type === "thought")))
        )
      ).toBe(false);
    }

    expect(
      sanitized.additional_kwargs?.[_FUNCTION_CALL_THOUGHT_SIGNATURES_MAP_KEY]?.["call_abc123"]
    ).toBe("cryptographic_sig_xyz");
  });

  it("stripThinking removes every thinking form without touching the worker's messages", () => {
    const original = new AIMessage({
      content: [
        { type: "thinking", thinking: "modern thinking" },
        { type: "thought", text: "legacy thought" },
        { type: "text", text: "gemini thought", thought: true },
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
        thinking: "kwargs thinking",
        [_FUNCTION_CALL_THOUGHT_SIGNATURES_MAP_KEY]: { call_abc123: "sig" },
      },
    });

    const [stripped] = stripThinking([original]);

    expect(stripped.content).toEqual([{ type: "text", text: "I will call push_intent" }]);
    expect(extractThinking(stripped)).toBe("");
    expect(stripped.additional_kwargs.thinking).toBeUndefined();
    expect(
      stripped.additional_kwargs[_FUNCTION_CALL_THOUGHT_SIGNATURES_MAP_KEY]?.["call_abc123"]
    ).toBe("sig");
    expect(AIMessage.isInstance(stripped) && stripped.tool_calls?.[0].id).toBe("call_abc123");

    expect(original.content).toHaveLength(4);
    expect(original.additional_kwargs.thinking).toBe("kwargs thinking");
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

  it("extractFinalResponse does not leak Turn 1 text or thinking when Turn 2 ends on a tool", () => {
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
        content: "Successfully wrote 5 bytes to foo.txt",
        tool_call_id: "tc_123",
      }),
    ];

    const { response, thinking } = extractFinalResponse(multiTurnMessages, 2);
    expect(response).toBe("");
    expect(thinking).toBe("Tool selection thinking trace");
    expect(thinking.includes("Greeting thinking trace")).toBe(false);
  });
});
