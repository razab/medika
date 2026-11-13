# Atlas manifest v1

One JSON drives map, component catalog and API/data view. Evidence paths are relative to the project root. Previews are same-directory PNGs; no executable HTML, tokens or private payloads.

Root: `version:1`, `project`, `generatedAt` (ISO), `revision`, `scope:{kind:"pilot"|"complete",summary,omitted:[]}`, `sources:[{file,sha256}]`, `screens:[]`, `actions:[]`, `components:[]`.

Screen: `{id,title,kind,route,description,preview,evidence,reads,componentIds}`.

- `kind`: page/dialog. Same-route dialogs remain distinct meaningful nodes.
- `preview:{src,width,height}`: synthetic actual-browser capture in CSS pixels.
- `evidence:[{file,symbol}]`: source function/selector/anchor that really exists.
- `reads:[{name,source}]`: API/storage/derived inputs.

Action: `{id,from,to?,outside?,label,selector,kind,status,evidence,fields,storage,affects,result,errors,request?,bounds?}`.

- Exactly one destination: mapped `to`, or `outside` naming an omitted surface. Self-link means staying on the screen.
- `kind`: navigate/dialog/local/read/write; `status`: observed/source-only/unknown. Observed means tested through the real application.
- `request:{method,path}` only when actually requested; parameterize IDs.
- `fields:[{name,source,required,meaning}]`: distinguish user input, route defaults, catalog, generated keys and versions.
- `storage:[{name,operation}]`: read/insert/update/browser/none. `affects:[]` references mapped screen IDs.
- `result` describes success; `errors:[]` covers cancellation, validation and failures.
- Optional `bounds:{x,y,width,height}` measures the actual control relative to its preview. Capture before changing scroll. Hotspots only inspect; small/overlapping targets should use the labelled action list instead of enlarged invisible areas.

Component: `{id,title,kind,description,usedOn,evidence,fields,states,filters,actionIds,variants}`.

- `kind`: card/list-item/list/filter/form/control/status.
- `usedOn` and `actionIds` reference mapped IDs. `fields` use action field shape above.
- `filters:[]` states actual filtering/sorting, including absence of controls.
- `variants:[{title,src,screenId,selector}]`: actual DOM captures with reproducible provenance, clearly presented as state images.

Fingerprints cover the files relied upon. The validator checks structure and provenance, not whether the described business behavior is true. Browser checks must establish the latter.
