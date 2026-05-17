# Pyn build assets

`electron-builder` ожидает иконки здесь:

| Файл | Формат | Для | Размер |
|---|---|---|---|
| `icon.icns` | Apple ICNS | macOS `.dmg` / `.app` | контейнер 16–1024 px |
| `icon.ico` | Windows ICO | NSIS installer + EXE | контейнер 16–256 px |
| `icon.png` | PNG (опц.) | Linux / fallback | 512×512 |

Без иконок `electron-builder` использует Electron default. Для production добавить полноценный icon set.

## Генерация из 1024×1024 PNG (Mac)

```sh
# .icns
mkdir icon.iconset
sips -z 16 16     icon-1024.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon-1024.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon-1024.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon-1024.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon-1024.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon-1024.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon-1024.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon-1024.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon-1024.png --out icon.iconset/icon_512x512.png
cp icon-1024.png  icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns

# .ico (через ImageMagick)
convert icon-1024.png -define icon:auto-resize=16,24,32,48,64,128,256 icon.ico
```
