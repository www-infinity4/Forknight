# Planned Module README Template

> Planning artifact only. Completing this README does not mean the module exists, is safe, or is operational. Replace every placeholder; use `unknown` rather than guessing.

## Identity and status

| Field | Value |
|---|---|
| Module name | `<name>` |
| Planning ID | `<stable-id>` |
| Version / revision | `<version-or-plan-revision>` |
| Lifecycle | `proposed \| scoped \| building \| validating \| operational \| deprecated \| blocked` |
| Overall traffic light | `red \| yellow \| green` |
| Status reason | `<brief, evidence-based explanation>` |
| Last assessed (UTC) | `<ISO-8601>` |
| Assessment expires (UTC) | `<ISO-8601>` |
| Owners | `<human accountable owner(s)>` |

Green is forbidden for a planned-only module. Status must follow [readiness-traffic-lights.md](./readiness-traffic-lights.md), including its evidence and expiry rules.

## Purpose

- Problem: `<problem this module addresses>`
- Intended outcome: `<measurable result>`
- Primary users or callers: `<people, bots, services>`
- Success measures: `<observable metrics and thresholds>`

## Fit in the Infinity system

- Parent domain / layer: `<where it belongs>`
- Upstream producers: `<systems that feed it>`
- Downstream consumers: `<systems it feeds>`
- Existing modules it complements or replaces: `<names and distinction>`
- Boundary of responsibility: `<what belongs here versus elsewhere>`

## Target surfaces

| Surface | Intended location | Required change | Authority needed |
|---|---|---|---|
| Repository | `<repo or none>` | `<paths/packages>` | `<owner/reviewer>` |
| Page / route | `<URL or route or none>` | `<UI purpose>` | `<owner/reviewer>` |
| Runtime | `<service/worker/job or none>` | `<deployment unit>` | `<owner/reviewer>` |
| Data store | `<store or none>` | `<schema/retention impact>` | `<owner/reviewer>` |

Do not create repositories, pages, deployments, accounts, or credentials from this planning document.

## Triggers

| Trigger | Source | Preconditions | Idempotency / deduplication | Failure behavior |
|---|---|---|---|---|
| `<event, schedule, request, or human action>` | `<producer>` | `<required state>` | `<key and window>` | `<retry, quarantine, stop>` |

## Inputs and outputs

### Inputs

| Input | Schema / type | Source | Validation | Sensitivity |
|---|---|---|---|---|
| `<name>` | `<schema pointer>` | `<source>` | `<constraints>` | `public \| internal \| personal \| secret` |

### Outputs

| Output | Schema / type | Destination | Guarantees | Retention |
|---|---|---|---|---|
| `<name>` | `<schema pointer>` | `<consumer>` | `<ordering, integrity, delivery>` | `<duration/policy>` |

## Dependencies

| Dependency | Type | Required capability | Version / contract | Fallback | Evidence |
|---|---|---|---|---|---|
| `<name>` | `module \| service \| plugin \| library \| wallet \| human` | `<why needed>` | `<pin or interface>` | `<degraded behavior>` | `<pointer + digest>` |

Document optional dependencies separately. A configured dependency is not proof that the integration works.

## Capability matrix

Every row must have a traffic light, explicit scope, and independently retrievable evidence. Use `not-applicable` only with a reason.

| Capability | Scope / provider | State | Evidence pointer | Evidence digest | Verified at / expires | Notes |
|---|---|---|---|---|---|---|
| Wallet | `<network/custody/signing scope>` | `<red/yellow/green/N-A>` | `<CI run, test report, receipt>` | `<sha256 or immutable ID>` | `<UTC / UTC>` | `<permissions; never secrets>` |
| Plugin | `<plugin and granted scopes>` | `<...>` | `<...>` | `<...>` | `<...>` | `<connection and permission limits>` |
| Filter | `<data accepted/rejected>` | `<...>` | `<...>` | `<...>` | `<...>` | `<accuracy and bypass behavior>` |
| GitHub | `<repos/actions/permissions>` | `<...>` | `<...>` | `<...>` | `<...>` | `<read/write boundary>` |
| Cloudflare | `<Worker/Pages/KV/D1/R2 scope>` | `<...>` | `<...>` | `<...>` | `<...>` | `<environment and deployment>` |
| UI | `<pages/components/accessibility>` | `<...>` | `<...>` | `<...>` | `<...>` | `<supported browsers>` |
| Mobile | `<platforms/form factors>` | `<...>` | `<...>` | `<...>` | `<...>` | `<native/responsive/offline>` |
| Provenance | `<lineage/signing/license metadata>` | `<...>` | `<...>` | `<...>` | `<...>` | `<chain of custody>` |

