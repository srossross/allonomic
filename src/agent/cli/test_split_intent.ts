import path from "node:path";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { GovernorInterceptor } from "../../interceptor-agents/governor/interceptor";

async function main() {
  console.log("=== Integration Test: Partial Intent Resolution (Option B) ===");

  const workspaceDir = path.resolve(process.cwd(), "../toy-test-01");
  const context: {
    workspaceDir: string;
    threadId: string;
    exitToolCalls: Array<{ name: string; args?: Record<string, unknown> }>;
  } = {
    workspaceDir,
    threadId: "test-partial-thread",
    exitToolCalls: [],
  };

  // 1. Initialize Governor with TWO active intents from a compound prompt
  const governor = new GovernorInterceptor({
    initialState: {
      intent_stack: [
        {
          id: "intent_1",
          kind: "question",
          description: "User wants to know if the agent is capable of searching the web.",
          constraints: [],
        },
        {
          id: "intent_2",
          kind: "question",
          description: "User wants to know what tools the agent has available.",
          constraints: [],
        },
      ],
      completed_intents: [],
      global_constraints: [],
    },
  });

  console.log("Initial Active Intent Stack (2 items):");
  console.log(JSON.stringify(governor.state.intent_stack, null, 2));

  // 2. Mock Agent Response: Agent ONLY answers question #2, ignores question #1
  const messages = [
    new HumanMessage("can you search the web? what tools do you have?"),
    new AIMessage(
      "I have the following tools available: read_file, write_file, list_files, and run_command."
    ),
  ];

  console.log("\nSimulated Agent Response (answers ONLY intent_2):");
  console.log(`"${messages[1].content}"`);

  // 3. Run Exit Intercept
  console.log("\nRunning onAgentFinish...");
  const verdict = await governor.onAgentFinish(messages, context);

  console.log("\n=== Exit Verifier Verdict ===");
  console.log("Verdict:", JSON.stringify(verdict, null, 2));

  console.log("\nExit Interceptor Tool Calls Recorded:");
  console.log(JSON.stringify(context.exitToolCalls, null, 2));

  console.log("\n=== Final Governor State ===");
  console.log("- Active Intent Stack (remaining):");
  console.log(JSON.stringify(governor.state.intent_stack, null, 2));
  console.log("- Completed Intents (history):");
  console.log(JSON.stringify(governor.state.completed_intents, null, 2));

  // 4. Assertions
  const intent1StillActive = governor.state.intent_stack.some((index) => index.id === "intent_1");
  const intent2Completed = governor.state.completed_intents.some(
    (index) => index.id === "intent_2"
  );

  if (intent1StillActive && intent2Completed && verdict.allowFinish) {
    console.log("\nSUCCESS: Option B verified!");
    console.log("- intent_2 was resolved and moved to history.");
    console.log("- intent_1 remains active on the stack for the next step.");
    console.log(`- nextStep provided: "${verdict.nextStep}"`);
  } else {
    console.error("\nFAILURE: State did not match Option B expectations.");
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
}
