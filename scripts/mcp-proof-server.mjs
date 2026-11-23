#!/usr/bin/env node
// Minimal but REAL MCP stdio server (JSON-RPC 2.0, Model Context Protocol).
// Exposes two tools so the SADEEM MCP panel + agent can list and CALL them:
//   echo   — echoes a message back
//   now    — returns the current ISO time
// Handshakes with initialize/notifications/initialized per the MCP spec.
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, terminal: false });
const TOOLS = [
  {
    name: 'echo',
    description: 'Echo a message back (SADEEM live-proof tool).',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Text to echo' } },
      required: ['message'],
    },
  },
  {
    name: 'now',
    description: 'Current UTC timestamp (ISO-8601).',
    inputSchema: { type: 'object', properties: {} },
  },
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'sadeem-proof-mcp', version: '1.0.0' },
      },
    });
  } else if (method === 'notifications/initialized' || (method ?? '').startsWith('notifications/')) {
    // no response for notifications
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  } else if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    let text;
    if (name === 'echo') text = `echo: ${String(args.message ?? '')}`;
    else if (name === 'now') text = new Date().toISOString();
    else text = `unknown tool: ${name}`;
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: false } });
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
  }
});
process.on('disconnect', () => process.exit(0));
