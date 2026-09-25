# Allonomic

<p align="center">
  <img src="./logo.jpg" alt="Allonomic Logo" width="600" />
</p>

> **allonomic**: *obeying or being subject to the laws, rules, or control of an external force*

**Allonomic** is an agentic development environment and execution harness built on the principle of dynamic, adaptive intelligence operating under strict, unyielding external policy governance and supervisory constraints.

Repository: [https://github.com/srossross/allonomic](https://github.com/srossross/allonomic)

---

## The Autonomy Matrix

Where does Allonomic fit in the landscape of intelligent and automated systems?

| | Fixed / Programmed Rules | Dynamic / Adaptive Rules |
| :--- | :--- | :--- |
| **Externally Driven** | 🤖 **Automatic**<br>Operates mechanically without human intervention, but follows a strict, pre-set script dictated entirely by an external creator *(e.g., a toaster, a basic thermostat)*. | 🎮 **Allonomic**<br>Reacts and adapts dynamically, but its behavior and operational boundaries remain strictly subject to external laws, remote inputs, or environmental forces. |
| **Internally Driven** | 🔑 **Heteronomous**<br>Capable of complex functions, but relies on an external authority or moral code to establish its operating rules and laws *(often used in philosophy/ethics)*. | 🦅 **Autonomous**<br>Self-governing and independent. It senses its environment, makes its own decisions, and alters its internal rules to achieve its goals *(e.g., an advanced AI agent)*. |

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
- [Node.js](https://nodejs.org/) (v18+) or [Bun](https://bun.sh/)
- [Rust](https://rustup.rs/) (for Tauri desktop app)
- Google Gemini API key (`GEMINI_API_KEY` in `.env`)

### Installation

```bash
# Install dependencies
bun install
# or npm install
```

### Development

```bash
# Run web client + agent development server
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

---

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
