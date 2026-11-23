# Quick start

## Desktop
1. Download from https://sadeem-ai.com/download.
2. Add a key from a supported provider in Settings (or use a local Ollama model, keyless).
3. Open a folder and describe a task. The agent maps the code, edits files, runs tests and shows the diff.

## Terminal (built and tested; install pending publication)
```
sadeem run "add a health endpoint and test it" --workspace ./my-app
sadeem verify proof.json --rerun
```

## Common prompts
- "Find every call site of `createCharge`, fix the double-submit, and run the tests."
- "Explain why we chose Postgres here" — recall pulls real excerpts from old sessions.
- "Before this refactor, save a checkpoint" — `/undo` restores files and chat together.

See https://sadeem-ai.com/docs for the full documentation.
