import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { AgentRunner } from "../src/core/graph/runner";
import { messageText } from "../src/core/graph/thinking";
import { rehydrateSession, replaySession, rewindSession } from "../src/core/session/rehydration";
import { forkSession } from "../src/core/session/fork";
import { loadSessionMetadata } from "../src/core/session/metadata";
import {
  activePath,
  buildTurnTree,
  childrenOf,
  parentOf,
  tipOf,
  type TurnHead,
} from "../src/core/turn/branches";
import type { TurnEvent } from "../src/core/turn/events";
import { FakeChatModel } from "./helpers/fakeChatModel";

const SESSION_DIR = "/w/.allonomic/sessions/s1";

function started(turnIndex: number): TurnEvent {
  return {
    type: "turn_started",
    threadId: "s1",
    prompt: `p${turnIndex}`,
    seq: 0,
    at: "",
    turnIndex,
    actor: "user",
  };
}

function rewound(turnIndex: number, head: TurnHead): TurnEvent {
  return { type: "rewound", head, seq: 0, at: "", turnIndex, actor: "user" };
}

function setup() {
  const runtime = createMemoryRuntime();
  const model = new FakeChatModel(["a1", "a2", "a3", "a4", "a5"]);
  const runner = new AgentRunner({
    runtime,
    workspaceDir: "/w",
    sessionId: "s1",
    executionMode: "restricted",
    createModel: () => model,
  });
  const rewind = (head: TurnHead) =>
    runner.resetThread(() => rewindSession(runtime.fs, SESSION_DIR, head));
  const prompts = async () => {
    const { messages } = await rehydrateSession(runtime.fs, "/w", "s1");
    return messages.filter((m) => m.role === "user").map((m) => m.content);
  };
  return { runtime, model, runner, rewind, prompts };
}

describe("turn tree", () => {
  it("follows the head through rewinds", () => {
    const tree = buildTurnTree([started(1), started(2), rewound(3, 1), started(4), started(5)]);
    expect(activePath(tree)).toEqual([1, 4, 5]);
    expect(childrenOf(tree, 1)).toEqual([2, 4]);
    expect(parentOf(tree, 4)).toBe(1);
    expect(tipOf(tree, 4)).toBe(5);
    expect(tipOf(tree, 2)).toBe(2);
  });

  it("undoes a rewind by moving the head back to the abandoned tip", () => {
    const tree = buildTurnTree([started(1), started(2), rewound(3, null), rewound(4, 2)]);
    expect(activePath(tree)).toEqual([1, 2]);
    expect(childrenOf(tree, null)).toEqual([1]);
  });
});

describe("rewind", () => {
  it("drops abandoned turns from the model history and the transcript", async () => {
    const { model, runner, rewind, prompts } = setup();
    await runner.run("one", "s1");
    await runner.run("two", "s1");
    await rewind(1);
    expect(await prompts()).toEqual(["one"]);

    await runner.run("three", "s1");

    const seen =
      model.calls
        .at(-1)
        ?.map((m) => messageText(m.content))
        .join("\n") ?? "";
    expect(seen).toContain("one");
    expect(seen).toContain("three");
    expect(seen).not.toContain("two");
    expect(await prompts()).toEqual(["one", "three"]);
  });

  it("restores an abandoned branch without deleting the newer one", async () => {
    const { runtime, runner, rewind, prompts } = setup();
    await runner.run("one", "s1");
    await runner.run("two", "s1");
    await rewind(1);
    await runner.run("three", "s1");

    const { turnTree } = await rehydrateSession(runtime.fs, "/w", "s1");
    expect(childrenOf(turnTree, 1)).toEqual([2, 4]);
    await rewind(tipOf(turnTree, 2));
    expect(await prompts()).toEqual(["one", "two"]);
    await rewind(tipOf(turnTree, 4));
    expect(await prompts()).toEqual(["one", "three"]);
  });

  it("does not close a trailing rewind as an unfinished turn", async () => {
    const { runtime, runner, rewind } = setup();
    await runner.run("one", "s1");
    await rewind(null);
    const replay = await replaySession(runtime.fs, SESSION_DIR);
    expect(replay.events.map((e) => e.type)).not.toContain("turn_failed");
    expect(replay.activeEvents).toEqual([]);
  });
});

describe("fork", () => {
  it("copies the active path up to the head into a flat session", async () => {
    const { runtime, runner, rewind } = setup();
    await runner.run("one", "s1");
    await runner.run("two", "s1");
    await rewind(1);
    await runner.run("three", "s1");
    await runner.run("four", "s1");

    await forkSession(runtime, "/w", "s1", "s2", 4);

    const fork = await rehydrateSession(runtime.fs, "/w", "s2");
    expect(fork.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
      "one",
      "three",
    ]);
    expect(activePath(fork.turnTree)).toEqual([1, 2]);
    expect(fork.nextTurnIndex).toBe(3);
    const metadata = await loadSessionMetadata(runtime.fs, "/w", "s2");
    expect(metadata?.title).toStartWith("(fork) ");
  });
});
