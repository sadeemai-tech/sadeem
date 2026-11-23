// ============================================================
// Curated MCP server catalog (renderer-side data).
//
// One entry per genuinely useful server, with the install command,
// transport, credential hints and an official/brand logo shipped in
// src/assets/mcp-logos/. This is a *renderer* catalog: adding an entry
// produces a normal MCPServerConfig and goes through the same
// api.mcpServerSave + updateSettings({ mcpServers }) path as the built-in
// presets, so the main-process registry/health/pool code needs no change.
//
// Commands were verified against the projects' official docs/READMEs
// (Nov 2026). Where a project is community-maintained or archived, the
// publisher field says so instead of implying it is first-party.
// ============================================================
import type { MCPServerConfig, MCPTransport } from '../../shared/types';

import logseqLogo from '../assets/mcp-logos/logseq.svg';
import blenderLogo from '../assets/mcp-logos/blender.svg';
import huggingfaceLogo from '../assets/mcp-logos/huggingface.svg';
import mayaLogo from '../assets/mcp-logos/maya.svg';
import figmaLogo from '../assets/mcp-logos/figma.svg';
import githubLogo from '../assets/mcp-logos/github.svg';
import slackLogo from '../assets/mcp-logos/slack.svg';
import firebaseLogo from '../assets/mcp-logos/firebase.svg';
import vercelLogo from '../assets/mcp-logos/vercel.svg';
import supabaseLogo from '../assets/mcp-logos/supabase.svg';
import playwrightLogo from '../assets/mcp-logos/playwright.svg';
import context7Logo from '../assets/mcp-logos/context7.svg';
import sequentialLogo from '../assets/mcp-logos/sequential-thinking.svg';
import magicLogo from '../assets/mcp-logos/magic-21st.svg';
import puppeteerLogo from '../assets/mcp-logos/puppeteer.svg';
import linearLogo from '../assets/mcp-logos/linear.svg';
import stripeLogo from '../assets/mcp-logos/stripe.svg';
import notionLogo from '../assets/mcp-logos/notion.svg';
import sentryLogo from '../assets/mcp-logos/sentry.svg';

export interface McpCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Who maintains it (informational). */
  publisher: string;
  transport: MCPTransport;
  /** stdio install command. */
  command?: string;
  args?: string[];
  /** stdio working directory hint (supports ${workspace}). */
  cwd?: string;
  /** http/sse endpoint. */
  url?: string;
  /** Pre-filled headers (placeholders are intentionally obvious). */
  headers?: Record<string, string>;
  /** env keys with the default/placeholder value written to settings. */
  env?: Record<string, string>;
  /** Human-readable credential/setup hints shown on the card. */
  envHints?: string[];
  /** Extra prerequisite or caveat shown on the card. */
  note?: string;
  /** No reliable one-command install — open the edit form instead of saving blindly. */
  manual?: boolean;
  docsUrl: string;
  logo: string;
}

