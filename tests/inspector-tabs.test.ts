import { describe, it, expect } from "bun:test";
import {
  INSPECTOR_TABS,
  normalizeTabOrder,
  splitTabs,
  touchTab,
} from "../src/components/inspector/inspectorTabs";

describe("inspector tab order", () => {
  it("defaults to canonical order", () => {
    expect(normalizeTabOrder([])).toEqual([...INSPECTOR_TABS]);
  });

  it("drops unknown and duplicate ids and appends missing ones", () => {
    expect(normalizeTabOrder(["tools", "bogus", "tools", "console"])).toEqual([
      "tools",
      "console",
      "intent",
      "injectors",
      "files",
      "settings",
      "profile",
    ]);
  });

  it("touch moves a tab to most recent", () => {
    expect(touchTab(normalizeTabOrder([]), "settings")[0]).toBe("settings");
  });

  it("shows the 3 most recent, most recent leftmost; rest most-recent-first", () => {
    const order = normalizeTabOrder(["tools", "intent", "console", "settings"]);
    expect(splitTabs(order)).toEqual({
      visible: ["tools", "intent", "console"],
      overflow: ["settings", "injectors", "files", "profile"],
    });
  });

  it("clicking a visible tab moves it leftmost", () => {
    const order = normalizeTabOrder([]);
    expect(splitTabs(touchTab(order, "console")).visible).toEqual(["console", "intent", "tools"]);
  });

  it("picking from overflow evicts the least recently used visible tab", () => {
    const order = normalizeTabOrder(["intent", "injectors", "console"]);
    expect(splitTabs(touchTab(order, "tools")).visible).toEqual(["tools", "intent", "injectors"]);
  });
});
