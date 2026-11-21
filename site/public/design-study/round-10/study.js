import {familyThemes as themes, familyIcon as icon} from '/family-appearance.js';

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