## Security, licensing, and privacy

- Threat boundary and abuse cases: `<assets, actors, likely misuse>`
- Authentication and authorization: `<identity, scopes, least privilege>`
- Secret handling: `<storage, rotation, logging prohibition>`
- Data classification and minimization: `<fields collected and why>`
- Privacy: `<consent, retention, deletion, residency, user rights>`
- Licenses: `<code, models, datasets, media, plugin terms>`
- Provenance obligations: `<source attribution, manifests, signatures>`
- Required security/privacy/legal reviews: `<reviewer and gate>`

Never place wallet keys, tokens, personal data, or other secrets in this README or its evidence.

## Evidence and tests required

| Requirement | Test level | Pass criterion | Environment | Evidence pointer + digest | Freshness limit | Gate owner |
|---|---|---|---|---|---|---|
| `<behavior or control>` | `unit \| contract \| integration \| end-to-end \| security \| recovery` | `<objective threshold>` | `<representative environment>` | `<immutable location + sha256/ID>` | `<duration>` | `<human/team>` |

Minimum operational evidence should cover the declared core path, dependency integration, permission boundaries, failure behavior, and rollback/recovery. Record known failures and skipped tests; absence of a failure report is not proof of success.

## Build phases

| Phase | Deliverable | Entry gate | Exit evidence | Approval |
|---|---|---|---|---|
| 0. Discovery | `<validated problem and boundary>` | `<inputs>` | `<research/decision record>` | `<owner>` |
| 1. Contract | `<schemas/interfaces/threat model>` | `<approved scope>` | `<contract review>` | `<owner>` |
| 2. Prototype | `<non-production proof>` | `<contract>` | `<prototype tests>` | `<owner>` |
| 3. Integration | `<connected implementation>` | `<prototype evidence>` | `<integration tests>` | `<owner>` |
| 4. Validation | `<release candidate>` | `<integration evidence>` | `<E2E/security/recovery evidence>` | `<owner>` |
| 5. Release | `<controlled rollout>` | `<all gates>` | `<deployment and observation evidence>` | `<human approver>` |
| 6. Operate | `<monitoring and maintenance>` | `<release evidence>` | `<SLO, incident, reassessment records>` | `<operator>` |

## Explicit non-capabilities

- Does not: `<unsupported action>`
- Will not automatically: `<decision/action requiring human authority>`
- Unsupported environments or users: `<limits>`
- Accuracy, availability, or scale limits: `<limits>`
- Unsafe or prohibited uses: `<uses>`

## Ownership and AI jobs

| Job | Human accountable owner | AI/bot role | Allowed actions | Required approval | Escalation / stop condition |
|---|---|---|---|---|---|
| `<job>` | `<person/team>` | `<bot/module>` | `<bounded actions>` | `<approval gate>` | `<when to stop and notify>` |

AI/bot jobs must use least privilege, produce auditable artifacts, and must not approve their own readiness, security review, deployment, or rollback.

## Integration and rollback

- Integration sequence: `<ordered, reversible steps>`
- Contract compatibility: `<versions and migration policy>`
- Feature flag / isolation boundary: `<control>`
- Health checks and observation window: `<signals and duration>`
- Rollback trigger: `<objective conditions>`
- Rollback procedure: `<owner, steps, data handling>`
- Recovery verification: `<tests and evidence>`
- Irreversible effects: `<effects and explicit approval>`

## Status history

| Time (UTC) | From | To | Reason | Evidence pointer + digest | Assessor | Independent reviewer |
|---|---|---|---|---|---|---|
| `<ISO-8601>` | `<state>` | `<state>` | `<reason>` | `<pointer + digest>` | `<identity>` | `<identity>` |

