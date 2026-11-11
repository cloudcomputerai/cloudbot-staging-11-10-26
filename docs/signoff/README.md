# Officer sign-off

A signature records an officer's decision. It does not certify HIPAA, ISO, GDPR, or any other framework. Naming a control in a policy file is a crosswalk label, not a certification.

CloudBot enforces sign-off only when the workspace has a policy file. Until `<data dir>/signoff-policy.json` exists, chats, Full access, and model calls behave exactly as they do today. The data directory is `OMB_DATA_DIR` when that is set, otherwise `~/.openmausbot`.

## Order

1. Start Keycloak as its own process and put officers in groups. No users are seeded.

   ```bash
   docker compose -f deploy/signoff/compose.keycloak.yml up
   ```

   The realm import is `deploy/signoff/keycloak/cloudbot-realm.json`. Groups: `ciso`, `dpo`, `counsel`, `privacy`, `cro`, `system-owner`, `cfo`, `pci-lead`, `ferpa`, `aio-owner`. The admin username and password come from `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD`. They are not written in the repository.

2. Start CISO Assistant as its own process (official backend and frontend images only) and create one asset named `CloudBot on ${HOSTNAME}`.

   ```bash
   docker compose -f deploy/signoff/compose.ciso-assistant.yml up
   ```

   `deploy/signoff/ciso-assistant/asset.json` keeps that name unexpanded. Substitute the host name yourself, then create the asset through the CISO Assistant API. Do not copy CISO Assistant source into this repository.

3. Officers edit the markdown under `deploy/signoff/policies/`. The files use a small YAML frontmatter (`name`, `acronym`, `satisfies`, `majorRevisions`) so a person can see which catalog ids the text is meant to speak to. `satisfies` is a label. [OpenCRE](https://www.opencre.org/) (CC0) is the crosswalk reference for those ids. CloudBot does not import OpenCRE and does not treat a listed control as met.

4. Officers sign in-toto Statement v1 files. The predicate type is `https://cloudbot.dev/signoff/v1`. The predicate carries `role`, `frameworks`, `server`, `allowedProviders`, `expiresAt`, and `signer`. Verify each statement with `cosign verify-blob-attestation` or `in-toto witness verify`. CloudBot does not sign. It only runs the verifier command you set.

5. Put `signoff-policy.json` in the workspace data directory and the statement files in `<data dir>/signoff/attestations/`. Each statement is a `.json` file with a cosign or sigstore bundle beside it (`name.json.bundle`, or `name.bundle`).

6. Until that policy file exists, CloudBot chats exactly as it does today. Creating the file turns enforcement on. Removing the file turns it off again. A missing file is not cached.

7. Evidence is separate and is not a signature. The weekly Trivy workflow (`.github/workflows/trivy-evidence.yml`) and `scripts/signoff/trivy-evidence.sh` upload or write a filesystem scan. They never sign anything. checkov and ComplianceAsCode are optional extra evidence you can run yourself; their output is still not a signature. This repository does not include OSCAL. prowler and cloudquery matter only if a NIST authorizer or a cloud VM is in scope. They are not part of this setup.

8. Read the disclaimer again before anyone treats a signature as an audit result: a signature records a decision. It does not certify HIPAA, ISO, or GDPR.

## Policy file

```json
{
  "requiredRoles": ["ciso", "counsel"],
  "frameworks": ["HIPAA"],
  "server": "this-hostname",
  "allowedProviders": ["anthropic", "openai", "xai"],
  "keycloakUrl": "https://keycloak.example/realms/cloudbot",
  "verification": "required"
}
```

`frameworks` on a policy are labels the signatures must repeat. They are not a certification. `actions` may limit enforcement to `bot_turn`, `full_access`, or `model_call`. Leave it out to enforce all three.

`verification: "trust-local"` marks statements verified without checking a bundle. That is for testing only. Do not use it on a workspace where the signatures are supposed to mean something. With any other setting, a missing `CLOUDBOT_SIGNOFF_VERIFY_CMD` means every statement is unverified and the turn is refused.

`CLOUDBOT_SIGNOFF_VERIFY_CMD` is the verifier. If the command contains `{statement}` or `{bundle}`, those tokens are replaced with the file paths. Otherwise CloudBot appends the statement path and then the bundle path. Exit 0 is verified.

Example:

```bash
export CLOUDBOT_SIGNOFF_VERIFY_CMD='cosign verify-blob-attestation --bundle {bundle} {statement}'
```

## What is refused

When the policy file exists, CloudBot refuses:

- a bot turn, and writes the reason into the chat
- Full access, on the HTTP API and on the desktop approval channel
- an outbound model call whose provider is not allowed

The reason names the role, for example `Sign-off required: role 'ciso' has no valid signature (expired 2026-10-01)`.

Provider names fold together: `claude` and `anthropic`, `codex` and `openai`, `grok` and `xai`.

## OPA

The in-process evaluator and `deploy/signoff/opa/signoff.rego` (`package cloudbot.signoff`) implement the same decision. Tests run without an OPA binary.

If `CLOUDBOT_OPA_URL` is set, async paths (a bot turn, an HTTP Full access change, an outbound chat completion) may also `POST /v1/data/cloudbot/signoff/decision` after the local decision allows. The desktop approval channel and automatic Full access tool approval use the in-process evaluator only. Either a local deny or an OPA deny fails closed. If OPA cannot be reached, the request is refused.

## Settings

Settings → Officer sign-off shows the required roles, whether each signature is valid, missing, or expired, the expiry date, and a link to Keycloak when `keycloakUrl` is an `http` or `https` URL. With no policy file the page says: `No sign-off policy: this workspace runs as usual.`

## Optional separate processes

privacyIDEA can run as its own process if officers want a second factor on the Keycloak login. It is not a service in these compose files. The image is `ghcr.io/privacyidea/privacyidea`. This repository does not vendor privacyIDEA source.

OpenCRE (CC0, https://www.opencre.org/) is only a crosswalk for the `satisfies` map. It is not imported.
