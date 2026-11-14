# Application contracts through the atlas

Read this when the atlas is used to design the application's data model, operations and states, or when a user-flow revision changes them. An atlas can be an architecture workbench, but browsing it does not itself migrate data or implement a proposed contract. Preserve the project's selected database and authorization boundaries.

## Model before completion

Inspect the actual persistence model. State the chosen storage model and distinguish a database engine, a domain type, JSON serialization, a request/response DTO and a UI projection. Do not call JSON fields a separate NoSQL database or claim a fully relational/typed schema merely because SQLite is used. Do not perform a database rewrite as a side effect of documenting the model.

For each affected type, require stable identity, exact field types and nested shapes, enums/ranges/formats/units, required/nullable/missing behavior, create/update defaults, ownership, readonly/writeable fields, links/cardinality, invariants and exact physical storage mapping. Distinguish schema version, record concurrency version and user-flow revision. Unknowns remain visible gaps.

Use the project's canonical executable type definitions. Runtime validation must enforce them at trust boundaries; generated types or documentation alone do not enforce values. Domain invariants and references require server checks in addition to structural schemas and appropriate database constraints. Do not maintain an independent approximate schema in the atlas: link stable IDs to shared definitions and mapping code.

## State and API

For stateful objects require a transition table: source state → operation/initiator → preconditions/version → target state → atomic writes/side effects/audit → rejection. Specify initial/terminal states, self-transitions, repeated commands, correction, cancellation and restoration. Unlisted transitions are forbidden. UI loading/error and derived statuses are separate from stored domain state; state-free objects need no invented state machine.

For each operation require a stable ID, method/path or explicit local action, typed path/query/body and response, value origins, access/ownership, preconditions, transaction boundary, affected records/fields, errors and recovery, retries/idempotency, stale-version behavior and the query/projection/UI components refreshed afterward. Reads define filters, sorting and result limits. An enabled/disabled control is not server validation.

Trace in both directions:

`flow revision → step/action → operation → request/transition/invariants → storage → response/query projection → component field → visible result`

If the UI requires different data, design the corresponding contract change and compatibility before declaring completion. Conversely, a schema/API change must identify existing consumers and update their rendering, empty/error/conflict states and recovery paths. Preserve historical snapshots and immutable audit where the project requires them.

## Change and validation

Read old and new flow versions and tag references. The impact list is a candidate set, not proof of complete architecture coverage. Check schema, operation, projection, component and storage consumers against code. Keep proposed requirements separate from implemented contracts; do not acknowledge a review request until its authorized change and validation are complete.

An affected feature is done only with linked types/storage/transitions/API/UI, runtime checks, valid/invalid synthetic examples and a real path through request, persisted result, new read and visible UI. Test stale versions/retries and migration/restore when relevant; restart proves durability where required. A passing graph/fingerprint validator does not validate API values or business transitions. Name validation gaps instead of inventing commands or marking them passed. A visual-only edit references unchanged contracts rather than triggering an unrelated migration.

For Medika, the project-specific decisions, required fields, current gaps and Definition of Done are in `APPLICATION-CONTRACT.md` at the project root. SQLite is selected; current JSON payloads and manual validators do not yet constitute complete executable schemas. JSON Schema is the target shared contract format. Its integration and a contract-aware atlas are implementation work, not a consequence of writing these rules.
