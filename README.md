# RouteRich Panel

Веб-панель управления роутером OpenWrt в стиле Routerich: перезагрузка, AmneziaWG (awg10), Zapret Manager, исправление Opera-Proxy.

**Репозиторий:** [github.com/NanoRexic/routerich-panel](https://github.com/NanoRexic/routerich-panel)

## Установка на OpenWrt (SSH / терминал)

Одна команда на роутере:

```sh
wget -O - https://github.com/NanoRexic/routerich-panel/raw/refs/heads/main/install.sh | sh
```

Другой порт:

```sh
PANEL_PORT=2021 wget -O - https://github.com/NanoRexic/routerich-panel/raw/refs/heads/main/install.sh | sh
```

Удаление:

```sh
wget -O - https://github.com/NanoRexic/routerich-panel/raw/refs/heads/main/uninstall.sh | sh
```

Используйте URL вида `github.com/.../raw/...`, а не `raw.githubusercontent.com` — на роутерах с подменой hosts в Zapret последний может отдавать устаревшие файлы.

Панель открывается на порту **2020** (запасные: 2021, 8080, 8888). Порты 80 и 443 не занимаются.

После обновления обновите страницу в браузере (**Ctrl+F5**) для сброса кэша Service Worker.

### Доступ к GitHub с роутера

Если GitHub недоступен, добавьте записи в `/etc/hosts` (как в Zapret Manager) или установите панель с Windows (см. ниже).

## Установка с Windows

1. Скачайте **RouteRich-Windows.zip** из [Releases](https://github.com/NanoRexic/routerich-panel/releases) (или используйте папку `windows/` из репозитория).
2. Запустите `1-Install-Prerequisites.bat` (один раз на ПК).
3. Запустите `2-Install-Panel.bat`.

Установщик подключается по SSH и запускает `install.sh` на роутере. Если роутер не может скачать файлы с GitHub, установщик автоматически скачает их на ПК и загрузит по SSH.

Параметры (передаются в `2-Install-Panel.bat` или `install.py`):

| Параметр | Описание |
|----------|----------|
| `--host IP` | IP роутера (по умолчанию: автоопределение шлюза) |
| `--empty-password` | Пустой пароль SSH |
| `--password PASS` | Пароль SSH в командной строке |
| `--local-upload` | Принудительно скачать на ПК и загрузить по SSH |
| `--test-ssh` | Только проверка SSH |

Удаление: `3-Uninstall-Panel.bat`

## Требования

- OpenWrt с `uhttpd`
- `wget` или `curl` на роутере (для установки с GitHub)
- `jq` (устанавливается автоматически при настройке, если возможно)