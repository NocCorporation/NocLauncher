# NocLauncher

<p align="center">
  <img src="assets/icon.png" alt="NocLauncher" width="120" />
</p>

<p align="center">
  <b>Кастомный Minecraft Launcher (Java + Bedrock)</b><br>
  <i>Стабильный оффлайн-first UX, библиотека модов и встроенная диагностика</i>
</p>

<p align="center">
  <a href="https://github.com/NocCorporation/NocLauncher/releases/latest">
    <img alt="Latest Release" src="https://img.shields.io/github/v/release/NocCorporation/NocLauncher?style=flat-square" />
  </a>
  <a href="https://github.com/NocCorporation/NocLauncher/releases">
    <img alt="Downloads" src="https://img.shields.io/github/downloads/NocCorporation/NocLauncher/total?style=flat-square" />
  </a>
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-4caf50?style=flat-square" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" />
</p>

---

## ✨ Возможности

- **Java + Bedrock** в одном лаунчере
- Профили Java: **Vanilla / Forge / OptiFine**
- **Offline-first** режим (онлайн-auth отключён намеренно)
- Библиотека: моды / resourcepacks / shaderpacks
- Оффлайн-скины: файл / ник / URL
- Автодобавление серверов в `servers.dat`
- Логи, диагностика и проверка запуска
- FPS/JVM настройки и low-power режим UI

---

## 📦 Скачать

**Текущий релиз:** `v1.0.4`

- Windows x64: `NocLauncher-1.0.4-windows-x64.exe`
- Windows x86: `NocLauncher-1.0.4-windows-x86.exe`
- Linux x64: `NocLauncher-1.0.4-linux-x64.AppImage`
- macOS x64: `NocLauncher-1.0.4-macos-x64.dmg` / `.zip`

👉 Все файлы доступны в **GitHub Releases → Assets**:
<https://github.com/NocCorporation/NocLauncher/releases>

### 🔐 Проверка подлинности

В каждом релизе публикуются `SHA256SUMS-*.txt`.

PowerShell-проверка:

```powershell
Get-FileHash .\NocLauncher-1.0.4-windows-x64.exe -Algorithm SHA256
```

Сверьте результат с хэшами из релиза.

---

## 🚀 Быстрый старт

1. Скачайте сборку под вашу ОС из Releases.
2. Запустите NocLauncher.
3. Выберите режим: **JAVA** или **BEDROCK**.
4. Для JAVA выберите версию и профиль (Vanilla/Forge/OptiFine).
5. Укажите ник и нажмите **Играть**.

---

## 🧭 Документация

- `docs/GUIDE_RU.md` — полный гайд
- `docs/QUICK_TUTORIALS_RU.md` — быстрые сценарии
- `docs/INSTALL_RU.md` — установка по платформам
- `docs/USER_MANUAL_RU.md` — эксплуатация и настройки
- `docs/FEATURES_RU.md` — функции лаунчера
- `docs/TROUBLESHOOTING_RU.md` — решение частых проблем
- `docs/FAQ_RU.md` — краткие ответы
- `docs/ROADMAP_RU.md` — roadmap
- `docs/TRUST_AND_SECURITY_RU.md` — снижение ложных AV/SmartScreen срабатываний
- `docs/RELEASE_TEMPLATE_RU.md` — шаблон официального оформления релиза

---

## 🛠 Сборка из исходников

```bash
npm install
npm run build:win
npm run build:linux
npm run build:mac
```

Результат сборки: `dist/`

---

## ⚠️ Важно

- Проект ориентирован на стабильный **offline-first UX**.
- Для баг-репорта прикладывайте: **лог + шаги + версию игры**.

---

## 📄 Лицензия

MIT (`LICENSE`)

---

## ⭐ Star History

<a href="https://www.star-history.com/#NocCorporation/NocLauncher&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=NocCorporation/NocLauncher&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=NocCorporation/NocLauncher&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=NocCorporation/NocLauncher&type=date&legend=top-left" />
  </picture>
</a>
