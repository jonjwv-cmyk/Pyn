# Pyn — сборка под Windows (portable)

Pyn ships **portable EXE** — без установщика. Юзер запускает файл, он сам
разворачивается в `%LOCALAPPDATA%\Pyn-temp\` и стартует. Выбрано чтобы
Kaspersky не флагал распаковку (PDM heuristic на `%TEMP%`).

## Что готово в коде

- `apps/desktop/package.json::build.win` — target `portable`, иконка
  `build/icon.ico`, artifactName `pyn-${version}-portable.exe`.
- `apps/desktop/build/icon.svg` — source-of-truth логотипа (orange map-pin
  + orbiting arrow на чёрном фоне).
- `scripts/build-icons.mjs` — генерирует `.ico` / `.icns` / `.png` через
  ImageMagick. Запуск: `pnpm --filter @pyn/desktop build:icons`.
- `.github/workflows/release-win.yml` — Windows runner: pnpm install →
  build:icons → build:win → SCP на VPS.
- **Auto-update в самом приложении**:
  - `apps/desktop/electron/ipc/update-bridge.ts` — IPC handler качает exe
    через `net.request` (с TLS pin) в `%LOCALAPPDATA%\@pyn\desktop\updates\`
    и запускает через `cmd.exe` с kill-WebView2 + relaunch.
  - `apps/desktop/src/components/system/UpdatePromptDialog.tsx` — UI с
    прогресс-баром.
  - `apps/desktop/src/App.tsx` — polling `app_status` каждые 30 мин.
- Все network-стек уже кросс-платформенный (TLS pin, DNS override, proxy
  detection через PowerShell на Win, safeStorage с DPAPI).

## Кросс-платформенные инварианты

- Все `path.*` через `path.join` (без `/` хардкода).
- `process.platform === 'darwin'` branches — Mac-only; всё прочее работает
  через else-path и на Win.
- `bufferutil` / `utf-8-validate` — заглушены через `electron/stubs/empty.cjs`
  (нет нативной компиляции).
- `safeStorage` использует DPAPI на Win (per-user encryption).

## Подпись — SignPath OSS (pending)

**Сейчас EXE unsigned.** Windows SmartScreen на первой запуске покажет жёлтое
«издатель неизвестен» → «Подробнее» → «Выполнить в любом случае». Можно
жить с этим как stop-gap.

Для устранения warning'a:

1. Pyn должен быть **публичным GitHub репо** с LICENSE (MIT уже добавлен).
2. Подать заявку на [SignPath OSS Foundation](https://signpath.io/foundation).
   Approval 1-2 недели.
3. После approval — добавить в `release-win.yml` step:
   ```yaml
   - uses: signpath/github-action-submit-signing-request@v1
     with:
       api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
       organization-id: ${{ secrets.SIGNPATH_ORG_ID }}
       project-slug: pyn
       signing-policy-slug: release-signing
       artifact-configuration-slug: portable-exe
       github-artifact-id: ${{ steps.upload.outputs.artifact-id }}
   ```

Альтернативы (если SignPath откажет):
- MS Trusted Signing — $10/мес, требует Azure + INTL карта.
- SSL.com EV cert — $159/год, USB-токен.
- Self-signed — **НЕ рекомендуется**, Kaspersky-PDM реагирует сильнее.

## Локальная сборка (тест на Mac)

Mac не может выпустить готовый Win exe (нужен Wine + Windows toolchain),
но конфиг и иконки можно проверить:

```sh
cd ~/StudioProjects/Pyn
brew install imagemagick                # один раз
pnpm install
pnpm --filter @pyn/desktop build:icons  # создаст .ico / .icns / .png
# build:win на Mac упадёт на wine-этапе — это OK, проверь что упало именно там
```

## Publish flow

1. Bump version в `apps/desktop/package.json`:
   ```diff
   - "version": "1.2.0",
   + "version": "1.2.1",
   ```
2. Commit + tag + push:
   ```sh
   git add apps/desktop/package.json
   git commit -m "release: v1.2.1"
   git tag v1.2.1
   git push origin main v1.2.1
   ```
3. CI ловит tag, собирает Windows runner'ом, SCP'ит на VPS:
   ```
   /var/www/otl-releases/pyn-latest.exe
   ```
4. Юзеры скачивают стабильной ссылкой:
   ```
   https://45-12-239-5.sslip.io/pyn.exe
   ```
5. Уже запущенные клиенты увидят `app_status.current_version > local` в
   течение 30 мин и сами предложат обновиться.

## Required GitHub Secrets

`Settings → Secrets and variables → Actions`:

| Secret | Значение | Где взять |
|---|---|---|
| `VPS_SSH_KEY` | Содержимое `~/.ssh/otl_vps_setup` (private key без passphrase) | Локальный ssh ключ |
| `CLOUDFLARE_API_TOKEN` | CF API token с правами D1+R2 Edit | `~/Documents/HELPERS/SECRETS.md` |
| `CLOUDFLARE_ACCOUNT_ID` | CF account ID | `~/Documents/HELPERS/SECRETS.md` |
| `SIGNPATH_API_TOKEN` | (после approval) | signpath.io |

**Note**: реальные значения смотри в локальной копии `~/Documents/HELPERS/SECRETS.md` — в репо их **не коммитим**.

## VPS nginx-конфиг (одноразово)

На `45.12.239.5` в активном sslip.io vhost добавить рядом с существующим
`/win.exe` (для OTLHelper2):

```nginx
location = /pyn.exe {
  alias /var/www/otl-releases/pyn-latest.exe;
  default_type application/vnd.microsoft.portable-executable;
  add_header Cache-Control "public, max-age=300";
  add_header Content-Disposition 'attachment; filename="pyn.exe"';
}
```

```sh
ssh root@45.12.239.5 "nginx -t && systemctl reload nginx"
```

Также убедиться что папка существует и доступна на запись:
```sh
ssh root@45.12.239.5 "mkdir -p /var/www/otl-releases && chmod 755 /var/www/otl-releases"
```

## Server-side: app_version row

CF Worker отдаёт `current_version` через `app_status` endpoint. Pyn ходит
со scope `desktop-win` (Win) / `desktop-mac` (Mac).

```sh
wrangler d1 execute otl-helper-db --remote --command "
  INSERT INTO app_version (app_scope, current_version, min_version, update_url)
  VALUES ('desktop-win', '1.2.0', '1.0.0', 'https://45-12-239-5.sslip.io/pyn.exe')
  ON CONFLICT(app_scope) DO UPDATE SET
    current_version=excluded.current_version,
    update_url=excluded.update_url;
"
```

**Note**: row `desktop-win` уже используется OTLHelper2. Если Pyn — отдельный
продукт, поменяй scope на `desktop-pyn-win` И в `apps/desktop/src/App.tsx`
строку `scope = 'desktop-win'` тоже на `desktop-pyn-win`. Если Pyn заменяет
OTLHelper2 — оставляй `desktop-win`.

## Безопасные пути на Win (Kaspersky-tolerant)

- **EXE портативный**: юзер сам выбирает (Desktop / Downloads). Стандарт для
  portable.
- **Userdata + cache + logs**: `%LOCALAPPDATA%\@pyn\desktop\` (Electron
  default).
- **Updates download** (наш bridge): `%LOCALAPPDATA%\@pyn\desktop\updates\`.
- **(будущее) VBS-скрипты SAP**: `%LOCALAPPDATA%\@pyn\desktop\macros\`,
  **без UTF-8 BOM** (грабля #35 в `~/Documents/HELPERS/MAP.md`).

**Никогда не пиши `%TEMP%`** для exec'утируемых скриптов — Kaspersky-PDM
триггерится.
