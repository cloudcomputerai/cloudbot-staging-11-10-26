---
name: Data Retention
acronym: DR
satisfies:
  ISO-27001:
    - A.5.33
    - A.8.10
  GDPR:
    - Art.5(1)(e)
  HIPAA:
    - 164.530(j)
majorRevisions:
  - date: 2026-11-03
    comment: Initial officer-editable text for CloudBot sign-off.
---

# Data retention

Officers edit this text. Mentioning GDPR or HIPAA here is a label on the decision, not a certification.

## How long chat stays

Conversation files, attachments, and sign-off statements live in the workspace data directory (`.openmausbot`, or `OMB_DATA_DIR` when that is set). The privacy officer sets how long each kind of file is kept and writes that period in this section.

## Deletion

When a period ends, an administrator deletes the files from that directory and from any backup that this workspace controls. A signature does not delete anything by itself. CloudBot does not sign retention evidence.

## Attestations

An officer's statement expires on the date inside the statement (`expiresAt`). After that instant CloudBot treats the role as unsigned when a policy file exists. Keeping the expired file is fine; it is a record of a past decision, not a current one.

Signed by: privacy
