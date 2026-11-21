export const familyThemes = [
  {id: 'sand', name: 'Песок и какао'},
  {id: 'espresso', name: 'Тёмный эспрессо'},
  {id: 'stone', name: 'Тёплый графит'},
];

const glyphs = {
  spray: '<rect class="tint" x="8" y="19" width="15" height="16" rx="3"/><path d="M11 19v-6h9v6M14 13V5h5v8M24 8l4-2m-3 6h5m-6 4 4 2"/>',
  drops: '<path class="tint" d="M22 7l4-4a4 4 0 0 1 6 6l-4 4z"/><path d="m22 7-5 5 6 6 5-5M18 13l-9 9-2 6 6-2 9-9"/><path class="tint" d="M9 29c1 2 3 4 3 6a3 3 0 0 1-6 0c0-2 2-4 3-6z"/>',
  solution: '<path d="M17 3h6l1 7-1 5 4 6v12a4 4 0 0 1-4 4h-6a4 4 0 0 1-4-4V21l4-6-1-5z"/><path class="tint" d="M16 24h8v8a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/>',
  capsule: '<g transform="rotate(40 20 20)"><rect x="13" y="3" width="14" height="34" rx="7"/><path class="tint" d="M13 20h14v10a7 7 0 0 1-14 0z"/></g>',
  tablet: '<circle class="tint" cx="20" cy="20" r="13"/><path d="m13 27 14-14"/>',
  slots: '<rect x="7" y="9" width="26" height="25" rx="4"/><path d="M7 17h26M13 6v7m14-7v7m-13 12 4 4 7-7"/>',
  history: '<circle cx="20" cy="20" r="14"/><path d="M20 12v9l6 3"/>',
  check: '<path d="m9 20 7 7 15-15"/>',
};

export function familyIcon(name) {
  if (!Object.hasOwn(glyphs, name)) return "";
  return `<svg class="family-glyph" viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${glyphs[name]}</svg>`;
}
