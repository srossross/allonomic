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
