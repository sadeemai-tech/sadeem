# Security Policy

## Supported versions

The current release is **v11.12.0**. Security fixes target the current release only.

## Reporting a vulnerability

Do not open a public issue for a security problem. Email **sadeem@users.noreply.github.com** with:

- a description of the issue and how to reproduce it,
- the affected version and platform,
- any proof-of-concept you can share.

You will get an acknowledgement within a few days. We will agree on a disclosure timeline before anything is published.

## Scope

- Local credential storage, provider call paths, approval gates and taint escalation.
- Injection and command-execution boundaries in the agent harness.

Out of scope: vulnerabilities in third-party provider services, or issues that require the user to deliberately disable approval gates.

## Honest note

SADEEM uses bring-your-own-key. Provider calls go directly from your machine to the provider you choose. Web tools, MCP servers and image generation use the network; review any MCP server before enabling it. The Windows installer is not code-signed yet, so SmartScreen may show a warning — this is expected during the public season.