export const MCP_CATEGORIES = [
  'All',
  'Development',
  '3D & Design',
  'Productivity',
  'Automation',
  'Data',
  'Knowledge',
  'Documentation',
  'Reasoning',
  'Generative AI',
] as const;

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'logseq',
    name: 'Logseq',
    description:
      'Read, search and edit your Logseq graph — pages, blocks, journal entries and DSL queries — over Logseq’s local HTTP API. Community server; Logseq must be running with its API server enabled.',
    category: 'Knowledge',
    publisher: 'Community · ergut',
    transport: 'stdio',
    command: 'uv',
    args: ['run', '--with', 'mcp-logseq', 'mcp-logseq'],
    env: { LOGSEQ_API_TOKEN: '', LOGSEQ_API_URL: 'http://localhost:12315' },
    envHints: [
      'LOGSEQ_API_TOKEN — create one in Logseq → API panel → Authorization tokens',
      'LOGSEQ_API_URL — defaults to http://localhost:12315',
    ],
    note: 'Enable “HTTP APIs server” in Logseq Settings → Features, then click Start server (🔌).',
    docsUrl: 'https://github.com/ergut/mcp-logseq',
    logo: logseqLogo,
  },
  {
    id: 'blender',
    name: 'Blender',
    description:
      'Prompt-assisted 3D modelling: run Blender Python, inspect the scene, render multi-angle views, generate 3D models (Tripo/Hunyuan3D/Meshy) and import Poly Haven / Sketchfab assets. Connects to a Blender addon over a local socket.',
    category: '3D & Design',
    publisher: 'Community · ahujasid (not the Blender Foundation)',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-for-blender'],
    env: { BLENDER_HOST: 'localhost', BLENDER_PORT: '9876' },
    envHints: ['BLENDER_HOST / BLENDER_PORT — only needed for a non-default Blender socket'],
    note: 'One-shot setup: uvx mcp-for-blender setup (installs the addon). Otherwise run uvx mcp-for-blender install-addon and enable “Interface: MCP for Blender” in Blender Preferences → Add-ons, then click “Connect to Claude” in the MCP for Blender sidebar (N key). Requires uv + Blender 3.0+.',
    docsUrl: 'https://github.com/ahujasid/mcp-for-blender',
    logo: blenderLogo,
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    description:
      'Official Hugging Face MCP server (hosted Streamable HTTP): search Hub models, datasets and Spaces, then call Gradio Spaces as tools — including text-to-image and text-to-video generators you enable for marketing artwork.',
    category: 'Generative AI',
    publisher: 'Official · Hugging Face',
    transport: 'http',
    url: 'https://huggingface.co/mcp',
    headers: { Authorization: 'Bearer <YOUR_HF_TOKEN>' },
    envHints: [
      'HF_TOKEN — read token from huggingface.co/settings/tokens; replace <YOUR_HF_TOKEN> in the Authorization header',
      'OAuth alternative: use https://huggingface.co/mcp?login instead of a token',
    ],
    note: 'After connecting, pick which tools/Spaces are exposed at huggingface.co/settings/mcp (e.g. FLUX text-to-image, text-to-video). Paid Spaces may consume credits.',
    docsUrl: 'https://github.com/huggingface/hf-mcp-server',
    logo: huggingfaceLogo,
  },
  {
    id: 'huggingface-local',
    name: 'Hugging Face (Local CLI)',
    description:
      'The same official Hugging Face MCP server run locally over stdio: Hub search plus Gradio Space tools (text-to-image, text-to-video) without the hosted endpoint. Needs Node.js and an HF token for authenticated tools.',
    category: 'Generative AI',
    publisher: 'Official · Hugging Face',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@llmindset/hf-mcp-server'],
    env: { HF_TOKEN: '' },
    envHints: ['HF_TOKEN — create a read token at huggingface.co/settings/tokens'],
    note: 'The same package also ships @llmindset/hf-mcp-server-http (stateless Streamable HTTP on port 3000). Choose image/video Spaces at huggingface.co/settings/mcp.',
    docsUrl: 'https://github.com/huggingface/hf-mcp-server',
    logo: huggingfaceLogo,
  },
  {
    id: 'maya',
    name: 'Autodesk Maya',
    description:
      'Create and edit Maya scenes through Maya’s commandPort: objects, materials, modelling operations, scene save/open. There is no official Autodesk MCP — this is a community project and needs manual setup.',
    category: '3D & Design',
    publisher: 'Community · PatrickPalmer',
    transport: 'stdio',
    command: 'python',
    args: ['src/maya_mcp_server.py'],
    cwd: '${workspace}/MayaMCP',
    manual: true,
    note: 'Manual setup: clone PatrickPalmer/MayaMCP, create a Python 3.10+ venv, pip install -r requirements.txt, then point command at that venv’s Python and args at src/maya_mcp_server.py. Click “Allow All” in Maya on first connection.',
    docsUrl: 'https://github.com/PatrickPalmer/MayaMCP',
    logo: mayaLogo,
  },
  {
    id: 'figma',
    name: 'Figma',
    description:
      'Give the agent Figma file data (frames, components, layout and styling) for design-to-code. Framelink’s community server is below; Figma also offers a hosted Dev Mode MCP at https://mcp.figma.com/mcp.',
    category: '3D & Design',
    publisher: 'Community · Framelink',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'figma-developer-mcp', '--stdio'],
    env: { FIGMA_API_KEY: '' },
    envHints: ['FIGMA_API_KEY — Figma personal access token (Figma → Settings → Security)'],
    docsUrl: 'https://github.com/GLips/Figma-Context-MCP',
    logo: figmaLogo,
  },
  {
    id: 'github',
    name: 'GitHub',
    description:
      'The official GitHub MCP server: repositories, code search, issues, pull requests, Actions and more. This entry runs the official local Docker image; GitHub also hosts a remote HTTP server at https://api.githubcopilot.com/mcp/ (Bearer PAT).',
    category: 'Development',
    publisher: 'Official · GitHub',
    transport: 'stdio',
    command: 'docker',
    args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    envHints: ['GITHUB_PERSONAL_ACCESS_TOKEN — fine-grained PAT with the scopes you want to grant'],
    note: 'Requires Docker. For the hosted server instead, add an http server with URL https://api.githubcopilot.com/mcp/ and an Authorization: Bearer <token> header.',
    docsUrl: 'https://github.com/github/github-mcp-server',
    logo: githubLogo,
  },
  {
    id: 'slack',
    name: 'Slack',
    description:
      'List channels, read history, post messages, reply in threads and manage reactions. Slack’s reference MCP server is archived but still installable and works with a bot token.',
    category: 'Productivity',
    publisher: 'Reference (archived) · MCP',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '', SLACK_CHANNEL_IDS: '' },
    envHints: [
      'SLACK_BOT_TOKEN — Bot User OAuth Token (xoxb-…)',
      'SLACK_TEAM_ID — workspace ID (starts with T)',
      'SLACK_CHANNEL_IDS — optional comma-separated channel allow-list',
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/slack',
    logo: slackLogo,
  },
  {
    id: 'firebase',
    name: 'Firebase',
    description:
      'Official Firebase MCP server (ships inside firebase-tools) — inspect Firestore and Realtime Database data, Auth users, security rules, Crashlytics, Cloud Functions logs, Remote Config and App Hosting from your Firebase account.',
    category: 'Development',
    publisher: 'Official · Google/Firebase',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'firebase-tools@latest', 'mcp'],
    note: 'Authenticate first with `firebase login` (or call the firebase_login tool) — the server reuses Firebase CLI credentials, not env vars. The old `@firebase/mcp` package does not exist on npm.',
    docsUrl: 'https://firebase.google.com/docs/ai-assistance/mcp-server',
    logo: firebaseLogo,
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description:
      'Official hosted server: search Vercel docs, manage projects and deployments, read deployment logs and query Web Analytics. Sign in with OAuth in your browser on first connect.',
    category: 'Development',
    publisher: 'Official · Vercel',
    transport: 'http',
    url: 'https://mcp.vercel.com',
    note: 'OAuth sign-in opens in a browser. If this client is not pre-approved by Vercel, add an “Authorization: Bearer <VERCEL_TOKEN>” header in the edit form.',
    docsUrl: 'https://vercel.com/docs/agent-resources/vercel-mcp',
    logo: vercelLogo,
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description:
      'Official hosted server: manage tables and SQL, edge functions, logs and project config. Browser OAuth sign-in on first connect — no token to copy.',
    category: 'Data',
    publisher: 'Official · Supabase',
    transport: 'http',
    url: 'https://mcp.supabase.com/mcp',
    note: 'Add ?project_ref=<ref>&read_only=true to the URL for a project-scoped, read-only connection.',
    docsUrl: 'https://supabase.com/docs/guides/getting-started/mcp',
    logo: supabaseLogo,
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description:
      'Browser automation driven by accessibility snapshots — navigate, click, fill forms and screenshot without a vision model. Microsoft’s official MCP server.',
    category: 'Automation',
    publisher: 'Official · Microsoft',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    note: 'First run downloads Chromium. Add args like --headless, --browser firefox or --isolated to customize.',
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
    logo: playwrightLogo,
  },
  {
    id: 'context7',
    name: 'Context7',
    description:
      'Up-to-date, version-specific library documentation and code examples pulled straight from the source into the agent’s context. Official hosted server by Upstash.',
    category: 'Documentation',
    publisher: 'Official · Upstash',
    transport: 'http',
    url: 'https://mcp.context7.com/mcp',
    note: 'Works anonymously at a low rate limit. Add an “Authorization: Bearer <CONTEXT7_API_KEY>” header (free key at context7.com/dashboard) for higher limits.',
    docsUrl: 'https://context7.com/docs/resources/all-clients',
    logo: context7Logo,
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description:
      'Structured step-by-step reasoning with revision and branching, so the model can plan, self-correct and explore alternatives on complex problems. Official MCP reference server.',
    category: 'Reasoning',
    publisher: 'Official · MCP reference',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    note: 'Optional env DISABLE_THOUGHT_LOGGING=true stops per-thought logging to stderr.',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    logo: sequentialLogo,
  },
  {
    id: 'magic-21st',
    name: '21st MCP (Magic)',
    description:
      'Search and generate production UI components from the 21st.dev catalogue. Magic MCP was renamed to 21st MCP; the official endpoint is now a plain HTTP MCP server.',
    category: 'Development',
    publisher: 'Official · 21st.dev',
    transport: 'http',
    url: 'https://21st.dev/api/mcp',
    headers: { 'x-api-key': '<YOUR_21ST_API_KEY>' },
    note: 'Get a free key at 21st.dev/mcp and replace the <YOUR_21ST_API_KEY> header value in the edit form. Old Magic API keys were reset.',
    docsUrl: 'https://21st.dev/mcp',
    logo: magicLogo,
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description:
      'A second browser driver — navigate, fill forms, click and screenshot pages via Puppeteer. Archived reference server, still installable from npm.',
    category: 'Automation',
    publisher: 'Reference (archived) · MCP',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/puppeteer',
    logo: puppeteerLogo,
  },
  {
    id: 'linear',
    name: 'Linear',
    description:
      'Official hosted Linear MCP server: find, create and update issues, projects and comments, and search documents. Browser OAuth sign-in on first connect — no token to copy.',
    category: 'Productivity',
    publisher: 'Official · Linear',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    note: 'OAuth opens in a browser. For read-only access use https://mcp.linear.app/mcp/readonly, or pass a Linear API key as an “Authorization: Bearer <token>” header in the edit form.',
    docsUrl: 'https://linear.app/docs/mcp',
    logo: linearLogo,
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description:
      'Official hosted Stripe MCP server: search the Stripe API and call read/write endpoints, manage customers, invoices, subscriptions and refunds, run analytics and search Stripe docs. OAuth or an agent API key.',
    category: 'Development',
    publisher: 'Official · Stripe',
    transport: 'http',
    url: 'https://mcp.stripe.com',
    headers: { Authorization: 'Bearer <YOUR_STRIPE_AGENT_API_KEY>' },
    envHints: ['Create an Agent API key at dashboard.stripe.com (replace <YOUR_STRIPE_AGENT_API_KEY>), or use browser OAuth instead'],
    note: 'Leave the header empty and complete browser OAuth if your client supports it. Stripe stops accepting non-Agent API keys for MCP after 30 Nov 2026. Write tools require review — enable tool approval.',
    docsUrl: 'https://docs.stripe.com/mcp',
    logo: stripeLogo,
  },
  {
    id: 'notion',
    name: 'Notion',
    description:
      'Official hosted Notion MCP: search your workspace, create and edit pages and databases, manage projects, meeting notes and marketing content, and save memories. Browser OAuth sign-in on first connect.',
    category: 'Knowledge',
    publisher: 'Official · Notion',
    transport: 'http',
    url: 'https://mcp.notion.com/mcp',
    note: 'Browser OAuth on first connect. Business/Enterprise workspaces can instead create an MCP token in the Notion developer portal and send it as an “Authorization: Bearer <token>” header.',
    docsUrl: 'https://developers.notion.com/guides/mcp/get-started-with-mcp',
    logo: notionLogo,
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description:
      'Official hosted Sentry MCP server: search errors, analyze performance, triage and update issues, read Sentry docs and inspect releases/projects. OAuth sign-in on first connect.',
    category: 'Development',
    publisher: 'Official · Sentry',
    transport: 'http',
    url: 'https://mcp.sentry.dev/mcp',
    note: 'Scope the URL to one project, e.g. https://mcp.sentry.dev/mcp/my-org/my-project. For self-hosted Sentry, install the CLI and use `sentry mcp` over stdio instead.',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
    logo: sentryLogo,
  },
];

