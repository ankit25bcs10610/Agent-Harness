# JIG

JIG is a terminal-based AI coding harness built with TypeScript, React, and Ink. It provides an interactive coding session with model-driven reasoning, project tools, context management, permissions, Markdown output, and resumable local sessions.

## Features

- Interactive terminal UI powered by Ink and React
- OpenRouter-backed model communication
- Configurable reasoning and compaction models
- Project tools for reading, writing, replacing, and inspecting files
- Shell access with permission checks
- Context pruning and compaction for long coding sessions
- Markdown rendering for model responses
- Session persistence under `.jig/sessions/`
- Resume the most recent session with `--continue`

## Requirements

- [Bun](https://bun.sh/) 1.x
- An [OpenRouter](https://openrouter.ai/) API key

## Getting started

Clone the repository and install dependencies:

```bash
git clone https://github.com/ankit25bcs10610/abcd.git
cd abcd
bun install
```

Set your OpenRouter API key in the shell:

```bash
export OPENROUTER_API_KEY="your-api-key"
```

Start JIG:

```bash
bun run dev
```

To continue the most recently saved session:

```bash
bun run dev -- --continue
```

## Configuration

Runtime defaults are defined in [`src/config.ts`](src/config.ts), including the main model (`anthropic/claude-haiku-5.5`), compaction model (`openrouter/free`), a 20-iteration limit, a 128,000-token context window, and a 200,000-token budget.

## Project structure

```text
src/
├── context/      Context generation, pruning, and compaction
├── loop/         Agent loop and tool dispatch
├── permission/   Permission matching and checks
├── provider/     OpenRouter client and response normalization
├── session/      Session creation, loading, and persistence
├── tool/         Tool registry and project tools
├── ui/           Ink components and terminal presentation
└── util/         Shared utilities
```

See [`docs/PROVIDER.md`](docs/PROVIDER.md) and [`docs/TOOL.md`](docs/TOOL.md) for implementation notes.

## Available commands

```bash
bun run dev          # Start the interactive harness
bun run watch        # Start with Bun watch mode
bun run typecheck    # Check TypeScript types
bun run format       # Format the project
bun run format:check # Verify formatting
```

## Data and security

JIG stores project-local session data in `.jig/`. Session files are ignored by Git by default. Keep `OPENROUTER_API_KEY` private and do not commit it to the repository. Review permission prompts carefully before allowing shell commands or file modifications.

## License

This project is distributed under the MIT License. See [`LICENSE`](LICENSE) for the full text.

## Author

**Ankit Pandey**

`ankit.25bcs10610@sst.scaler.com`
