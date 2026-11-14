---
name: project-ui-atlas
description: Build and maintain a local, code-backed atlas of an existing project's screens, dialogs, navigation, UI components, actions, API calls, data storage and editable, object-linked user flows. Use for «покажи все экраны», «карта переходов», «каталог компонентов», «что делает кнопка и откуда данные», «редактируемые user flow с тегами и историей», «контракты данных/API/состояний через атлас», or revising UX through that atlas. Ordinary feature implementation or visual styling alone does not need this workflow.
---

# Project UI Atlas

Give the user a browsable explanation of the actual application inside its existing project, without an external design app or cloud upload. Clicking an illustrated save/delete/take action explains it rather than executing it.

## Scope and evidence

- Inspect project instructions, routes, templates, handlers, data projections and storage before drawing. Reuse an existing atlas/component dev page.
- Distinguish aliases, pages, dialogs, expanded components and states. One URL can contain several screens; nine design alternatives are not nine production flows.
- Respect scope: a pilot covers two or three connected surfaces and explicitly lists omissions. Do not present it as a complete inventory.
- Preserve existing product behavior unless implementation changes were also requested. Record discovered gaps instead of silently fixing them while mapping.

## Application architecture and completion

When designing data, API operations or state transitions through the atlas, read [application-contracts.md](references/application-contracts.md) and the project's own contract/DoD. Require exact types/defaults/invariants and physical storage mapping, server-enforced transitions, typed operations/errors and links to UI projections. Trace both ways from flow revision to persisted data and visible result. An affected path is done only when those contracts agree with code and applicable synthetic positive/negative and end-to-end checks pass. Keep proposed requirements and known gaps separate from implemented behavior; a structural atlas validator is not a domain-contract validator. Do not trigger unrelated storage migrations for a visual-only edit.

## Trace actions

Trace the actual handler end to end:

`control → navigation/local change/request → validation → durable/local storage → refreshed UI`

Record source screen, label, selector, destination or explicit out-of-scope boundary; action kind; input fields and origins; exact method/path; storage operation; affected screens/components; result and cancel/error behavior. Opening a form is not saving it. Distinguish catalog values, a person's plan, actual facts, computed data and browser-local state.

Use source files/functions and browser observations as evidence. Mark source-only and unknown claims. Never invent endpoints, filters, automatic synchronization or persistence.

## Capture actual UI

- Use real rendering code with an isolated synthetic fixture; do not draw an approximate second implementation.
- Capture screens and meaningful component variants from their DOM: collapsed/expanded/recorded item; slot/clock/error form; active/archive/empty list, as applicable.
- Document each component's fields, provenance, states, actions, usage, list membership, actual filters and sorting. Explicitly state absence of search/filter controls.
- Store synthetic screenshots and reproducible selectors next to the manifest. Keep private records and tokens out of shared artifacts.

## Local deliverable

1. **Screens:** previews and directed connections. Selecting a control highlights its destination and explains its effect. Primary clicks on illustrated controls select the action directly on the map, without an intermediate modal or surprise page scroll. Render measured controls at a scale that preserves real tap sizes and gaps; retain a labelled action list for unmapped/compound actions and keyboard access. An optional enlargement must be an explicit separate control, never the default image click. Show one selected connection from the concrete source control to its result, labelled with the action. Anchor at the representation actually clicked (screenshot control or action-list button), not a hidden duplicate. Do not draw an unlabelled bundle between whole screen headers. Local state changes and writes that stay on the screen have an explicit effect summary, not a navigation arrow; name out-of-scope targets instead of suggesting a mapped destination.
2. **Components:** a separate local URL/view with captured real variants, fields, states, list/filter rules and links back to usage.

3. **User flows when requested:** a scoped list of actual paths, editable prose with concrete object/field/screen/component/action tags, revision history and persisted diffs. Use [flow-editing.md](references/flow-editing.md) for identity, storage and Codex handoff. Changes to a flow are proposed requirements until verified against changed code; keep those states visible.

One manifest drives the screen and component views. A **Design / API and data** switch changes content of the same nodes without moving them or resetting selection. Read [manifest.md](references/manifest.md) when building/updating that model. Bundled [viewer assets](assets/atlas.html) are a dependency-free starting point; reuse a suitable existing renderer instead when available.

Serve through the project's established server/launch procedure. Keep sources and assets local. Give a verified LAN URL for mobile review when appropriate.

## Validate through use

Before expanding, complete one small synthetic path through actual UI, saved artifact, reload/restart and the locally served atlas. Expand only when it passes.

- Run `python3 scripts/validate_atlas.py <manifest.json> --project-root <repo>` for graph references, evidence, fingerprints and previews. A stale atlas needs regeneration, not a new timestamp.
- Observe a real navigation, invalid save and successful write in the isolated app. Check request fields and durable result. Opening/cancelling and atlas inspection must not change application state.
- Verify mode-switch position stability, cross-links, same-URL dialogs, explicit boundaries and component variants. Check tap areas, gaps and centers/edges against project rules. Verify a scrolled direct action shows its connection's arrowhead near the selected control, rather than routing only through an off-screen header. Exercise direct screenshot clicks from a scrolled page: the connection must appear without opening a dialog or jumping to the top. Optional dialogs must be viewport-fixed, dismissible by backdrop click and Escape, with a reachable close button while their body is scrolled. Respect the app CSP; verify measured hotspots actually receive their own clicks before expanding captures.
- Review discovery examples in [use-cases.md](references/use-cases.md). Distinguish manual routing review from an independent automatic invocation test.
- Report tested surfaces, behavior and omissions. A passing validator or route count does not prove complete coverage or factual data-flow descriptions. Browser emulation is not a physical device test.
