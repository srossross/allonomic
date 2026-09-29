export const INSPECTOR_TABS = [
  "intent",
  "console",
  "tools",
  "injectors",
  "files",
  "settings",
  "profile",
] as const;

export type InspectorTabId = (typeof INSPECTOR_TABS)[number];

const VISIBLE_TAB_COUNT = 3;

const TAB_IDS: ReadonlySet<string> = new Set(INSPECTOR_TABS);

function isInspectorTab(id: string): id is InspectorTabId {
  return TAB_IDS.has(id);
}

export function normalizeTabOrder(saved: readonly string[]): InspectorTabId[] {
  const known = saved.filter((id) => isInspectorTab(id));
  const unique = known.filter((id, index) => known.indexOf(id) === index);
  return [...unique, ...INSPECTOR_TABS.filter((t) => !unique.includes(t))];
}

export function touchTab(order: InspectorTabId[], id: InspectorTabId): InspectorTabId[] {
  return [id, ...order.filter((t) => t !== id)];
}

export function splitTabs(order: InspectorTabId[]): {
  visible: InspectorTabId[];
  overflow: InspectorTabId[];
} {
  return {
    visible: order.slice(0, VISIBLE_TAB_COUNT),
    overflow: order.slice(VISIBLE_TAB_COUNT),
  };
}
