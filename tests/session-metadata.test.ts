import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { loadSessionMetadata, saveSessionMetadata } from "../src/core/session/metadata";

const PATH = "/w/.allonomic/sessions/s1/metadata.yml";

describe("session metadata", () => {
  it("round-trips the title", async () => {
    const { fs } = createMemoryRuntime();
    await saveSessionMetadata(fs, "/w", {
      sessionId: "s1",
      title: "t",
      closed: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const loaded = await loadSessionMetadata(fs, "/w", "s1");
    expect(loaded?.title).toBe("t");
  });

  it("keeps keys it does not own when rewriting", async () => {
    const { fs } = createMemoryRuntime();
    fs.files.set(PATH, "session_id: s1\ntitle: old\nnetwork_access: false\n");
    await saveSessionMetadata(fs, "/w", {
      sessionId: "s1",
      title: "new",
      closed: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(fs.files.get(PATH)).toContain("network_access: false");
    expect(fs.files.get(PATH)).toContain("title: new");
  });
});
