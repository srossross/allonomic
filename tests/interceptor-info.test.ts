import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { describeInterceptor } from "../src/core/graph/interceptorHooks";
import { GovernorInterceptor } from "../src/core/governor/interceptor";
import { ToolTeacherInterceptor } from "../src/core/teacher/interceptor";

describe("describeInterceptor", () => {
  it("lists the hooks each interceptor implements, with enabled state and model", () => {
    const runtime = createMemoryRuntime();
    const governor = new GovernorInterceptor({ runtime, apiKey: "test", modelName: "m1" });
    const teacher = new ToolTeacherInterceptor({ runtime, apiKey: "test", modelName: "m2" });
    teacher.setIsEnabled(false);

    const [governorInfo, teacherInfo] = [governor, teacher].map((i) => describeInterceptor(i));

    expect(governorInfo).toMatchObject({ name: "Governor", modelName: "m1", isEnabled: true });
    expect(governorInfo.hooks.map((h) => h.hook)).toEqual(["onUserPrompt", "onAgentFinish"]);
    expect(teacherInfo).toMatchObject({ name: "ToolTeacher", modelName: "m2", isEnabled: false });
    expect(teacherInfo.hooks.map((h) => h.hook)).toEqual(["onPreToolCall", "onPostToolCall"]);
  });

  it("falls back for a plain interceptor object", () => {
    const info = describeInterceptor({
      name: "Gate",
      onPreToolCall: async () => ({ approved: true }),
    });
    expect(info).toEqual({
      name: "Gate",
      description: "",
      modelName: undefined,
      isEnabled: true,
      hooks: [{ hook: "onPreToolCall", description: "" }],
    });
  });
});
