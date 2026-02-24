# NocLauncher v1.0.6

<p align="center">
  <img src="assets/icon.png" alt="NocLauncher" width="120" />
</p>

<p align="center">
  <b>Кастомный Minecraft Launcher (Java + Bedrock)</b><br>
  <i>Быстрый запуск, удобный UI, диагностика и инструменты для Bedrock.</i>
</p>

<p align="center">
  <a href="https://github.com/NocCorporation/NocLauncher/releases/latest">
    <img alt="Latest Release" src="https://img.shields.io/github/v/release/NocCorporation/NocLauncher?style=flat-square" />
  </a>
  <a href="https://github.com/NocCorporation/NocLauncher/releases">
    <img alt="Downloads" src="https://img.shields.io/github/downloads/NocCorporation/NocLauncher/total?style=flat-square" />
  </a>
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows-4caf50?style=flat-square" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" />
</p>

---

## ✨ Актуальные возможности

- Java + Bedrock в одном лаунчере
- Профили Java: Vanilla / Forge / OptiFine
- Offline-first режим
- Библиотека модов/ресурсов/шейдеров
- Bedrock Hub (mini dock) с быстрыми переключателями
- Внешний FPS-монитор NocFpsCounter (ручной запуск)
- Доп. настройки Bedrock (presets + options.txt)
- MS Fix / Xbox Fixer / Deep Fix
- Проверка и диагностика запуска
- Эксперименты и утилиты

---

## 🆕 Что нового в v1.0.6

- Обновлён общий UI/визуал лаунчера
- Обновлена иконка приложения и иконка Windows-файла (`.ico`)
- Доработаны кнопки выбора Java / Bedrock
- Если Bedrock не установлен — лаунчер сразу открывает Microsoft Store
- Убраны лишние repair/replacement операции, когда Bedrock отсутствует
- Улучшена стабильность запуска и предпролётных проверок

---

## 📦 Скачать

Текущий релиз: **v1.0.6**

- Windows x64: `NocLauncher Setup 1.0.6.exe`

Все файлы:
<https://github.com/NocCorporation/NocLauncher/releases>

---

## 🛡 Windows Defender / SmartScreen (важно)

Иногда Windows может показывать предупреждение при запуске сборки.
Обычно это связано с тем, что приложение не подписано коммерческим code-sign сертификатом,
а не обязательно с наличием вируса.

Рекомендуется:

1. Скачивать только из официального GitHub Releases.
2. Проверять SHA256 из релиза (`SHA256SUMS-v1.0.6.txt`).
3. При желании дополнительно проверять файл в VirusTotal.

---

## 🔐 Проверка хэша

```powershell
Get-FileHash .\NocLauncher Setup 1.0.6.exe -Algorithm SHA256
```

---

## 📄 Лицензия

MIT (`LICENSE`)
