---
name: Access Control
acronym: AC
satisfies:
  NIST-800-53:
    - AC-2
    - AC-3
    - AC-6
  ISO-27001:
    - A.5.15
    - A.5.18
  HIPAA:
    - 164.312(a)(1)
majorRevisions:
  - date: 2026-11-03
    comment: Initial officer-editable text for CloudBot sign-off.
---

# Access Control

Officers edit this text. Names under `satisfies` are crosswalk labels for people who already use those catalogs. Listing a control does not mean CloudBot, or a signature, meets it.

## Who may use a bot

A person uses a bot on this workspace only after an administrator has given them an account. Shared workspaces do not treat "the process is on localhost" as permission to change another person's bot.

## What Full access means here

Full access lets a bot act without stopping for each tool prompt. It is still this workspace's own switch. Turning it on requires the officer signatures named in `signoff-policy.json` when that file exists. It is not a finding that the access-control catalog items above are implemented.

## Review

The system owner reviews who holds an admin session and which bots are in Full access at least once a quarter, and after anyone with those rights leaves.

Signed by: system-owner
