import { describe, it, expect, beforeEach } from "bun:test";
import { buildInterceptorInstructions, buildRejectionContext } from "../src/core/governor/prompts";
import { falseCompletionSection } from "../src/core/governor/falseCompletions";
import type { FalseCompletion, GovernorState, UserIntent } from "../src/core/governor/types";
import { recordingContext } from "./helpers/turnContext";
import {
  firstInputFor,
  forks,
  instructionsOf,
  passes,
  scriptedGovernor,
  stubPromptRuntime,
  texts,
  workerConversation as conversation,
  type MemoryRuntime,
} from "./helpers/governorForks";

const intentA: UserIntent = {
  id: "itnt_a",
  kind: "request",
  description: "Add a box",
  completed_when: null,
  changelog: [],
};

const falseCompletion = (id: string, intent_id: string): FalseCompletion => ({
  id,
  intent_id,
  summary: `summary ${id}`,
  relies_on: "r",
  completes_as: "c",
  false_because: "f",
  detect_by: null,
  evidence: null,
  resolution: null,
  resolution_reason: null,
  still_assumed: null,
  directive: null,
});

const fullState: GovernorState = {
  intent_stack: [intentA],
  completed_intents: [],
  false_completions: [falseCompletion("fcomp_1", "itnt_a")],
};

const addFalseCompletionArgs = {
  intent_id: "itnt_a",
  summary: "new",
  relies_on: "r",
  completes_as: "c",
  false_because: "f",
  directive: "d",
};

describe("governor prompt text", () => {
  it("buildInterceptorInstructions", () => {
    expect(
      buildInterceptorInstructions("  PREAMBLE \n", "TEMPLATE", fullState.intent_stack, [
        falseCompletionSection(fullState),
      ])
    ).toMatchSnapshot();
  });

  it("buildRejectionContext", () => {
    expect(buildRejectionContext(fullState)).toMatchSnapshot();
  });
});

