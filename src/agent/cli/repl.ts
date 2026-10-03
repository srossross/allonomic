import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { userPromptMessage } from "../../core/graph/userPrompt";
import { createWorkerAgent } from "../worker";
import { createNodeRuntime } from "../../adapters/node/runtime";

async function main() {
  const agent = await createWorkerAgent({ runtime: createNodeRuntime(), enableTools: false });
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

      const result = await agent.compiled.invoke(
        { messages: [userPromptMessage(trimmed)] },
        config
      );

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
    if (errorName === "AbortError" || errorCode === "ERR_USE_AFTER_CLOSE") {
      console.log("\nSession closed.");
    } else {
      console.error("\nError:", errorMessage);
      process.exitCode = 1;
    }
  } finally {
    rl.close();
  }
}

await main();
