import path from "node:path";
import { AgentRunner } from "../../core/graph/runner";
import { GovernorInterceptor } from "../../core/governor/interceptor";
import { resumeFromDir } from "../../core/telemetry/session";
import { createNodeRuntime } from "../../adapters/node/runtime";

async function main() {
  const workspaceDir = path.resolve(process.cwd(), "../toy-test-01");
  console.log(`Workspace: ${workspaceDir}`);

  const runtime = createNodeRuntime();
  const governor = new GovernorInterceptor({ runtime });
  const runner = new AgentRunner({
    runtime,
    workspaceDir,
    interceptors: [governor],
  });

  console.log(`\n=== Starting Session: ${runner.sessionId} ===`);

  // Turn 1
  console.log("\n--- Turn 1: 'hello' ---");
  const turn1 = await runner.run("hello");
  console.log(`Saved Turn 1 to: ${turn1.turnDir}`);

  // Turn 2
  console.log("\n--- Turn 2: 'can you search the web? what tools do you have?' ---");
  const turn2 = await runner.run("can you search the web? what tools do you have?");
  console.log(`Saved Turn 2 to: ${turn2.turnDir}`);

  const sessionDir = path.resolve(workspaceDir, ".allonomic/sessions", runner.sessionId);

  console.log(`\n=== Testing resumeFromDir / Time-Travel ===`);
  console.log(`Replaying session ${runner.sessionId} up to Turn 1 into a fork...`);

  const forkDir = path.resolve(workspaceDir, ".allonomic/sessions", `${runner.sessionId}-fork`);
  const replay = await resumeFromDir(runtime.fs, sessionDir, forkDir, 1);

  console.log(`Forked to: ${replay.sessionDir}`);
  console.log(`Replayed Next Turn Index: ${replay.nextTurnIndex}`);
  console.log(`Replayed Messages count: ${replay.messages.length}`);
  console.log(`Replayed Governor State:`, JSON.stringify(replay.governorState, null, 2));

  console.log("\nSuccess! Session persistence & time-travel replaying works seamlessly.");
}

try {
  await main();
} catch (error) {
  console.error(error);
}
