<p align="center">
  <img src="website/public/sadeem-app-logo.png" width="72" alt="SADEEM logo" />
</p>

# SADEEM

**Local-first AI coding agent · 145 tools · Arabic-first, fully bilingual**

SADEEM is a Windows desktop coding agent that keeps your code, credentials and learning files on your machine. The same agent runs in the terminal through `sadeem run`. Free during the public season — bring your own provider key.

**Arabic:** سديم وكيل برمجة محليّ الاتجاه بـ145 أداة، ومحرّك واحد في التطبيق والترمينال. المفاتيح وملفات التعلّم تبقى على جهازك، والاتصال يذهب مباشرة إلى مزوّدك بلا وسيط.

🌐 **Website / الموقع:** https://sadeem-ai.com
📥 **Download / التنزيل:** https://sadeem-ai.com/download
📖 **Docs / التوثيق:** https://sadeem-ai.com/docs

---

## What it does / ماذا يفعل

- **145 schema'd tools** with approval gates. Profiles change what the model sees for one turn — never what it may call.
- **One engine in the app and the CLI** — `sadeem run "<task>"` calls the same `runAgent()` used by the desktop app, no Electron binary required.
- **Persistent, editable memory** — a versioned `PLAYBOOK.md` written after real runs and a bounded-but-lossless user DNA model. Both are plain files you can read and delete.
- **Shadow-commit checkpoints** — a git snapshot before edits that leaves your index and stash untouched; `/undo` restores files and the conversation.
- **Proven-change pipeline** — an independent model family re-checks completion claims against files, commands and tests; real changes produce a signed proof package anyone can verify with no key.
- **Local-first BYOK** — 12 providers (OpenAI, Anthropic, Google, Ollama, OpenRouter and others). Keys stay in local settings; provider calls go direct.
- **MCP, 16 parallel specialists, mid-run steering, verified preview, RTL document builders, scheduled proof-gated jobs.**
- **Full Arabic RTL interface** with Cairo typography — prompt and read in Arabic or English. Code comments, commits and playbooks in either language.

> Details with source evidence: [`docs/CAPABILITY-HARVEST-V1145.md`](docs/CAPABILITY-HARVEST-V1145.md) and [`docs/FEATURE-TRUTH-V1144.md`](docs/FEATURE-TRUTH-V1144.md).

## Quick start / البداية السريعة

**Desktop:** download the Windows installer from https://sadeem-ai.com/download, add a provider key in Settings, and open a folder.

**CLI:**
```powershell
npm i -g sadeem-cli
sadeem config set-key <provider> <your-key>
sadeem run "fix the failing checkout test"
sadeem verify proof.json --rerun
```

## Repository layout / بناء المستودع

| Path | What it is |
|---|---|
| `electron/` | Desktop app, agent engine, 145 tools, services |
| `src/` | Shared renderer, store, UI components |
| `shared/` | Code shared between app and CLI |
| `website/` | Next.js marketing site (https://sadeem-ai.com) |
| `docs/` | Capability truth, design and SEO research |
| `tests/` | Test suite (`.mjs`) |
| `scripts/` | Release / publish helpers |

## Build from source / البناء من المصدر

```powershell
npm install
npm run build
```

See [`docs/`](docs/) for architecture and release notes.

## License / الترخيص

MIT — see [LICENSE](LICENSE).

## Honest notes / ملاحظات صادقة

- Windows desktop app. CLI runs wherever Node runs.
- BYOK: you supply the API key and your provider bills you. Ollama works keyless.
- Free during the public season; no subscription, no credits, no checkout.
- Web tools, MCP and image generation use the network. "Local-first" describes where code and keys live, not that every feature is offline.
