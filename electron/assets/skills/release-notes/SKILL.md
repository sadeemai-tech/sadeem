---
name: Release notes
description: Write user-facing release notes from the actual diff, not from memory.
---
# Release notes

Generate notes from the real change set (git log/diff or task journal) — never
invent features.

Structure per version:
- Headline: one sentence on the biggest user-visible improvement.
- Added / Changed / Fixed — short bullets, user benefit first ("Faster search",
  not "Refactored query service").
- Breaking changes get their own section with the migration step.

Style: present tense, active voice, no internal jargon (component/class names),
no ticket IDs in headlines. Mention contributors where relevant. End with the
upgrade command or download link.