/** True when the saved config still contains a value the user must replace. */
export function catalogEntryHasPlaceholders(entry: McpCatalogEntry): boolean {
  if (entry.manual) return true;
  if (Object.values(entry.env ?? {}).some((v) => !v.trim())) return true;
  if (Object.values(entry.headers ?? {}).some((v) => !v.trim() || v.includes('<'))) return true;
  return false;
}

/** Build a normal, persistable MCPServerConfig from a catalog entry. */
export function catalogEntryToConfig(entry: McpCatalogEntry, id: string): MCPServerConfig {
  return {
    id,
    name: entry.name,
    command: entry.command ?? '',
    args: entry.args ? [...entry.args] : undefined,
    env: entry.env ? { ...entry.env } : undefined,
    transport: entry.transport,
    url: entry.transport === 'stdio' ? undefined : entry.url,
    headers: entry.headers ? { ...entry.headers } : undefined,
    cwd: entry.transport === 'stdio' ? entry.cwd : undefined,
    catalogId: entry.id,
    enabled: true,
  };
}

/** Find the logo for a configured server (by catalog id, then by name). */
export function catalogLogoFor(cfg: MCPServerConfig | undefined): string | undefined {
  if (!cfg) return undefined;
  const byId = cfg.catalogId ? MCP_CATALOG.find((e) => e.id === cfg.catalogId) : undefined;
  if (byId) return byId.logo;
  return MCP_CATALOG.find((e) => e.name.toLowerCase() === (cfg.name ?? '').trim().toLowerCase())?.logo;
}
