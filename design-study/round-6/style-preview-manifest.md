# Три контрастных темы Медики

Built-in image generation, one separate call per candidate; no CLI/API-key fallback. Standalone portrait images, same synthetic content and state. New images generated without the rejected green references.

| ID | Тема | Видимая разница | Финальный PNG / промпт |
|---|---|---|---|
| C1 | Белый и фиолетовый | Белая рабочая плоскость, фиолетовые действия, тёмные дозы | [PNG](../../site/public/design-study/round-6/c1.png), [промпт](prompt-c1.json) |
| C2 | Светлый и оранжевый | Белый/эспрессо, насыщенный оранжевый, плоские разделители | [PNG](../../site/public/design-study/round-6/c2.png), [промпт](prompt-c2.json) |
| C3 | Тёмный бордовый | Винный фон, айвори-текст, абрикосовые действия | [PNG](../../site/public/design-study/round-6/c3.png), [промпт](prompt-c3.json) |

Все исходные рендеры, фактические размеры и SHA256 — [render-manifest.json](render-manifest.json); результаты осмотра — [inspection.json](inspection.json). Текстовые пары объявленных токенов проверены отдельно, без заявления о доступности пикселей. Нельзя назначать цветом медицинский риск.

Галерея `/design-study/round-6`: сначала C1 прошёл путь генерация → сохранение → HTTP → крупное изображение/обновление → защита входом на временной синтетической базе; после этого созданы C2/C3. Галерея проверяется на ширинах 320/390/768/1024/1600 и планшете в двух ориентациях. Проверяются реальные ссылки галереи, а не нарисованные внутри PNG действия. Production требует входа; CSP запрещает клинические запросы.

`selectionStatus: awaiting-user-selection`; `selectionSource: pending`; `visualLock.status: unlocked`. Полный набор экранов и рабочая реализация до выбора не создаются. iPad-версия самого интерфейса и физические касания в приложении не проверены.
