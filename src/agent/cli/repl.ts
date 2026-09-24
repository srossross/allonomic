import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { HumanMessage } from "@langchain/core/messages";
import { createWorkerAgent } from "../worker";

async function main() {
  const agent = createWorkerAgent({ enableTools: false });
  const rl = readline.createInterface({ input, output });
  const threadId = `repl-${Date.now()}`;
  const config = { configurable: { thread_id: threadId } };

  console.log("ICG Agent REPL (LangGraph + Gemini)");
  console.log("Type 'exit' or press Ctrl+C to quit.\n");

  try {
    while (true) {
      const userInput = await rl.question("> ");
      const trimmed = userInput.trim();

      if (!trimmed) continue;
      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
        break;
      }

      const result = await agent.compiled.invoke({ messages: [new HumanMessage(trimmed)] }, config);

      const lastMessage = result.messages.at(-1);
      const content = lastMessage
        ? typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content)
        : "";

      console.log(`\nAgent:\n${content}\n`);
    }
  } catch (error: unknown) {
    const errorName =
      error && typeof error === "object" && "name" in error ? String(error.name) : "";
    const errorCode =
      error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (
      errorName === "AbortError" ||
      errorCode === "ERR_USE_AFTER_CLOSE" ||
      errorMessage.includes("closed")
    ) {
      console.log("\nSession closed.");
    } else {
      console.error("\nError:", errorMessage);
    }
  } finally {
    rl.close();
  }
}

await main();
