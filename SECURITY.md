# Security Policy

## Supported versions

The current release is **v11.12.0**. Security fixes target the current release only.

## Reporting a vulnerability

Do not open a public issue for a security problem. Use the contact form at https://sadeem-ai.com or email the maintainer through the site. Include a description, reproduction steps, the affected version and any proof-of-concept. You will get an acknowledgement within a few days; we agree on disclosure before anything is published.

## Scope

- Local credential storage, direct provider calls, approval gates and taint escalation.
- The loopback control API, Remote pairing and MCP boundaries.

Out of scope: third-party provider services, or issues that require deliberately disabling approval gates.

## Honest notes

- SADEEM uses bring-your-own-key. Calls go directly from your machine to the provider you choose. Web tools, MCP servers, image generation and Remote use the network; review any MCP server before enabling it.
- SADEEM Remote is same-network only (no cloud, no tunnel), requires Windows Firewall to allow inbound, and uses a short-lived pairing code.
- The Windows installer is not code-signed yet, so SmartScreen may show a warning — expected during the public season.
