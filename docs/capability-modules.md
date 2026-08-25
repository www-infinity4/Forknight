# Forknight Capability Modules

Forknight keeps its game identity while gaining a real engineering control layer. Each module is small, independently testable, and distributed to other projects only when needed.

| # | Module | What it adds | System benefit | Status |
|---:|---|---|---|---|
| 1 | **ChronoRelay** | An ordered, append-only conversation and event stream shared by authorized AI workers. | Lets kris steer several AI systems from one timeline without copying conversations manually. | Draft implementation in PR #3 |
| 2 | **AetherScout** | Bounded research jobs with explicit allowed sources and deterministic job states. | Gives Gemini and other research models focused assignments without permitting uncontrolled crawling. | Draft implementation in PR #3 |
| 3 | **XenonHarvester** | Commit-pinned capability analysis with licensing, attribution, and clean-room decisions. | Learns the useful 10% of an upstream design without blindly importing an entire framework. | Draft implementation in PR #3 |
| 4 | **ApexGate** | Static checks, security review, test evidence, and peer-model verdicts. | Stops AI drafts from being treated as deployable code until evidence supports them. | Next batch |
| 5 | **NovaSight** | Scene, frame, dialogue, and interaction observations for StarQuest media. | Gives Cosmo structured understanding of what is happening on screen for commentary, cards, accessibility, and carefully governed recommendations. | Next batch |
| 6 | **SonicForge** | Browser-native audio analysis and synchronized visual parameters. | Makes Alien Radio and media pages visually react to live sound without a large hosted media dependency. | Next batch |
| 7 | **VaultGuard** | Transaction proposals, deterministic ledger transitions, and human approvals. | Connects the unified wallet safely while keeping signing keys outside AI context. | Planned |
| 8 | **EduScript** | Converts engineering material into interactive lessons and component experiments. | Powers the television, amplifier, electronics, and physics learning pages with progressive instruction. | Planned |
| 9 | **OhmSimulator** | Translates bounded circuit descriptions into validated netlists and test vectors. | Lets users change real component values and observe simulated effects before building hardware. | Planned |
| 10 | **CardSmith** | Metadata-driven card layouts, numbered variants, and provenance records. | Produces consistent StarQuest collectible sets while preserving per-user uniqueness and source attribution. | Planned |
| 11 | **HyperDeploy** | Preview publication, deployment evidence, and rollback manifests. | Moves verified modules to GitHub and Cloudflare without exposing deployment credentials to models. | Planned |
| 12 | **ProvenanceStamp** | Source, contributor, model, review, and digest lineage for every artifact. | Shows who produced and approved each piece of work and where its ideas originated. | Planned |
| 13 | **SwarmBalancer** | Capability-aware assignment and fallback routing across connected AI workers. | Gives each model a real specialty instead of paying several models to repeat the same answer. | Planned |
| 14 | **LoreKeeper** | Project knowledge graphs and contradiction detection. | Keeps StarQuest behavior, characters, rules, and long-running Infinity specifications consistent. | Planned |
| 15 | **PulseMonitor** | Health, latency, error, and queue telemetry with secret redaction. | Makes broken workers and websites visible before failures spread across projects. | Planned |
| 16 | **SynthVoice** | Governed browser speech and audio effects for fictional voices. | Provides accessible StarQuest and Alien Radio narration without imitating real people without permission. | Planned |
| 17 | **RefactorLens** | Evidence-backed technical-debt findings and candidate patches. | Finds duplicated or unfinished code across the repository collection without automatically rewriting it. | Planned |
| 18 | **SyncSandbox** | Conflict-safe collaborative state for editors and simulators. | Lets humans and authorized AI workers work on shared designs without overwriting one another. | Planned |
| 19 | **AssetPacker** | Deterministic optimization and integrity manifests for images, audio, and scripts. | Improves loading on Android and other constrained devices while detecting changed or malformed assets. | Planned |
| 20 | **QuestMaster** | End-to-end scenarios spanning research, extraction, review, publishing, and verification. | Proves that the full Forknight workflow works as one system rather than twenty disconnected demos. | Planned |

## External AI source packets

External models should receive a bounded source packet rather than a vague repository name:

1. Exact repository and branch or commit.
2. Direct raw links to only the relevant files.
3. Current interfaces and invariants.
4. The failing test or bounded assignment.
5. Required output format.
6. A warning that the response is a candidate patch requiring ApexGate review.

This is how Gemini can contribute useful focused work without pretending it has live GitHub access.
