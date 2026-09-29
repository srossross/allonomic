import type { BaseMessage } from "@langchain/core/messages";
import type { PipelineContext } from "../graph/types";
import type { FalseCompletion, GovernorState } from "./types";
import type { GovernorDispatch, IntentBlocks } from "./tools";
import type { PromptSection } from "./prompts";
import type { GovernorForkRunner } from "./forkRunner";
import { createGovernorFalseCompletionTools } from "./falseCompletionTools";

export interface FalseCompletionPassRequest {
  context: PipelineContext;
  conversation: BaseMessage[];
  dispatch: GovernorDispatch;
  getState: () => GovernorState;
  signalRejected: (message: string) => void;
}

export class FalseCompletionPasses {
  constructor(private readonly forks: GovernorForkRunner) {}

  private async listThenMerge(
    { context, conversation, dispatch, getState, signalRejected }: FalseCompletionPassRequest,
    phase: "entry" | "exit"
  ): Promise<void> {
    let isDone = false;
    const markDone = () => {
      isDone = true;
    };
    const decision = () => (isDone ? true : null);

    const priorOpenIds = new Set(
      getState()
        .false_completions.filter((falseCompletion) => falseCompletion.resolution === null)
        .map((falseCompletion) => falseCompletion.id)
    );
    const toolsNamed = (names: string[]) =>
      createGovernorFalseCompletionTools(dispatch, getState, markDone, signalRejected).filter((t) =>
        names.includes(t.name)
      );

    await this.forks.run({
      context,
      conversation,
      promptFile: "false_completion.md",
      tools: toolsNamed(["add_false_completion", "no_false_completions", "finish"]),
      decision,
      unknownTool: (name) =>
        `Error: you do not have the tool ${name}. The tools used in the conversation above have been removed and replaced with only false_completion list tools. Your goal is to accurately list the false completions. If you wanted ${name} to check something, that unchecked thing is a false completion: record it.`,
      phase,
      // Shown existing FCs, models stop listing new ones; the merge pass below reconciles instead.
      hideFalseCompletions: true,
    });

    if (priorOpenIds.size === 0) return;

    isDone = false;
    await this.forks.run({
      context,
      conversation,
      promptFile: "false_completion_merge.md",
      tools: toolsNamed(["resolve_false_completion", "no_false_completions", "finish"]),
      decision,
      unknownTool: (name) =>
        `Error: you do not have the tool ${name}. The tools used in the conversation above have been removed and replaced with only false_completion list tools. Your goal is to accurately merge the false completion list.`,
      phase,
      appendix: `## Earlier False Completions\n${[...priorOpenIds].join(", ")}`,
    });
  }

  enterAfterIntent(request: FalseCompletionPassRequest): Promise<void> {
    return this.listThenMerge(request, "entry");
  }

  exitBeforeIntent(request: FalseCompletionPassRequest): Promise<void> {
    return this.listThenMerge(request, "exit");
  }
}

export function falseCompletionSection(state: GovernorState, isHidden = false): PromptSection {
  return {
    title: "False Completions",
    body: JSON.stringify(isHidden ? [] : state.false_completions, null, 2),
  };
}

function openFalseCompletions(state: GovernorState, intentId?: string) {
  return state.false_completions.filter(
    (falseCompletion) =>
      falseCompletion.resolution === null &&
      (intentId === undefined || falseCompletion.intent_id === intentId) &&
      state.intent_stack.some((intent) => intent.id === falseCompletion.intent_id)
  );
}

function describeOpen(items: FalseCompletion[]): string {
  return items.map((item) => `'${item.id}' ("${item.summary}")`).join(", ");
}

export function falseCompletionBlocks(getState: () => GovernorState): IntentBlocks {
  return {
    resolve: (intentId) => {
      const open = openFalseCompletions(getState(), intentId);
      return open.length > 0
        ? `Intent '${intentId}' has open false completions: ${describeOpen(open)}. It cannot resolve while any remain open.`
        : null;
    },
    approve: () => {
      const open = openFalseCompletions(getState());
      return open.length > 0
        ? `Cannot approve with open false completions: ${describeOpen(open)}. Call finish({ approved: false, feedback }) naming what you must still do.`
        : null;
    },
  };
}
