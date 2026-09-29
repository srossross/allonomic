import type { AskUser, PipelineContext } from "../../src/core/graph/types";
import { createTurnEventLog } from "../../src/core/turn/eventLog";
import type { TurnEvent } from "../../src/core/turn/events";
import type { GovernorState } from "../../src/core/governor/types";
import { applyGovernorAction, EMPTY_GOVERNOR_STATE } from "../../src/core/governor/reducer";
import type { GovernorDispatch } from "../../src/core/governor/tools";

const noUser: AskUser = async (prompt) => {
  throw new Error(`Unexpected prompt: ${prompt.label}`);
};

export function recordingContext(
  threadId = "t1",
  turnIndex = 1,
  askUser: AskUser = noUser
): { context: PipelineContext; events: TurnEvent[] } {
  const { sink, events } = createTurnEventLog(turnIndex, []);
  return {
    context: {
      workspaceDir: "/workspace",
      threadId,
      sessionId: "test-session",
      turnIndex,
      events: sink,
      askUser,
    },
    events,
  };
}

export function localGovernor(initial: GovernorState = EMPTY_GOVERNOR_STATE): {
  dispatch: GovernorDispatch;
  state: () => GovernorState;
} {
  let state = initial;
  return {
    dispatch: (action) => {
      const outcome = applyGovernorAction(state, action);
      state = outcome.state;
      return outcome.result;
    },
    state: () => state,
  };
}
