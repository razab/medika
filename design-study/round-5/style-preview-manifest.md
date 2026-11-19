# Зелёная палитра: визуальные варианты

Built-in image generation; no CLI/API-key fallback. Five standalone portrait renders, three dark and two light as explicitly requested. Shared synthetic copy/state and approved botanical palette. Exact prompts and declared theme tokens are `prompt-*.json`; actual image hashes/dimensions are in [render-manifest.json](render-manifest.json), inspection and rejected revisions in [inspection.json](inspection.json).

| ID | Вариант | Материал / структура | Финальное изображение |
|---|---|---|---|
| D1 | Лесная керамика | Глубокий зелёный, мягкая скульптурная глубина | [PNG](../../site/public/design-study/round-5/d1.png) |
| D2 | Тихий графит | Матовая плоскость, оливковые акценты и условные формы | [PNG](../../site/public/design-study/round-5/d2.png) |
| D3 | Зелёный бархат | Тональные группы, доза и точки отдельной колонкой | [PNG](../../site/public/design-study/round-5/d3.png) |
| L1 | Светлая керамика | Белая керамика, тёмно-зелёные действия, меньше объёма | [PNG](../../site/public/design-study/round-5/l1.png) |
| L2 | Светлый шалфей | Светлая зелёная плоскость и тональные шапки | [PNG](../../site/public/design-study/round-5/l2.png) |

Одна страница сравнения — `/design-study/round-5`. На широком экране все пять видны рядом; на телефоне идут последовательно. Галерея и каждое изображение требуют входа на production. После первого D1 прошёл сквозной canary до остальных четырёх; полный отчёт галереи — `reports/design-round5-result.json`. До публикации все рендеры просмотрены полностью. Известные ограничения: в D1/D2/L1/L2 контурная галочка — действие, а не подтверждённое состояние; в рабочем UI смысл потребуется явно различить. Растр не проверяет управление или доступность интерфейса, и iPad-версия этих экранов ещё не создавалась.

Подтверждена только палитра. `selectionStatus: awaiting-user-selection`, `selectionSource: pending`, `visualLock.status: unlocked`; финальная тема или компоновка не назначается автоматически.
