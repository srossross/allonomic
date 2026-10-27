# Allonomic

<p align="center">
  <img src="./logo.jpg" alt="Allonomic Logo" width="600" />
</p>

> **allonomic**: _obeying or being subject to the laws, rules, or control of an external force_

**Allonomic** is an agentic development environment and execution harness built on the principle of dynamic, adaptive intelligence operating under strict, unyielding external policy governance and supervisory constraints.

---

## The Autonomy Matrix

|           | **Who acts**                                                             | **Who makes the rules**                                                               |
| :-------- | :----------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| **Self**  | 🤖 **Automatic**<br>Acts by itself, no rules to speak of _(a toaster)_.  | 🦅 **Autonomous**<br>Acts by itself, writes its own rules _(an unsupervised agent)_.  |
| **Other** | 🎮 **Allomatic**<br>Moved by another, every step _(a puppet, a script)_. | ⚖️ **Allonomic**<br>Acts by itself, but the rules come from outside _(this project)_. |

---

## Why Supervision Is Cheap

> Asking an AI to _do_ something to spec is a gamble; asking it whether something _was_ done to spec is close to a sure thing. Checking is easier than doing, and past a certain point each extra bit of intelligence costs a lot more. So a cheap governor can keep an expensive worker honest.

### The problem: agents police themselves

Today's agent platforms put the rules in the same context as the worker (system prompts, `CLAUDE.md`, memory) and trust the worker to follow them. In practice it doesn't:

- It misreads the request and acts on a premise it made up.
- It starts coding when it was asked a question.
- It does more than it was asked.
- It forgets corrections. Being told "don't filter output" six times doesn't make it stick.
- It re-asks things that were already decided.

The user ends up as the verifier, catching every mistake by hand.

### Checking is easier than doing

Finding a solution is hard; verifying one is easy (P vs NP). LLMs show the same gap. "Do this" may or may not succeed. "Was this done?" is answered correctly with high probability.

### Rules from outside

Allonomic takes enforcement out of the worker's hands:

| Failure                      | Allonomic                                                                                   |
| :--------------------------- | :------------------------------------------------------------------------------------------ |
| Misreads the request         | The governor writes the intent (goal, done-when, overstep) before the worker runs           |
| Acts on unstated assumptions | Assumptions are surfaced at exit and resolved by the user or a tool                         |
| Acts when asked a question   | The intent is classified as a question or a request                                         |
| Does more than asked         | The overstep boundary is checked at exit                                                    |
| Forgets corrections          | Tool rules are enforced on every call by ToolTeacher, and the call is blocked before it runs |
| Re-asks decided things       | Resolved assumptions persist with the evidence that settled them                            |

The worker never has to remember the rules. They are applied to it from outside.

### Diminishing returns

Capability gets expensive at the top. Along the cost/intelligence Pareto frontier, the last few points of intelligence cost several times more per task ([Artificial Analysis](https://artificialanalysis.ai/), Oct 2026). Because verifying is the easier job, the governor can sit lower on that curve and still be reliable.

---

## Core Architecture

Allonomic bridges the power of dynamic LLM agents with rigorous external control:

- **Interceptor Pipeline**: Intercepts actions at key execution boundaries (`onUserPrompt`, `onToolCall`, `onAgentExit`).
- **Governor Mini-Agent**: Independent supervisory model enforcing policies, global constraints, and intent satisfaction without polluting the worker model's execution context.
- **Intent Stack & Verification**: Formulates verifiable conditions of satisfaction before task execution and mathematically validates outcomes before completion.
- **Tauri + React + Vite Shell**: A lightweight, responsive desktop and web workbench for inspecting agent decisions, context, tool approvals, and real-time governor telemetry.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/)
- [Rust](https://rustup.rs/) (for Tauri desktop app)
- Google Gemini API key (`GEMINI_API_KEY` in `.env`)

### Installation

```bash
# Install dependencies
bun install
```

### Development

```bash
# Run the Vite dev server (web client)
bun run dev

# Run desktop Tauri application
bun run tauri dev
```

### CLI & Testing Scripts

```bash
# Interactive REPL agent
bun run agent

# Check governor status and conversation traces
bun run check:governor

# Run test suites
bun run test:toy
bun run test:governed
```
