---
name: Incident Response
acronym: IR
satisfies:
  NIST-800-53:
    - IR-1
    - IR-4
    - IR-6
  ISO-27001:
    - A.5.24
    - A.5.26
majorRevisions:
  - date: 2026-11-03
    comment: Initial officer-editable text for CloudBot sign-off.
---

# Incident response

Officers edit this text. A signature records that the named officer accepted this procedure. It does not certify NIST, ISO, or any other catalog.

## When to open an incident

Open an incident when a bot sends data to a provider that was not allowed, when a Full access grant happens without the required signatures, or when workspace files are copied off the machine without an administrator's knowledge.

## Who does what

The CISO owns the incident record. The system owner contains the workspace (stop the affected bot, remove Full access, leave the policy file in place so enforcement stays on). Counsel decides what is said outside the organization.

## After

Write the time, what happened, and what changed in this file's next `majorRevisions` entry. Do not describe that note as a certification.

Signed by: ciso
