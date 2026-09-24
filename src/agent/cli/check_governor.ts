import * as fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { verifyConversation } from "../../interceptor-agents/governor/verifier";

async function main() {
  const arguments_ = process.argv.slice(2);
  const convPath =
    arguments_[0] || path.resolve(process.cwd(), "../toy-test-01/.atomic/conversation-32691.yml");
  const intentPath = arguments_[1] || path.resolve(process.cwd(), "../toy-test-01/intent.yml");

  console.log(`Checking Governor for:`);
  console.log(`- Conversation: ${convPath}`);
  console.log(`- Intent State: ${intentPath}\n`);

  const convContent = await fs.readFile(convPath, "utf8");
  const intentContent = await fs.readFile(intentPath, "utf8");

  const conversation = YAML.parse(convContent);
  const intent = YAML.parse(intentContent);

  const verdict = await verifyConversation(conversation, intent);

  console.log("=== GOVERNOR VERDICT ===");
  console.log(YAML.stringify(verdict));
}

try {
  await main();
} catch (error) {
  console.error(error);
}
