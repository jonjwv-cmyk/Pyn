# Windows build (Stage 12)

## Что готово

Pyn кросс-платформенный по коду — никаких Mac-only API в `electron/`. Проверено:

- ✅ Все `path.*` используют `path.join` (platform-agnostic separators)
- ✅ `process.platform === 'darwin'` branches (titlebar style, traffic lights) — работают на Win по else-path
- ✅ Windows proxy detection: `electron/network/proxy.ts::detectProxy()` — PowerShell `DefaultWebProxy` + TCP probe (1:1 порт `CorporateProxy.kt`)
- ✅ Native deps `ws` (bufferutil/utf-8-validate) заглушены через alias → нет нативной компиляции
- ✅ TLS pin (`setCertificateVerifyProc`) — Chromium API, идентично Win/Mac
- ✅ DNS override (`host-resolver-rules`) — Chromium switch, работает на Win
- ✅ `safeStorage` token + cache persistence — на Win использует DPAPI (per-user encryption)
- ✅ electron-builder config (`package.json::build`): `win.target=nsis` + icon path

## Что нужно сделать перед production-сборкой

1. **Иконки** — положить `apps/desktop/build/icon.ico` (NSIS + EXE) и `icon.icns` (Mac). См. `apps/desktop/build/README.md`.
2. **Code-signing** — для Win EXE нужен SignPath / MS Trusted Signing / SSL.com cert. Без подписи Windows SmartScreen блокирует первый запуск.
3. **Auto-update** (опц.) — `electron-updater` + GitHub Releases. Требует подписанные релизы.

## Команды сборки

На **Windows host**:
```powershell
pnpm install
pnpm typecheck
pnpm build:desktop:win
# → release/Pyn Setup X.Y.Z.exe (NSIS installer)
```

На **Mac** для **Mac DMG**:
```sh
pnpm build:desktop:mac
# → release/Pyn-X.Y.Z.dmg
```

Кросс-сборка `Mac → Win EXE` возможна через Wine, но непредсказуема. Лучше GitHub Actions workflow с `windows-latest` runner.

## Известные Win-specific риски

| Риск | Митигация |
|---|---|
| **Kaspersky PDM:WebToolbar.MultiPlug** — false positive на unsigned EXE с network probes | Code-sign + stealth network patterns (см. OTLHelper2 incident #33 в MAP.md) |
| **WPAD/GPO прокси** между офис/дом | `proxy.ts::detectProxy()` делает TCP probe + fallback на direct (см. грабля #25 в MAP.md) |
| **SmartScreen** блокирует unsigned EXE | Code-signing (EV cert даёт reputation сразу) |
| **DPAPI scope** — `safeStorage` per-user, не работает в Domain context с roaming profiles | Документировать |
| **AV intercept TLS** — корп-Kaspersky подменяет cert | `tls.ts::isCorporateAvCert()` детектит issuer и fallback на default verify |

## Финальный чек-лист для первого Win release

- [ ] `apps/desktop/build/icon.ico` положен (256x256+)
- [ ] `apps/desktop/build/icon.icns` положен (для Mac, чтобы CI собирал оба)
- [ ] Code-signing cert настроен (SignPath OSS Foundation? см. MAP.md грабля #34)
- [ ] `pnpm build:desktop:win` на Windows host или CI runner — green
- [ ] Installer запущен на чистой Win 10/11 — проходит SmartScreen / Kaspersky
- [ ] Login через QR + password — works
- [ ] News feed + chats loadятся, аватары + attachments расшифровываются
- [ ] Логи в `%LOCALAPPDATA%\Pyn\logs\` (TODO: настроить electron-log)
