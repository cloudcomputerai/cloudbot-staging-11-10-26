---
name: AI Model Use
acronym: AMU
satisfies:
  NIST-AI-RMF:
    - GOVERN-1
    - MAP-1
  ISO-27001:
    - A.5.23
majorRevisions:
  - date: 2026-11-03
    comment: Initial officer-editable text for CloudBot sign-off.
---

# AI model use

Officers edit this text. A signature that names a framework records that the officer decided the text was acceptable. It does not certify HIPAA, ISO, GDPR, or any other framework.

## Which providers a bot may call

The workspace policy file lists the model providers a bot may call. CloudBot refuses a turn and an outbound model call when the called provider is not on that list and a sign-off policy file is present. With no policy file, CloudBot does not apply this rule.

## What officers accept

The AIO owner accepts, in writing, each provider before it is added to `allowedProviders`. The acceptance names the provider, the kind of work that may be sent there, and the date it expires. The signature is the record of that acceptance.

## What this text does not do

It does not rate model quality, and it does not claim a provider's own terms are satisfied.

Signed by: aio-owner
