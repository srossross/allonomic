import path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { createWorkerAgent } from "../worker";
import { logConversation } from "../../telemetry/logger";

interface ChunkMessage {
  _getType?: () => string;
  content?: string;
  tool_calls?: Array<{ name: string; args: unknown }>;
}

function isChunkUpdate(value: unknown): value is { messages?: ChunkMessage[] } {
  return typeof value === "object" && value !== null;
}

async function main() {
  const workspaceDir = path.resolve(process.cwd(), "../toy-test-01");
  console.log(`Target workspace: ${workspaceDir}`);

  const agent = createWorkerAgent({ workspaceDir, enableTools: true });

  const defaultPrompt = `page /app \n\n"we pick on sunday"\ncan you add an image to this like a box in the same style?`;
  const userPrompt = process.argv.slice(2).join(" ") || defaultPrompt;

  console.log(`\nUser Prompt:\n${userPrompt}\n`);
  console.log("Running ungoverned agent tool loop (streaming steps)...\n");

  const stream = await agent.compiled.stream(
    { messages: [new HumanMessage(userPrompt)] },
    { configurable: { thread_id: "toy-thread" }, streamMode: "updates" }
  );

  let step = 0;
  for await (const chunk of stream) {
    step++;
    const firstEntry = Object.entries(chunk)[0];
    if (!firstEntry) continue;
    const [nodeName, rawUpdate] = firstEntry;
    console.log(`--- Step ${step}: Node [${nodeName}] ---`);
    if (isChunkUpdate(rawUpdate) && rawUpdate.messages) {
      for (const message of rawUpdate.messages) {
        const msgType = typeof message._getType === "function" ? message._getType() : "";
        if (msgType === "ai") {
          if (message.tool_calls && message.tool_calls.length > 0) {
            for (const tc of message.tool_calls) {
              console.log(`  Call Tool: ${tc.name}(${JSON.stringify(tc.args)})`);
            }
          } else {
            console.log(`  AI: ${message.content || ""}`);
          }
        } else if (msgType === "tool") {
          const content = typeof message.content === "string" ? message.content : "";
          console.log(`  Tool Result: ${content.slice(0, 150)}...`);
        }
      }
    }
  }

  const snapshot = await agent.compiled.getState({ configurable: { thread_id: "toy-thread" } });
  const logPath = await logConversation(snapshot.values.messages, workspaceDir);

  console.log("\nFinished successfully.");
  console.log(`Log saved to: ${logPath}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
}
