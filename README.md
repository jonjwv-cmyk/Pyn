# Pyn

Перед задачами для ИИ-агентов см. [Регламент работы](./REGLEMENT_WORK.md):
экономный порядок действий, правила запуска desktop и проверки UI без серого
экрана.

Кросс-платформенное приложение — **Electron** (desktop, Mac/Win) + **React Native + Expo** (mobile, iOS/iPad/Android).
Shared TypeScript codebase для бизнес-логики (API, crypto, types).

## Структура

```
Pyn/
├── apps/
│   ├── desktop/        Electron app → Mac, Windows
│   └── mobile/         Expo React Native → iOS, iPad, Android
├── packages/
│   ├── core/           Shared TS: API client, crypto, types, store
│   └── tsconfig/       Базовый TS config + react / react-native presets
├── pnpm-workspace.yaml
└── package.json
```

## Требования

- **Node.js ≥ 20** (`brew install node`)
- **pnpm ≥ 11** (`npm install -g pnpm`)
- **Cursor** или **VS Code** — редактор
- **Android Studio** — для Android Emulator (mobile)
- **Xcode** — для iOS Simulator (mobile, понадобится позже)

## Первый запуск

```sh
cd ~/StudioProjects/Pyn
pnpm install               # установка всех зависимостей monorepo (~2 минуты в первый раз)
```

## Разработка

### Desktop (Electron, Mac/Win)

```sh
pnpm dev:desktop
```

Откроется окно Pyn + Vite dev server на http://localhost:5173.
Hot reload: меняешь `.tsx` → окно обновляется автоматически за ~1 секунду.

**Build production DMG (Mac):**

```sh
pnpm build:desktop:mac
# → apps/desktop/release/Pyn-0.0.1.dmg
```

**Build production MSI (Windows):**

```sh
pnpm build:desktop:win   # запускать на Windows-машине
```

### Mobile (Expo, iOS/Android)

```sh
pnpm dev:mobile          # запускает Expo dev server
```

Затем:
- **Android**: `pnpm build:mobile:android` (или нажать `a` в Expo CLI) → откроется в Android Emulator
- **iOS**: `pnpm build:mobile:ios` (или нажать `i`) → откроется в iOS Simulator
- **На реальном устройстве**: установи «Expo Go» из App Store / Play Store → отсканируй QR в терминале

## Type-check всех пакетов

```sh
pnpm typecheck
```

## Архитектурные правила

1. **Shared логика → `packages/core`** (`@pyn/core`). Сюда переносится API client,
   crypto, types. Один раз написал — используется и в Electron, и в RN.

2. **UI layer отдельный**. `apps/desktop/src/` — HTML/CSS/Tailwind/Shadcn;
   `apps/mobile/app/` — React Native компоненты. Бизнес-логика общая, рендеринг
   per-platform.

3. **Никаких глобальных side-effects в `packages/core`**. Только pure functions
   и классы. State (Zustand) принимается через DI или передаётся параметрами.

4. **TypeScript strict** включён везде. `noUncheckedIndexedAccess: true`.

## Палитра (Tailwind)

Цвета warm-dark (`apps/desktop/tailwind.config.ts`):

| Token | Hex |
|---|---|
| `bg-surface` | `#1F1E1B` (основной фон card) |
| `bg-primary` | `#262624` |
| `bg-elevated` | `#302F2D` |
| `bg-deep` | `#161611` |
| `text-strong` | `#F5F4EF` |
| `text-primary` | `#E5E5E2` |
| `text-muted` | `#A6A39B` |
| `accent-clay` | `#D97757` |

Используется как обычный Tailwind class: `<div className="bg-bg-surface text-text-strong">…</div>`.

## Bundle IDs

| Платформа | ID |
|---|---|
| Mac (DMG) | `app.pyn.desktop` |
| Windows (MSI) | `app.pyn.desktop` |
| iOS / iPadOS | `app.pyn.mobile` |
| Android | `app.pyn.mobile` |

## Roadmap

| Этап | Статус |
|---|---|
| Skeleton: monorepo + Electron + Expo + shared core | ✅ |
| UI Foundation: tokens, atoms (Avatar/Badge/IconButton), layout | ⏳ |
| Sidebar (rounded floating, collapse animation) | ⏳ |
| Chats screen (list + conversation) | ⏳ |
| News feed (cards + reactions + poll) | ⏳ |
| API client + crypto (порт со старого проекта) | ⏳ |
| Login + session flow | ⏳ |
| iOS/Android главные экраны | ⏳ |
| Production sign + auto-update | ⏳ |