describe("governor passes", () => {
  let runtime: MemoryRuntime;

  beforeEach(async () => {
    runtime = await stubPromptRuntime();
  });

  describe("entry", () => {
    it("runs entry then false-completion listing, skipping merge when nothing was open", async () => {
      const { context, events } = recordingContext();
      const { model, governor } = scriptedGovernor(
        runtime,
        [
          { name: "finish" },
          { name: "no_false_completions", args: { intent_id: "itnt_a", reason: "none" } },
          { name: "finish" },
        ],
        { initialState: { intent_stack: [intentA] } }
      );

      await governor.onUserPrompt(conversation, context);

      expect(passes(events)).toEqual(["entry.md", "false_completion.md"]);
      expect(model.calls()).toBe(3);
      expect(instructionsOf(events, "entry.md")).toMatchSnapshot();
      expect(instructionsOf(events, "false_completion.md")).toMatchSnapshot();
    });

    it("feeds the entry scratchpad into false-completion listing", async () => {
      const { context } = recordingContext();
      const { model, governor } = scriptedGovernor(
        runtime,
        [
          { name: "finish" },
          { name: "no_false_completions", args: { intent_id: "itnt_a", reason: "none" } },
          { name: "finish" },
        ],
        { initialState: { intent_stack: [intentA] } }
      );

      await governor.onUserPrompt(conversation, context);

      const seen = texts(firstInputFor(model.inputs, "FC_LIST"));
      expect(seen.slice(0, 3)).toEqual(texts(conversation));
      expect(seen.findIndex((t) => t.includes("ENTRY"))).toBe(3);
      expect(seen.at(-1)).toContain("FC_LIST");
    });

    it("hides false completions while listing, then merges only the ones open before", async () => {
      const { context, events } = recordingContext();
      const { model, governor } = scriptedGovernor(
        runtime,
        [
          { name: "finish" },
          { name: "read_file", args: { path: "a" } },
          { name: "add_false_completion", args: addFalseCompletionArgs },
          { name: "finish" },
          { name: "read_file", args: { path: "a" } },
          {
            name: "resolve_false_completion",
            args: { id: "fcomp_old", resolution: "superseded", reason: "covered by new" },
          },
          { name: "finish" },
        ],
        {
          initialState: {
            intent_stack: [intentA],
            false_completions: [falseCompletion("fcomp_old", "itnt_a")],
          },
        }
      );

      await governor.onUserPrompt(conversation, context);

      expect(passes(events)).toEqual([
        "entry.md",
        "false_completion.md",
        "false_completion_merge.md",
      ]);

      const listing = instructionsOf(events, "false_completion.md");
      expect(listing).toContain("## False Completions\n[]");
      expect(listing).not.toContain("fcomp_old");

      const merge = instructionsOf(events, "false_completion_merge.md");
      const created = governor.state.false_completions.find((f) => f.summary === "new")!;
      expect(merge).toContain('"id": "fcomp_old"');
      expect(merge).toContain(`"id": "${created.id}"`);
      expect(merge.endsWith("\n## Earlier False Completions\nfcomp_old")).toBe(true);

      const toolReplies = forks(events).flatMap((e) =>
        e.messages.filter((m) => m.role === "tool" && m.name === "read_file").map((m) => m.content)
      );
      expect(toolReplies).toEqual([
        "Error: you do not have the tool read_file. The tools used in the conversation above have been removed and replaced with only false_completion list tools. Your goal is to accurately list the false completions. If you wanted read_file to check something, that unchecked thing is a false completion: record it.",
        "Error: you do not have the tool read_file. The tools used in the conversation above have been removed and replaced with only false_completion list tools. Your goal is to accurately merge the false completion list.",
      ]);

      expect(
        governor.state.false_completions.map((f) => [
          f.id === created.id ? "new" : f.id,
          f.resolution,
        ])
      ).toEqual([
        ["fcomp_old", "superseded"],
        ["new", null],
      ]);
      expect(model.calls()).toBe(7);
    });

    it("merges against a scratchpad without the listing pass", async () => {
      const { context } = recordingContext();
      const { model, governor } = scriptedGovernor(
        runtime,
        [
          { name: "finish" },
          { name: "add_false_completion", args: addFalseCompletionArgs },
          { name: "finish" },
          {
            name: "resolve_false_completion",
            args: { id: "fcomp_old", resolution: "superseded", reason: "covered by new" },
          },
          { name: "finish" },
        ],
        {
          initialState: {
            intent_stack: [intentA],
            false_completions: [falseCompletion("fcomp_old", "itnt_a")],
          },
        }
      );

      await governor.onUserPrompt(conversation, context);

      const seen = texts(firstInputFor(model.inputs, "FC_MERGE"));
      expect(seen.some((t) => t.includes("ENTRY"))).toBe(true);
      expect(seen.some((t) => t.includes("FC_LIST"))).toBe(false);
    });
  });

  describe("exit", () => {
    it("runs false-completion listing before the exit verdict, on the original conversation", async () => {
      const { context, events } = recordingContext();
      const { model, governor } = scriptedGovernor(
        runtime,
        [
          { name: "no_false_completions", args: { intent_id: "itnt_a", reason: "none" } },
          { name: "finish" },
          { name: "finish", args: { approved: true } },
        ],
        { initialState: { intent_stack: [intentA] } }
      );

      const verdict = await governor.onAgentFinish(conversation, context);

      expect(verdict).toEqual({ allowFinish: true, nextStep: undefined });
      expect(passes(events)).toEqual(["false_completion.md", "exit.md"]);
      expect(texts(firstInputFor(model.inputs, "FC_LIST")).slice(0, -1)).toEqual(
        texts(conversation)
      );
      expect(texts(firstInputFor(model.inputs, "EXIT")).slice(0, -1)).toEqual(texts(conversation));
      expect(instructionsOf(events, "exit.md")).toMatchSnapshot();
    });

    it("rejection feedback carries intents", async () => {
      const { context } = recordingContext();
      const { governor } = scriptedGovernor(
        runtime,
        [
          { name: "no_false_completions", args: { intent_id: "itnt_a", reason: "none" } },
          { name: "finish" },
          { name: "finish", args: { approved: false, feedback: "not done" } },
        ],
        { initialState: { intent_stack: [intentA] } }
      );

      const verdict = await governor.onAgentFinish(conversation, context);

      expect(verdict).toEqual({
        allowFinish: false,
        feedback: "not done" + buildRejectionContext(governor.state),
      });
    });
  });
});
