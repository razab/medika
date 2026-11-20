const themes = [
  {id: 'sand', name: 'Песок и какао'},
  {id: 'espresso', name: 'Тёмный эспрессо'},
  {id: 'stone', name: 'Тёплый графит'},
];

const people = [
  {
    name: 'Лена',
    phase: 'Острая фаза',
    medicines: [
      {form: 'spray', name: 'Спрей для носа', dose: '2 пшика', course: 'Ещё 5 дней', dots: [true, false, false]},
      {form: 'drops', name: 'Капли', dose: '5 капель', course: 'Ещё 3 дня', dots: [false, false]},
    ],
  },
  {
    name: 'Миша',
    phase: 'Поддерживающая',
    medicines: [
      {form: 'solution', name: 'Раствор', dose: '1 мл', course: 'Ещё 4 дня', dots: [true, false]},
      {form: 'capsule', name: 'Капсулы', dose: '1 капс.', course: 'Последний день', dots: [false]},
    ],
  },
];

const glyphs = {
  spray: '<rect class="tint" x="8" y="19" width="15" height="16" rx="3"/><path d="M11 19v-6h9v6M14 13V5h5v8M24 8l4-2m-3 6h5m-6 4 4 2"/>',
  drops: '<path class="tint" d="M22 7l4-4a4 4 0 0 1 6 6l-4 4z"/><path d="m22 7-5 5 6 6 5-5M18 13l-9 9-2 6 6-2 9-9"/><path class="tint" d="M9 29c1 2 3 4 3 6a3 3 0 0 1-6 0c0-2 2-4 3-6z"/>',
  solution: '<path d="M17 3h6l1 7-1 5 4 6v12a4 4 0 0 1-4 4h-6a4 4 0 0 1-4-4V21l4-6-1-5z"/><path class="tint" d="M16 24h8v8a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/>',
  capsule: '<g transform="rotate(40 20 20)"><rect x="13" y="3" width="14" height="34" rx="7"/><path class="tint" d="M13 20h14v10a7 7 0 0 1-14 0z"/></g>',
  slots: '<rect x="7" y="9" width="26" height="25" rx="4"/><path d="M7 17h26M13 6v7m14-7v7m-13 12 4 4 7-7"/>',
  history: '<circle cx="20" cy="20" r="14"/><path d="M20 12v9l6 3"/>',
  check: '<path d="m9 20 7 7 15-15"/>',
};

function icon(name) {
  return `<svg class="glyph" viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${glyphs[name]}</svg>`;
}

function medicineRow(medicine) {
  const marked = medicine.dots[0];
  const recorded = medicine.dots.filter(Boolean).length;
  return `<li class="medicine">
    <span class="form-icon" data-form="${medicine.form}">${icon(medicine.form)}</span>
    <div class="medicine-copy">
      <strong>${medicine.name}</strong>
      <span class="course">${medicine.course}</span>
    </div>
    <div class="dose-and-progress">
      <span class="dose">${medicine.dose}</span>
      <span class="dots" role="img" aria-label="Отмечено приёмов: ${recorded} из ${medicine.dots.length}">
        ${medicine.dots.map(recorded => `<i${recorded ? ' class="filled"' : ''}></i>`).join('')}
      </span>
    </div>
    <span class="mark${marked ? ' marked' : ''}" role="img" aria-label="${marked ? 'Приём отмечен' : 'Приём не отмечен'}">
      ${marked ? icon('check') : ''}
    </span>
  </li>`;
}

const template = document.querySelector('#screen');
const previews = document.querySelector('.previews');
const links = document.querySelector('.theme-links');

for (const theme of themes) {
  const preview = document.createElement('section');
  preview.id = theme.id;
  preview.className = `preview ${theme.id}`;
  preview.setAttribute('aria-labelledby', `theme-${theme.id}`);
  preview.innerHTML = `<h2 id="theme-${theme.id}">${theme.name}</h2>`;
  preview.append(template.content.cloneNode(true));
  preview.querySelector('.people').innerHTML = people.map(person => `<section class="person">
    <h5>${person.name} <span>${person.phase}</span></h5>
    <ul>${person.medicines.map(medicineRow).join('')}</ul>
  </section>`).join('');
  preview.querySelector('.app-tabs').innerHTML = `
    <li aria-current="page">${icon('slots')}Приёмы</li>
    <li>${icon('capsule')}Лекарства</li>
    <li>${icon('history')}История</li>`;
  previews.append(preview);

  const link = document.createElement('a');
  link.href = `#${theme.id}`;
  link.textContent = theme.name;
  links.append(link);
}
