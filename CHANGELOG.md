# CHANGELOG — MonoCalc Pro 2.1

Все версии следуют формату [Semantic Versioning](https://semver.org/lang/ru/):
- **MAJOR** — ломающие изменения (несовместимый API, смена структуры БД)
- **MINOR** — новые функции (обратно совместимые)
- **PATCH** — исправления багов и патчи UI

Формат записей:
```
## [X.Y.Z] — YYYY-MM-DD
### Added / Changed / Fixed / Removed / Security / Performance
```

---

## [1.0.7] — 2026-03-10

> **Critical bugfix sprint** — 4 критических бага, найденных при полном аудите

### Fixed
- `router/index.js` — убран бесконечный self-redirect `/calc/:id` → `/calc/:id`; заменён на `redirect: '/calc/laser'`
- `core/materials/materials.service.ts` — `softDelete` (не существовал) заменён на `deleteDoc` + `archiveDeletedData`
- `components/SettingsModal.vue` — неверный путь импорта `../composables/useCalculator` исправлен на `@/core/useCalculator`
- `stores/useTrashStore.js` — полностью переписан: Firebase v8 API → v9 modular SDK; убран `useAuthStore` (не существовал); `can` → `canUser` из `@/core/auth/access`; `collection` добавлен в импорты

### Performance
- `services/firebase.js` — инициализировать Google Analytics только в `PROD`
- `services/firebase.js` — убрать `console.log` из production
- `vite.config.js` — добавить `manualChunks` для `DesktopApp`, `MobileApp`, `LaserSettings`, `AdminDataAudit`

---

## [1.0.9] — 2026-03-11

> **Unification sprint** — единая система корзины и мусора, удаление мёртвого кода, полный UI для управления пользователями и архивом

### Added
- `components/admin/UserKanban.vue` — кнопка удаления пользователя (иконка корзины, hover, защита от self-delete) + модал подтверждения с `isDeleting` + `deleteError`
- `views/ArchiveView.vue` — полный редизайн в стиле приложения (TailwindCSS); кнопка «Восстановить» + toast-уведомление; цветовые индикаторы TTL (green/yellow/orange/red)
- `views/ArchiveView.vue` — подключён `restoreFromArchive` из `@/services/restoreFromArchive`

### Changed
- `composables/useTrash.ts` — **переписан как канонический модуль**; экспортирует `moveToTrash`, `addToTrash`, `listTrashItems`, `restoreFromTrash`, `deleteForever`, `TRASH_TTL_DAYS`
- `composables/useGarbage.ts` — **переписан как канонический модуль**; экспортирует `ensureDailyGarbageSlot`, `writeGarbageEvent`, `GARBAGE_SLOTS`, `todaySlot`; добавлена проверка `isSameDay` для идемпотентности
- `composables/useDatabase.js` — inline реализации `archiveToUserTrash`, `ensureDailyGarbageSlot`, `writeGarbage`, `getCloudTrash`, `restoreCloudHistoryFromTrash`, `deleteTrashForever` **заменены делегатами** к единым модулям; убраны `GARBAGE_SLOTS` и `DAY_MS` (теперь в `useGarbage.ts`)
- `services/deleteKanbanUser.ts` — импорт `'./firebase'` → `@/firebase`
- `services/restoreFromArchive.ts` — импорт `'./firebase'` → `@/firebase`

### Removed
- `services/api.js` — deprecated stub, нигде не импортировался — **удалён**
- `services/trashService.js` — deprecated `addDoc`-версия `moveToTrash`, нигде не импортировалась — **удалена**

### Notes (future features — not yet wired)
- `services/deleteUserHistory.ts` — ⚠️ TODO: удаление истории пользователя; UI не реализован
- `services/deleteUserProject.ts` — ⚠️ TODO: коллекция `projects` ещё не создана
- `services/archiveSettingsDiff.ts` — ⚠️ TODO: улучшенный diff-архив настроек
- `services/cleanupArchive.ts` — ⚠️ TODO: ручная очистка архива

---

## [1.0.8] — 2026-03-10

> **Non-critical bugfix sprint** — dead code, производительность, унификация импортов

### Added
- `router/index.js` — добавлен маршрут `/settings/archive` → `ArchiveView.vue` (экран написан, но был недоступен)

### Fixed
- `services/firebase.js` — Google Analytics инициализируется только в `PROD`; в режиме `dev` и PWA offline не подгружается
- `services/firebase.js` — `console.log("Firebase persistence enabled")` защищён гардом `import.meta.env.DEV`
- `views/ArchiveView.vue` — `auth.currentUser.uid` (краш при неавторизованном входе) заменён на `auth.currentUser?.uid` + ранний return
- `views/ArchiveView.vue` — добавлен `getDaysLeft` в деструктуризацию из `useArchive()` (был пропущен, шаблон падал бы в runtime)
- `core/db/index.ts` — динамические `await import()` внутри `restoreTrash()` заменены статическими импортами

### Changed
- `composables/useArchive.ts` — импорт `@/services/firebase` → `@/firebase` (единый стандарт)
- `composables/useDatabase.js` — импорт `../services/firebase` → `@/firebase`
- `views/ArchiveView.vue` — импорт `@/services/firebase` → `@/firebase`

### Performance
- `vite.config.js` — добавлены `manualChunks` для `view-settings`, `view-admin`, `view-archive`, `app-desktop`, `app-mobile`; большой chunk запуска (573 KB) остаётся: для его разбивки нужен `defineAsyncComponent` в `MainCalculator.vue`

### Changed
- `DesktopApp.vue` — все вкладки услуг (постобработка, аксессуары, упаковка, дизайн) переведены с `TransitionGroup name="list"` на `name="service-stack"` с анимацией fade + translateY + blur(2px)
- `DesktopApp.vue` + `main.css` — добавлены CSS-классы `.service-stack-*` для согласованного удаления карточек во всех вкладках

---

## [1.0.5] — 2026-03-10

> Анимация удаления слоёв

### Changed
- `DesktopApp.vue` — список слоёв переведён с `v-if div` на `TransitionGroup name="layer-stack"` (fade + translateY + blur)
- `main.css` — добавлены CSS-классы `.layer-stack-*`

---

## [1.0.4] — 2026-03-10

> Блюр строки себестоимости

### Changed
- `PriceChart.vue` — `cost-spoiler` / `@click` перенесены с `<span>` числа на всю строку `<div class="flex justify-between...">` — теперь блюрится весь ряд «Себестоимость · число · ₽»

---

## [1.0.3] — 2026-03-10

> Лейбл сторон, редизайн подтверждения удаления

### Added
- `DesktopApp.vue` — в лейбл «Стороны» добавлен реактивный счётчик `· 1 / · 2`

### Changed
- `LaserSettings.vue` — полный редизайн overlay удаления карточки: градиентный фон, frosted-glass попап с иконкой/описанием, action-bar с кнопками Отмена/Удалить, красное кольцо вокруг карточки

---

## [1.0.2] — 2026-03-10

> Выравнивание placeholder'ов

### Fixed
- `DesktopApp.vue` — placeholder «Сначала выберите...» во вкладках аксессуаров, упаковки, дизайна, постобработки больше не смещает layout; заменены на фиксированный класс `.empty-selection-placeholder` (h-14)
- `MobileApp.vue` — аналогичный fix для мобильного placeholder

### Added
- `main.css` — новый CSS-класс `.empty-selection-placeholder`

---

## [1.0.1] — 2026-03-10

> Единообразный жирный шрифт в полях ввода

### Changed
- `main.css` — добавлен глобальный `font-weight: 700` для `input`, `textarea`, `select` через `@layer base`
- `main.css` — `font-weight: 600` для `::placeholder`
- `main.css` — `.input-std`, `.step-input` дополнены `font-bold` в `@apply`

---

## [1.0.0] — 2026-02 (baseline)

> Начало истории изменений. Базовая версия проекта после рефакторинга.  
> Коммит: `7dc13d5` — _security: safe pages deploy via actions and block built assets_

### Included at baseline
- Vue 3 + Vite 5 + TailwindCSS 3
- Firebase v12 (Firestore + Auth + Analytics)
- PWA via `vite-plugin-pwa` v0.21
- Маршруты: `/`, `/calc/laser`, `/history`, `/settings`, `/settings/laser`, `/settings/trash`, `/admin/data-audit`
- Роли: superAdmin, admin, user
- Темная/светлая/системная тема
- Drag-and-drop (vuedraggable) в UserKanban
- Offline history через Firestore persistentLocalCache

---

## 🔍 AUDIT REPORT — MonoCalc Pro 2.1

**Дата аудита:** 10 марта 2026  
**Версия на момент аудита:** `1.0.0` (последний коммит: `7dc13d5`)  
**Аудитор:** GitHub Copilot (Claude Sonnet 4.6)  
**Статус билда:** ✅ Проходит (`✓ 110 modules transformed`)

---

## Легенда

| Метка | Значение |
|---|---|
| 🔴 **КРИТИЧНО** | Runtime crash или бесконечный цикл. Ломает приложение при вызове |
| 🟠 **ВЫСОКИЙ** | Dead code или orphaned-файлы. Вводят в заблуждение, риск регрессий |
| 🟡 **СРЕДНИЙ** | Zombie-сервисы: написаны, но нигде не подключены |
| 🔵 **АРХИТЕКТУРА** | Дублирование логики, запутанные пути |
| ⚡ **ПЕРФОРМАНС** | Занижает скорость загрузки и рендера |

---

## 🔴 КРИТИЧЕСКИЕ БАГИ

### 1. `softDelete` не существует — runtime crash

**Файл:** [src/core/materials/materials.service.ts](src/core/materials/materials.service.ts)

```ts
// ❌ СТРОКА 3
import { softDelete } from '@/core/trash/trash.service';
// ❌ СТРОКА 6
return softDelete({ ... });
```

**Проблема:** `src/core/trash/trash.service.ts` экспортирует только `archiveDeletedData` — функции `softDelete` в нём нет. Вызов `deleteMaterial()` падает с `TypeError: softDelete is not a function`.

**Исправление:**
```ts
// ✅ заменить на
import { archiveDeletedData } from '@/core/trash/trash.service';

export async function deleteMaterial(material) {
  return archiveDeletedData({
    scope: 'settings.laser',
    type: 'material',
    sourcePath: 'settings/global_config',
    originalData: material,
    meta: { title: material.name }
  });
}
```

---

### 2. `SettingsModal.vue` импортирует несуществующий файл

**Файл:** [src/components/SettingsModal.vue](src/components/SettingsModal.vue)

```js
// ❌ СТРОКА 3 — файл src/composables/useCalculator.js НЕ существует
import { useCalculator } from '../composables/useCalculator';
```

**Проблема:** В `src/composables/` нет файла `useCalculator`. Правильный путь — `@/core/useCalculator`.  
Компонент сейчас **нигде не используется** (dead code), поэтому build проходит. При любом подключении будет crash.

**Исправление:**
```js
// ✅
import { useCalculator } from '@/core/useCalculator';
```

---

### 3. Бесконечный редирект в роутере

**Файл:** [src/router/index.js](src/router/index.js)

```js
// ❌ СТРОКИ ~22-23 — редиректит на самого себя!
{ path: '/calc/:id', redirect: to => `/calc/${to.params.id}` },
```

**Проблема:** URL `/calc/anything` → редирект → `/calc/anything` → редирект → `/calc/anything` — бесконечный цикл. Vue Router выбрасывает ошибку навигации.

**Исправление:**
```js
// ✅ — fallback на единственный существующий калькулятор
{ path: '/calc/:id', redirect: '/calc/laser' },
```

---

### 4. `useTrashStore.js` — два несовместимых мира в одном файле

**Файл:** [src/stores/useTrashStore.js](src/stores/useTrashStore.js)

**Проблемы (несколько):**

| # | Строка | Описание |
|---|---|---|
| 4a | 7–45 | Использует Firebase **v8 SDK** (`.collection().doc()...`) — с Firebase v9+ не работает |
| 4b | 52 | `import { useAuthStore } from './useAuthStore'` — файл `useAuthStore.js` **не существует** |
| 4c | 47–49 | `collection` используется в `purgeExpiredTrash`, но **не импортирован** |
| 4d | — | Сам `useTrashStore` **нигде не используется** в проекте |

**Вывод:** Файл содержит два независимых куска кода, склеенных в один. Первый — legacy v8, второй — незаконченный черновик с битыми зависимостями.

---

## 🟠 ВЫСОКИЙ — Dead Code (не используются, но занимают место и вводят в заблуждение)

### 5. `ArchiveView.vue` — view без маршрута

**Файл:** [src/views/ArchiveView.vue](src/views/ArchiveView.vue)

Файл существует, импортирует `useArchive`, но **нет ни одного маршрута** в `router/index.js`, который на него ссылается. Пользователь никак не может попасть на этот экран.

**Решение:** Либо добавить маршрут `/settings/archive` → `ArchiveView.vue`, либо удалить файл.

---

### 6. `src/core/db/index.ts` — полный слой абстракции, нигде не подключённый

**Файл:** [src/core/db/index.ts](src/core/db/index.ts)

Файл содержит функции: `getGlobalConfig`, `updateGlobalConfig`, `listHistory`, `saveHistory`, `listTrash`, `moveToTrash`, `restoreTrash`, `deleteTrash`, `listUsers`, `ensureUserDoc`.  
**Ни один** из этих экспортов не импортируется нигде в проекте. Весь DB-адаптер — мёртвый код.  
Реальная логика по-прежнему живёт в монолитном `useDatabase.js`.

---

### 7–8. `useTrash.ts` и `useGarbage.ts` — composables-призраки

| Файл | Экспортирует | Кто использует |
|---|---|---|
| [src/composables/useTrash.ts](src/composables/useTrash.ts) | `moveToTrash`, `restoreFromTrash`, `deleteForever` | **Никто** |
| [src/composables/useGarbage.ts](src/composables/useGarbage.ts) | `ensureDailyGarbageSlot` | **Никто** |

Логика `useGarbage.ts` продублирована прямо внутри `useDatabase.js` (~строка 1163).

---

## 🟡 СРЕДНИЕ — Zombie-сервисы (написаны, нигде не подключены)

Следующие файлы **экспортируют функции, которые нигде не импортируются**:

| Файл | Функция | Статус |
|---|---|---|
| [src/services/deleteKanbanUser.ts](src/services/deleteKanbanUser.ts) | `deleteKanbanUser()` | Не используется |
| [src/services/deleteUserHistory.ts](src/services/deleteUserHistory.ts) | `deleteUserHistory()` | Не используется |
| [src/services/deleteUserProject.ts](src/services/deleteUserProject.ts) | `deleteUserProject()` | Не используется |
| [src/services/cleanupArchive.ts](src/services/cleanupArchive.ts) | `cleanupArchive()` | Не используется |
| [src/services/archiveSettingsDiff.ts](src/services/archiveSettingsDiff.ts) | `archiveSettingsDiff()` | Не используется |
| [src/services/restoreFromArchive.ts](src/services/restoreFromArchive.ts) | `restoreFromArchive()` | Не используется |
| [src/services/trashService.js](src/services/trashService.js) | `moveToTrash()` | `@deprecated`, не используется |
| [src/services/api.js](src/services/api.js) | `deprecatedApi()` | `@deprecated`, заглушка |
| [src/core/materials/materials.service.ts](src/core/materials/materials.service.ts) | `deleteMaterial()` | Не используется + битый import (см. #1) |
| [src/components/SettingsModal.vue](src/components/SettingsModal.vue) | Целый компонент | Не используется + битый import (см. #2) |

---

## 🔵 АРХИТЕКТУРНЫЕ ПРОБЛЕМЫ

### A1. Три реализации `moveToTrash` в одном проекте

Функция `moveToTrash(uid, id, payload)` реализована трижды:

| Место | Различия |
|---|---|
| [src/composables/useTrash.ts](src/composables/useTrash.ts) | `setDoc` + `expiresAtISO` |
| [src/core/db/index.ts](src/core/db/index.ts#L55) | `setDoc` + `deletedAtISO`, без `expiresAtISO` |
| [src/services/trashService.js](src/services/trashService.js) | `addDoc` (другой ID!), без ISO-полей |

Все три пишут в разный формат. Живая логика находится в `useDatabase.js`.

---

### A2. Двойной путь импорта Firebase

```js
// Группа А — через barrel file
import { db } from '@/firebase';               // → src/firebase.ts → services/firebase.js

// Группа Б — напрямую
import { db } from '@/services/firebase';       // → services/firebase.js
import { db } from '../services/firebase';      // → services/firebase.js
```

Barrel-файл `src/firebase.ts` существует для совместимости и это корректно. Но в проекте смешаны все три варианта. Рекомендуется унифицировать на `@/firebase` во всех файлах.

---

### A3. `useDatabase.js` — 61 KB монолит

**Файл:** [src/composables/useDatabase.js](src/composables/useDatabase.js)

Один файл выполняет: auth, listeners, history CRUD, settings sync, trash logic, garbage slots, Google Sheets legacy, audit log, roles. Содержит inline-Firestore-запросы с ручными строковыми путями. Это противоречит цели `src/core/db/collections.ts` (изоляция путей) и `src/core/db/index.ts` (изоляция операций).

---

### A4. Router импортирует два неиспользуемых history-режима

**Файл:** [src/router/index.js](src/router/index.js)

```js
// Импортируется ОБА, но в runtime используется только один
import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
```

Не критично, но неиспользуемый импорт попадает в бандл.

---

## ⚡ ПРОИЗВОДИТЕЛЬНОСТЬ

### P1. Главный JavaScript chunk = 573 KB (gzip: 136 KB)

```
dist/assets/chunk--u33LF8C.js   573.29 kB │ gzip: 136.00 kB  ⚠️
```

**Причина:** Vite разбивает только `node_modules`, но всё приложение (`DesktopApp.vue`, `MobileApp.vue`, `useDatabase.js` 61KB, `LaserSettings.vue`) попадает в один chunk.

**Решение:** Добавить `manualChunks` для app-кода в `vite.config.js`:
```js
manualChunks(id) {
  if (id.includes('node_modules')) { /* ... существующая логика */ }
  
  // Добавить:
  if (id.includes('views/LaserSettings')) return 'view-laser-settings';
  if (id.includes('views/AdminDataAudit')) return 'view-admin';
  if (id.includes('components/DesktopApp')) return 'desktop-app';
  if (id.includes('components/MobileApp')) return 'mobile-app';
}
```

---

### P2. Firebase Analytics загружается при каждом запуске

**Файл:** [src/services/firebase.js](src/services/firebase.js) (~строка 24)

```js
try { getAnalytics(app); } catch { /* ignore */ }
```

Analytics грузит дополнительный JS от Google при каждом открытии, включая офлайн PWA. Следует делать это только в production:
```js
if (import.meta.env.PROD) {
  try { getAnalytics(app); } catch { /* ignore */ }
}
```

---

### P3. `console.log` в production

**Файл:** [src/services/firebase.js](src/services/firebase.js#L112)

```js
console.log("Firebase persistence enabled"); // видно в production
```

Это технический лог, который попадает в консоль пользователя. Замените на:
```js
if (import.meta.env.DEV) console.log("Firebase persistence enabled");
```

---

### P4. Динамический `import()` внутри функции

**Файл:** [src/core/db/index.ts](src/core/db/index.ts) — `restoreTrash()`

```ts
const { doc } = await import('firebase/firestore');
const { db } = await import('@/firebase');
```

Динамический импорт внутри runtime-функции создаёт дополнительный микротаск при каждом вызове. Для статических зависимостей всегда используйте top-level `import`.  
*(Замечание: файл сам по себе не используется — см. #6)*

---

## 📊 Сводная таблица

| # | Приоритет | Файл | Описание |
|---|---|---|---|
| 1 | ✅ ИСПРАВЛЕНО | `core/materials/materials.service.ts` | `softDelete` → `archiveDeletedData` + `deleteDoc` |
| 2 | ✅ ИСПРАВЛЕНО | `components/SettingsModal.vue` | `composables/useCalculator` → `@/core/useCalculator` |
| 3 | ✅ ИСПРАВЛЕНО | `router/index.js` | Self-redirect → `redirect: '/calc/laser'` |
| 4 | ✅ ИСПРАВЛЕНО | `stores/useTrashStore.js` | Firebase v9 SDK + `canUser` из `access.ts` |
| 5 | ✅ ИСПРАВЛЕНО | `views/ArchiveView.vue` | Маршрут + редизайн + кнопка восстановления |
| 6 | ✅ ИСПРАВЛЕНО | `core/db/index.ts` | Динам. импорты убраны, добавлен `import { db }` статически |
| 7 | ✅ АКТИВЕН | `composables/useTrash.ts` | Переписан как канонический модуль; импортируется в `useDatabase.js` |
| 8 | ✅ АКТИВЕН | `composables/useGarbage.ts` | Переписан как канонический модуль; импортируется в `useDatabase.js` |
| 9 | ✅ АКТИВЕН | `services/deleteKanbanUser.ts` | Подключён в `UserKanban.vue` — кнопка удаления + модал |
| 10 | ✅ АКТИВЕН | `services/restoreFromArchive.ts` | Подключён в `ArchiveView.vue` — кнопка «Восстановить» |
| 11 | ✅ УДАЛЁН | `services/api.js` | Dead stub — удалён |
| 12 | ✅ УДАЛЁН | `services/trashService.js` | Deprecated — удалён |
| 13 | ⚠️ TODO: FUTURE FEATURE | `services/deleteUserHistory.ts` | Не подключён — удаление истории пользователя; UI не реализован |
| 14 | ⚠️ TODO: FUTURE FEATURE | `services/deleteUserProject.ts` | Не подключён — коллекция `projects` ещё не создана |
| 15 | ⚠️ TODO: FUTURE FEATURE | `services/archiveSettingsDiff.ts` | Не подключён — улучшенный diff-архив настроек |
| 16 | ⚠️ TODO: FUTURE FEATURE | `services/cleanupArchive.ts` | Не подключён — ручная очистка архива |
| A1 | ✅ ИСПРАВЛЕНО | 3 файла → 1 | `moveToTrash` унифицирован в `useTrash.ts`; `trashService.js` удалён |
| A2 | ✅ ИСПРАВЛЕНО | весь проект | Firebase импорты унифицированы на `@/firebase` |
| A3 | 🔵 АРХИТ. | `composables/useDatabase.js` | Монолит — inline garbage/trash заменены делегатами; внутренние функции сохранены |
| P1 | ⚠️ ЧАСТИЧНО | `vite.config.js` | manualChunks добавлен, 573KB остаётся (нужен `defineAsyncComponent`) |
| P2 | ✅ ИСПРАВЛЕНО | `services/firebase.js` | Analytics только в PROD |
| P3 | ✅ ИСПРАВЛЕНО | `services/firebase.js` | `console.log` только в DEV |
| P4 | ✅ ИСПРАВЛЕНО | `core/db/index.ts` | Динам. импорт заменён статическим |

---

## 🎯 Рекомендуемый порядок исправлений

### Шаг 1 — Критические баги (быстрые правки)
1. Исправить `softDelete` → `archiveDeletedData` в `materials.service.ts`
2. Исправить `/calc/:id` redirect в `router/index.js`
3. Исправить import в `SettingsModal.vue` (даже если компонент пока не подключён)
4. Реструктурировать `useTrashStore.js` — убрать v8 чанк, починить импорты

### Шаг 2 — Подключить или удалить orphans
5. `ArchiveView.vue` → добавить маршрут `/settings/archive`
6. Принять решение по `core/db/index.ts` — либо начать использовать вместо useDatabase.js inline-запросов, либо удалить
7. Проверить, нужны ли `deleteKanbanUser`, `deleteUserHistory` и т.д. — если нет, удалить

### Шаг 3 — Перформанс
8. Добавить `manualChunks` для крупных view/компонентов
9. Analytics только в PROD
10. Убрать `console.log` из production
