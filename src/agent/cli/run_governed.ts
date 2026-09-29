import path from "node:path";
import { AgentRunner } from "../../core/graph/runner";
import { GovernorInterceptor } from "../../core/governor/interceptor";
import { ToolTeacherInterceptor } from "../../core/teacher/interceptor";
import { createNodeRuntime } from "../../adapters/node/runtime";
import { formatTraceLine } from "../../core/turn/trace";
import { answerPromptsWith, isYesFlag } from "./autoAnswer";

async function main() {
  const workspaceDir = path.resolve(process.cwd(), "../toy-test-01");
  console.log(`Target workspace: ${workspaceDir}`);

  const runtime = createNodeRuntime();
  const governor = new GovernorInterceptor({ runtime });
  const teacher = new ToolTeacherInterceptor({ runtime });
  const runner = new AgentRunner({
    runtime,
    workspaceDir,
    interceptors: [teacher, governor],
  });

  const cliArguments = process.argv.slice(2);
  const isYes = isYesFlag(cliArguments);
  const answerPrompt = answerPromptsWith(runner, isYes);
  const defaultPrompt = `page /app \n\n"we pick on sunday"\ncan you add an image to this like a box in the same style?`;
  const userPrompt =
    cliArguments.filter((argument) => argument !== "--yes" && argument !== "--no").join(" ") ||
    defaultPrompt;

  console.log(`\nUser Prompt:\n${userPrompt}\n`);
  console.log("Running Governed Agent Pipeline (Entry -> Tool Intercept -> Exit Check)...\n");

  const { finalResponse, logPath } = await runner.run(userPrompt, undefined, {
    onEvent: (event) => {
      console.log(formatTraceLine(event));
      answerPrompt(event);
    },
  });

  console.log(`\n[Agent Response]:\n${finalResponse}\n`);
  console.log(`Log saved to: ${logPath}\n`);
  console.log("\nGovernor Stack after run:", JSON.stringify(governor.state, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
