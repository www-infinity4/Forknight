# Evidence-Backed Readiness Traffic Lights

## Purpose

This specification gives humans, bots, and PulseMonitor one conservative language for module readiness. It reports observed readiness; it does not grant authority to deploy, transact, publish, or handle sensitive data.

## States

| Light | Meaning | Required interpretation |
|---|---|---|
| Green | Operational in the declared scope, with current passing test and integration evidence. | All mandatory gates pass; evidence is authentic, retrievable, within its freshness window, and tied to the assessed revision and environment. No open critical blocker or unsafe condition exists. |
| Yellow | Partial, planned, degraded, stale, or missing sufficient evidence. | Includes design-only modules, prototypes, incomplete capabilities, stale evidence, untested integration, unknowns, and non-critical degradation. Yellow must never be described as fully operational. |
| Red | Failing, unsafe, blocked, or explicitly disabled. | Includes failed mandatory tests, security/privacy/license blockers, invalid evidence, revoked dependencies, incompatible integrations, or an operator stop. Red means do not rely on or automatically activate the affected scope. |

`Unknown` is recorded as yellow unless a safety-critical unknown makes operation unsafe, in which case it is red. A planned module cannot be green. `Not-applicable` is not a light and requires a documented rationale.

## Conservative aggregation

1. An applicable red mandatory capability or gate makes overall status red.
2. Otherwise, any applicable yellow mandatory capability or gate makes overall status yellow.
3. Overall green requires every mandatory capability and gate to be green.
4. Optional capabilities do not reduce overall readiness if clearly excluded from the operational scope; their individual status remains visible.
5. A narrower green is allowed only when its exact revision, environment, permissions, providers, and capability scope are displayed. It must not be generalized.

## Capability record

Each module publishes one record for each capability below:

| Field | Requirement |
|---|---|
| `capability` | One of `wallet`, `plugin`, `filter`, `github`, `cloudflare`, `ui`, `mobile`, `provenance`. |
| `applicability` | `required`, `optional`, or `not-applicable` with rationale. |
| `scope` | Exact provider, environment, repository/page/network, operation, and permission boundary. |
| `light` | `red`, `yellow`, or `green`; omitted only for justified `not-applicable`. |
| `reason_codes` | Machine-readable causes such as `passing`, `planned`, `partial`, `stale`, `missing-evidence`, `test-failed`, `unsafe`, `blocked`. |
| `revision` | Source commit or immutable build identifier assessed. |
| `environment` | Environment and deployment identifier assessed. |
| `evidence` | One or more evidence records defined below. |
| `verified_at` / `expires_at` | UTC timestamps establishing freshness. |
| `assessor` | Authenticated identity that collected the result. |
| `reviewer` | Independent human or trusted control that accepted green evidence. |

Capability-specific scope must answer:

- Wallet: network, custody model, signing authority, transaction limits, and tested read/sign/send operations.
- Plugin: plugin identity/version, connection state, granted scopes, and exercised operations.
- Filter: accepted/rejected classes, test corpus version, thresholds, false-positive/false-negative measures, and bypass/fail-closed behavior.
- GitHub: organization/repositories, app or workflow identity, permissions, branch protections, and exercised read/write operations.
- Cloudflare: account environment and Worker/Pages/KV/D1/R2 resources, bindings, routes, and deployment evidence.
- UI: pages/components, browser/accessibility coverage, authentication paths, and representative end-to-end evidence.
- Mobile: platforms, versions, viewports/native builds, network/offline states, and device test coverage.
- Provenance: source lineage, contributor/license manifest, artifact digest/signature, and verification result.

## Evidence contract and anti-self-attestation

A module's own `status: green`, log message, README claim, or self-authored result is not evidence of readiness. Green requires evidence produced or witnessed outside the module's assertion path and accepted by an independent reviewer or trusted policy control.

Every evidence record must include:

| Field | Requirement |
|---|---|
| `kind` | `ci-run`, `test-report`, `deployment`, `integration-probe`, `security-review`, `license-scan`, `provenance-manifest`, `recovery-drill`, or another registered type. |
| `pointer` | Retrievable immutable URL, artifact ID, run ID, or repository path plus revision. Mutable dashboard links alone are insufficient. |
| `digest` | SHA-256 (preferred) or provider-issued immutable digest/ID binding the content. |
| `subject` | Module ID, source revision, build digest, environment, and capability scope tested. |
| `result` | Pass/fail plus objective measurements and thresholds. |
| `producer` | Authenticated test system, integration observer, reviewer, or policy control. |
| `observed_at` | UTC timestamp. |
| `expires_at` | UTC timestamp based on the capability's freshness policy. |

Evidence is invalid if it is missing, inaccessible, mutable without revision binding, digest-mismatched, expired, from the wrong revision/environment/scope, or produced solely from an unverified module claim. Invalid evidence yields yellow, or red when it indicates tampering or makes continued operation unsafe.

Secrets, wallet keys, tokens, and personal data must never appear in evidence. Store redacted results and stable references instead.

## Machine-readable example

```json
{
  "schema_version": "1.0",
  "module_id": "<stable-id>",
  "revision": "<commit-or-build-digest>",
  "overall": "yellow",
  "assessed_at": "<ISO-8601>",
  "capabilities": [
    {
      "capability": "filter",
      "applicability": "required",
      "scope": "<corpus, threshold, and runtime>",
      "light": "yellow",
      "reason_codes": ["missing-evidence"],
      "revision": "<commit-or-build-digest>",
      "environment": "<environment-id>",
      "verified_at": "<ISO-8601>",
      "expires_at": "<ISO-8601>",
      "assessor": "<authenticated-identity>",
      "reviewer": "<independent-reviewer>",
      "evidence": []
    }
  ]
}
```

## PulseMonitor consumption

PulseMonitor consumes the machine-readable readiness record; it does not scrape prose or trust a module's advertised state.

1. Discover the record through a registered manifest entry tied to the module ID.
2. Validate schema version, signatures where required, pointers, digests, timestamps, revision, environment, and scope.
3. Resolve each evidence pointer and compare its digest or immutable provider ID.
4. Recompute every capability light from evidence and policy rather than accepting the submitted light.
5. Aggregate the overall light conservatively using the rules above.
6. Publish the computed light, scope, reason codes, evidence age, and last transition for human and bot navigation.
7. Emit alerts on red transitions, green-to-yellow expiry, digest mismatch, missing records, or disagreement with the submitted status.
8. Preserve an append-only assessment history so changes are auditable.

PulseMonitor may use a green result as a routing/filter input only within its declared scope. It must not treat green as permission to spend funds, sign wallet transactions, install plugins, merge code, deploy, or widen access. Those actions retain their own authorization and human approval gates. On unavailable or unverifiable evidence, PulseMonitor downgrades to yellow; on tampering, unsafe failure, or a mandatory blocker, it sets red and stops automated reliance on that scope.

## Status transitions

- Yellow to green: all mandatory current evidence arrives, binds to the deployed revision/environment, and passes independent review or trusted policy gates.
- Green to yellow: evidence expires, coverage becomes partial, the revision/environment changes without equivalent validation, or a required integration becomes unknown.
- Any to red: mandatory failure, unsafe condition, license/privacy/security blocker, evidence tampering, dependency revocation, or operator stop.
- Red to yellow: blocker is contained but full operational evidence is not yet current.
- Red to green: prohibited as a direct administrative override; remediation and fresh mandatory evidence are required.

Manual overrides may only make a state more conservative. Exceptions must be time-limited, scoped, owned, and recorded, and cannot manufacture green.
