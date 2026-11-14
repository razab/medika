#!/usr/bin/env python3
"""Validate graph references, local previews and source freshness; no dependencies."""
import argparse
import hashlib
import json
from pathlib import Path
import struct


def validate(path, project_root):
    data = json.loads(path.read_text())
    errors = []
    def require(ok, message):
        if not ok:
            errors.append(message)
    require(data.get('version') == 1, 'Unsupported version')
    require(data.get('scope', {}).get('kind') in ('pilot', 'complete'), 'Explicit scope required')
    require(bool(data.get('sources')), 'Source fingerprints required')
    def ids(key):
        rows = data.get(key, [])
        result = {r['id'] for r in rows}
        require(len(result) == len(rows), f'Duplicate {key} ID')
        return result
    screens, actions, components = ids('screens'), ids('actions'), ids('components')
    require(bool(screens), 'No screens')
    def source_file(name):
        file = (project_root / name).resolve()
        require(file.is_relative_to(project_root.resolve()) and file.is_file(), f'Missing/outside source: {name}')
        return file if file.is_relative_to(project_root.resolve()) and file.is_file() else None
    for source in data.get('sources', []):
        file = source_file(source['file'])
        if file:
            require(hashlib.sha256(file.read_bytes()).hexdigest() == source['sha256'], f'Stale source: {source["file"]}')
    source_names = {s['file'] for s in data.get('sources', [])}
    def evidence(row):
        require(bool(row.get('evidence')), f'{row["id"]}: evidence required')
        for ref in row.get('evidence', []):
            require(ref['file'] in source_names, f'{row["id"]}: evidence lacks fingerprint')
            file = source_file(ref['file'])
            if file:
                require(bool(ref.get('symbol')) and ref['symbol'] in file.read_text(), f'{row["id"]}: source anchor missing: {ref.get("symbol")}')
    def preview(value):
        src = value['src']
        safe = '://' not in src and not src.startswith('/') and '..' not in Path(src).parts
        require(safe, f'Nonlocal preview: {src}')
        if not safe:
            return
        file = path.parent / src
        require(file.is_file(), f'Missing preview: {src}')
        if file.is_file():
            raw = file.read_bytes()
            require(raw[:8] == b'\x89PNG\r\n\x1a\n', f'Expected PNG: {src}')
            if raw[:8] == b'\x89PNG\r\n\x1a\n' and 'width' in value:
                require(struct.unpack('>II', raw[16:24]) == (value['width'], value['height']), f'Preview size differs: {src}')
    for screen in data.get('screens', []):
        evidence(screen)
        require(screen.get('kind') in ('page', 'dialog'), f'{screen["id"]}: screen kind')
        preview(screen['preview'])
        require(set(screen['componentIds']) <= components, f'{screen["id"]}: dangling component')
    for action in data.get('actions', []):
        evidence(action)
        require(action['from'] in screens, f'{action["id"]}: dangling source')
        require(bool(action.get('to')) != bool(action.get('outside')), f'{action["id"]}: exactly one destination required')
        if action.get('to'):
            require(action['to'] in screens, f'{action["id"]}: dangling destination')
        require(set(action['affects']) <= screens, f'{action["id"]}: dangling affected screen')
        require(action.get('status') in ('observed', 'source-only', 'unknown'), f'{action["id"]}: verification status')
        require(action.get('kind') in ('navigate', 'dialog', 'local', 'read', 'write'), f'{action["id"]}: action kind')
        if action['kind'] == 'write':
            require(action.get('request', {}).get('method') in ('POST', 'PUT', 'PATCH', 'DELETE'), f'{action["id"]}: write request required')
            require(bool(action.get('storage')) and bool(action.get('fields')), f'{action["id"]}: write provenance required')
        if action.get('bounds') and action['from'] in screens:
            b = action['bounds']
            p = next(s for s in data['screens'] if s['id'] == action['from'])['preview']
            require(b['x'] >= 0 and b['y'] >= 0 and b['width'] > 0 and b['height'] > 0 and b['x']+b['width'] <= p['width']+.5 and b['y']+b['height'] <= p['height']+.5, f'{action["id"]}: hotspot outside preview')
    for component in data.get('components', []):
        evidence(component)
        require(set(component['usedOn']) <= screens, f'{component["id"]}: dangling usage')
        require(set(component['actionIds']) <= actions, f'{component["id"]}: dangling action')
        require(bool(component.get('variants')), f'{component["id"]}: actual DOM variant required')
        for variant in component.get('variants', []):
            preview(variant)
            require(variant['screenId'] in screens and bool(variant['selector']), f'{component["id"]}: capture provenance required')
    contract = data.get('contracts')
    if contract:
        require(contract.get('url') == '/ui-atlas/contracts.json', 'Unexpected contract publication route')
        name = contract.get('snapshot', '')
        require(bool(name) and Path(name).name == name, 'Contract snapshot must be local')
        if name and Path(name).name == name:
            document = json.loads((path.parent / name).read_text())
            definitions = document['schema']['definitions']
            operations = {op['id']: op for op in document['operations']}
            require(len(operations) == len(document['operations']), 'Duplicate operation ID')
            def schema_refs(value):
                if isinstance(value, dict):
                    if '$ref' in value:
                        ref = value['$ref']
                        require(ref.startswith('#/definitions/') and ref.split('/')[-1] in definitions, f'Dangling schema reference: {ref}')
                    for child in value.values():
                        schema_refs(child)
                elif isinstance(value, list):
                    for child in value:
                        schema_refs(child)
            schema_refs(document['schema'])
            for entity in document['entities']:
                require(entity['schema'] in definitions, f'{entity["id"]}: missing executable type')
                require(entity['component'] in components, f'{entity["id"]}: missing component')
                require(bool(entity.get('storage', {}).get('table')), f'{entity["id"]}: storage mapping required')
            valid_refs = set(operations) | {e['id'] for e in document['entities']} | {'schema:' + name for name in definitions}
            for row in data['actions'] + data['components']:
                require(set(row.get('contractRefs', [])) <= valid_refs, f'{row["id"]}: missing contextual contract')
            for op in operations.values():
                require(op['response'] in definitions and (not op.get('request') or op['request'] in definitions), f'{op["id"]}: missing request/response type')
                require(set(op['actionIds']) <= actions, f'{op["id"]}: missing mapped action')
            for binding in document['bindings']:
                require(binding['component'] in components, f'{binding["component"]}: missing UI consumer')
                require(binding['type'] in definitions, f'{binding["component"]}: missing binding type')
                props = definitions.get(binding['type'], {}).get('properties', {})
                require(set(binding['paths']) <= set(props), f'{binding["component"]}: missing typed field path')
                require(all(binding.get(key) in operations for key in ('read', 'write', 'undo') if binding.get(key)), f'{binding["component"]}: missing operation')
    flow_file = path.parent / 'flows-seed.json'
    if flow_file.is_file():
        flows = json.loads(flow_file.read_text())
        entities = flows.get('entities', [])
        entity_ids = {entity['id'] for entity in entities}
        require(len(entity_ids) == len(entities), 'Duplicate flow entity ID')
        require(len({flow['id'] for flow in flows.get('flows', [])}) == len(flows.get('flows', [])), 'Duplicate flow ID')
        for entity in entities:
            evidence(entity)
            require(set(entity.get('screenIds', [])) <= screens, f'{entity["id"]}: dangling flow screen')
            require(set(entity.get('componentIds', [])) <= components, f'{entity["id"]}: dangling flow component')
            require(set(entity.get('actionIds', [])) <= actions, f'{entity["id"]}: dangling flow action')
            require(bool(entity.get('description')) and bool(entity.get('storage')), f'{entity["id"]}: object meaning and storage required')
        for flow in flows.get('flows', []):
            require(bool(flow.get('text')) and bool(flow.get('title')), f'{flow["id"]}: flow text required')
            require(set(flow.get('actionIds', [])) <= actions, f'{flow["id"]}: dangling flow action')
    return errors


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--project-root', type=Path, required=True)
    args = parser.parse_args()
    try:
        errors = validate(args.manifest, args.project_root)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        errors = [str(exc)]
    print(json.dumps({'status': 'FAIL' if errors else 'PASS', 'errors': errors}, ensure_ascii=False, indent=2))
    raise SystemExit(bool(errors))
