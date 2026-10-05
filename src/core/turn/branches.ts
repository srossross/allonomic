import type { TurnEvent } from "./events";

export type TurnHead = number | null;

export interface TurnTree {
  head: TurnHead;
  parent: Record<number, TurnHead>;
}

export const EMPTY_TURN_TREE: TurnTree = { head: null, parent: {} };

export function applyTurnTreeEvent(tree: TurnTree, event: TurnEvent): TurnTree {
  if (event.type === "rewound") return { ...tree, head: event.head };
  if (event.type !== "turn_started" || tree.parent[event.turnIndex] !== undefined) return tree;
  return {
    head: event.turnIndex,
    parent: { ...tree.parent, [event.turnIndex]: tree.head },
  };
}

export function buildTurnTree(events: TurnEvent[]): TurnTree {
  let tree = EMPTY_TURN_TREE;
  for (const event of events) tree = applyTurnTreeEvent(tree, event);
  return tree;
}

export function activePath(tree: TurnTree, head: TurnHead = tree.head): number[] {
  const path: number[] = [];
  for (let turn = head; turn !== null; turn = tree.parent[turn] ?? null) path.push(turn);
  return path.toReversed();
}

export function activeEvents(events: TurnEvent[], tree = buildTurnTree(events)): TurnEvent[] {
  const onPath = new Set(activePath(tree));
  return events.filter((e) => onPath.has(e.turnIndex));
}

export function childrenOf(tree: TurnTree, parent: TurnHead): number[] {
  return Object.entries(tree.parent)
    .filter(([, p]) => p === parent)
    .map(([turn]) => Number(turn))
    .toSorted((a, b) => a - b);
}

export function parentOf(tree: TurnTree, turn: number): TurnHead {
  return tree.parent[turn] ?? null;
}

export function tipOf(tree: TurnTree, turn: number): number {
  return Math.max(turn, ...childrenOf(tree, turn).map((child) => tipOf(tree, child)));
}
