import path from "node:path";
import {
  loadWorkspacesConfig,
  loadWorkspaceState,
  saveWorkspaceState,
  listSessions,
  rehydrateSession,
} from "../../persistence";

async function main() {
  console.log("=== Testing Persistence System ===");

  // 1. Global Workspaces Config
  console.log("\n1. Testing loadWorkspacesConfig...");
  const config = await loadWorkspacesConfig();
  console.log("Workspaces Config:", JSON.stringify(config, null, 2));

  // 2. Toy Test 01 Workspace State
  const toyWorkspace = path.resolve(process.cwd(), "../toy-test-01");
  console.log(`\n2. Testing Workspace State for ${toyWorkspace}...`);
  await saveWorkspaceState(toyWorkspace, {
    activeTabId: "g79i6r68",
    openTabIds: ["g79i6r68"],
  });
  const state = await loadWorkspaceState(toyWorkspace);
  console.log("Workspace state loaded:", state);

  // 3. List Sessions in toy-test-01
  console.log(`\n3. Listing sessions in ${toyWorkspace}...`);
  const sessions = await listSessions(toyWorkspace);
  console.log(`Found ${sessions.length} sessions.`);
  if (sessions.length > 0) {
    console.log("First session preview:", sessions[0]);
  }

  // 4. Rehydrate Session 'g79i6r68'
  console.log(`\n4. Rehydrating session 'g79i6r68'...`);
  const rehydrated = await rehydrateSession(toyWorkspace, "g79i6r68");
  console.log("Rehydrated Metadata:", rehydrated.metadata);
  console.log(`Messages reconstructed: ${rehydrated.messages.length}`);
  console.log(`Console events reconstructed: ${rehydrated.consoleEvents.length}`);
  console.log("Reconstructed Governor State:", JSON.stringify(rehydrated.governorState, null, 2));
  console.log(`Next Turn Index: ${rehydrated.nextTurnIndex}`);

  console.log("\n Persistence verification completed successfully!");
}

try {
  await main();
} catch (error) {
  console.error("Verification failed:", error);
  throw error;
}
