import path from "node:path";
import { AgentRunner } from "../../interceptor-agents/pipeline/runner";
import { GovernorInterceptor } from "../../interceptor-agents/governor/interceptor";

interface CliMessage {
  _getType?: () => string;
  role?: string;
  content?: unknown;
  tool_calls?: Array<{ name: string; args: unknown }>;
}

function printMessage(message: CliMessage) {
  const type = typeof message._getType === "function" ? message._getType() : message.role;
  switch (type) {
    case "human": {
      const content =
        typeof message.content === "string" ? message.content : JSON.stringify(message.content);
      console.log(`[User/Feedback]: ${content.slice(0, 100)}...`);
      break;
    }
    case "ai": {
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const tc of message.tool_calls) {
          console.log(`  [Tool Call]: ${tc.name}(${JSON.stringify(tc.args)})`);
        }
      } else {
        const text =
          typeof message.content === "string"
            ? message.content
            : Array.isArray(message.content)
              ? message.content
                  .map((c: unknown) =>
                    typeof c === "object" && c && "text" in c ? String(c.text) : JSON.stringify(c)
                  )
                  .join("\n")
              : JSON.stringify(message.content);
        console.log(`\n[Agent Response]:\n${text}\n`);
      }
      break;
    }
    case "tool": {
      const content =
        typeof message.content === "string" ? message.content : JSON.stringify(message.content);
      console.log(`  [Tool Result]: ${content.slice(0, 100)}...`);
      break;
    }
  }
}

async function main() {
  const workspaceDir = path.resolve(process.cwd(), "../toy-test-01");
  console.log(`Target workspace: ${workspaceDir}`);

  const governor = new GovernorInterceptor();
  const runner = new AgentRunner({
    workspaceDir,
    interceptors: [governor],
  });

  const defaultPrompt = `page /app \n\n"we pick on sunday"\ncan you add an image to this like a box in the same style?`;
  const userPrompt = process.argv.slice(2).join(" ") || defaultPrompt;

  console.log(`\nUser Prompt:\n${userPrompt}\n`);
  console.log("Running Governed Agent Pipeline (Entry -> Tool Intercept -> Exit Check)...\n");

  const { result, logPath, retries } = await runner.run(userPrompt);

  console.log(`\n=== Governed Run Complete (Retries: ${retries}) ===`);
  console.log(`Log saved to: ${logPath}\n`);

  for (const message of result.messages) {
    printMessage(message);
  }

  console.log("\nGovernor Stack after run:", JSON.stringify(governor.state, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error);
}
