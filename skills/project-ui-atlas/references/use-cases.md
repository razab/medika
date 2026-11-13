# Discovery and behavioral scenarios

Review these against the description when changing the skill. They are routing expectations, not a regex classifier or proof of automatic model selection.

| Request | Expected use |
|---|---|
| «Покажи все экраны и куда ведут кнопки» | Atlas, complete only after actual inventory |
| «Попробуй на двух-трёх экранах» | Connected pilot; name omissions |
| «Что делает галочка и где хранится результат?» | Trace handler, request and storage |
| «Откуда заполняется карточка лекарства?» | Field provenance; plan/catalog/fact boundaries |
| «Покажи компоненты, варианты строк и фильтры списков» | Actual DOM variants and existing list rules |
| «Переключай дизайн и запросы на тех же местах» | One model, stable nodes and selection |
| «Стрелки непонятны: что откуда куда?» | One selected, action-labelled connection anchored at the exact source; self-actions and omissions explicit |
| «Пересмотрим переходы через карту» | Load/update atlas; product edits only within requested scope |
| «Сделай кнопку синей» | Ordinary styling, no full atlas needed |
| «Добавь endpoint CSV» | Ordinary feature work; update an affected existing map when relevant |
| «Нарисуй постер / лендинг / логотип» | Other workflow |

Behavioral acceptance: actual navigation reaches its destination; invalid save writes nothing; successful save persists through reload/restart; the atlas explains these actions without replaying API writes; switching views preserves positions; captured components document real fields/states and absent filters honestly.
