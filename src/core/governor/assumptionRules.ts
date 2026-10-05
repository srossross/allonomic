import type { Assumption } from "./types";

function isOpen(assumption: Assumption): boolean {
  return assumption.status === "open" && assumption.impact_category !== "response_text";
}

export function shouldAskUser(assumption: Assumption): boolean {
  const isUserItem =
    isOpen(assumption) && assumption.resolver === "user" && assumption.depends_on === null;
  const isRisky = assumption.user_would_care === true || assumption.impact_cost === "high";
  return isUserItem && isRisky;
}

export function requiresToolCheck(assumption: Assumption): boolean {
  return isOpen(assumption) && assumption.resolver === "tool";
}
