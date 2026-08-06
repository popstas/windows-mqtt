# TODO
- [x] Пикер: перестань писать id сессии в скобках в заголовке диалога, уже есть отдельный элемент
- [x] Пикер: при выключенном Show event сбивается layout — `.state` с `margin-left: auto` держит usage справа; без него usage съезжает влево. Usage (и age) должны оставаться прижаты вправо и без текста event
- [ ] Пикер: 2 сессии конкурируют за 1 место recent, надо сортировать по минутам, а не по секундам, чтобы не было гонки

# Future
- [x] Убрать `../config.yml` и `../data/**` из bundle.resources (секреты и личные данные попадают в инсталлер; data с дистом старой сборки уже ронял build stack overflow)
- [ ] Мигрировать проект на ESM (`"type": "module"` в package.json): переписать require/module.exports в src/ и scripts/, проверить bridge-режим и standalone
- [ ] Упаковка прод-сборки: node_modules не бандлятся, `node` берётся из PATH — выбрать стратегию (portable из чекаута / esbuild с external-нативами), см. docs/superpowers/plans/2026-07-06-tauri-migration-completion.md (Follow-up)
- [ ] Гигиена: README (упоминания Electron, несуществующие скрипты), удалить dist/, crash.log, src/daemon/
- [ ] Восстановить модуль vad (naudiodon2 несовместим с Node 24 — нужен ресёрч замены), если ещё нужен
