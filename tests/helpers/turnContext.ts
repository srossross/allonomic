import type { PipelineContext } from "../../src/core/graph/types";
import { createTurnEventLog } from "../../src/core/turn/eventLog";
import type { TurnEvent } from "../../src/core/turn/events";
import type { GovernorState } from "../../src/core/governor/types";
import { applyGovernorAction, EMPTY_GOVERNOR_STATE } from "../../src/core/governor/reducer";
import type { GovernorDispatch } from "../../src/core/governor/tools";

export function recordingContext(
  threadId = "t1",
  turnIndex = 1
): { context: PipelineContext; events: TurnEvent[] } {
  const { sink, events } = createTurnEventLog(turnIndex, []);
  return {
    context: {
      workspaceDir: "/workspace",
      threadId,
      sessionId: "test-session",
      turnIndex,
      events: sink,
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
