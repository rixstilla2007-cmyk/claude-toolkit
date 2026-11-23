# Хук PreToolUse для Bash и PowerShell: блокирует удаление файлов вне временных папок.
# Правило пользователя (CLAUDE.md): ничего не удалять без разрешения,
# и даже с разрешением не удалять физически, а переносить в подпапку _Удалить.
# Код выхода 2 отменяет вызов инструмента, текст из stderr получает Claude.
import json
import os
import re
import sys

# иначе на Windows текст уходит в cp1251 и Claude получает кракозябры
sys.stderr.reconfigure(encoding="utf-8")

try:
    # Вход в UTF-8. json.load(sys.stdin) читал его в cp1251: русские пути искажались, и проверка
    # «рабочих папок» (например, Рабочий стол) не срабатывала — найдено тестом 28.09.2026.
    data = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace") or "{}")
except Exception:
    sys.exit(0)  # не смогли прочитать — не мешаем работе

cmd = ((data.get("tool_input") or {}).get("command") or "")
if not cmd:
    sys.exit(0)

# Текст сообщения коммита не проверяем: «fix: del button» — не удаление.
proverka = re.sub(r"(\s-m|--message)(\s+|=)(\"[^\"]*\"|'[^']*')", " ", cmd)

# git -C <папка> и git -c ключ=значение перед подкомандой: «git -C C:/work clean -fd»
# проходил мимо старого «git\s+clean» (нашёл аудит GPT 29.09.2026).
GIT = r"git\s+(?:(?:-[cC]\s+(?:\"[^\"]*\"|'[^']*'|\S+)|--[\w.-]+(?:=\S+)?)\s+)*"

# Перед командой может стоять кавычка или скобка: bash -c "rm ...", powershell -Command "Remove-Item ...",
# ForEach-Object {Remove-Item $_}. Проверено тестами 28.09.2026 — без этого они проходили.
UDALENIE = re.compile(
    r"(^|[\s;&|(`\"'{])("
    # rd — и cmd (rd /s), и алиас Remove-Item в PowerShell (rd папка -Recurse); unlink и shred — из Git Bash.
    # До 10.11.2026 ловился только «rd /s», а unlink, shred, Path.rmdir(), git stash drop и git branch -D
    # проходили (найдено пробой 10.11.2026).
    r"rm(\s|$)|rmdir\b|rd\s|del\s|erase\s|unlink\s|shred\s|"
    r"remove-item\b|ri\s|clear-recyclebin\b|"
    r"\[(system\.)?io\.(file|directory)\]::delete|"
    r"os\.remove\(|os\.unlink\(|shutil\.rmtree\(|\.unlink\(|os\.rmdir\(|"
    r"fs\.(rm|rmsync|unlinksync|rmdirsync)\(|"
    # find -delete, git clean, git reset --hard и откат правок: теряются файлы или незакоммиченная работа
    r"find\s[^;&|]*\s-delete\b|" + GIT + r"clean\b|" + GIT + r"reset\s+[^;&|]*--hard\b|"
    r"" + GIT + r"checkout\s+(\S+\s+)?--\s|" + GIT + r"restore\s+(?!--staged\s)|"
    # git stash drop/clear и git branch -D (именно заглавная: -d удаляет только слитую ветку) — потеря работы
    r"" + GIT + r"stash\s+(drop|clear)\b|" + GIT + r"branch\s+[^;&|]*(?-i:-D)\b|"
    # robocopy /MIR и /PURGE стирают в папке назначения всё, чего нет в источнике
    r"robocopy\s[^;&|]*\s/(mir|purge)\b"
    # без оглядки на символ перед точкой: require('fs').unlinkSync( и Path(x).unlink( проходили (тест 01.11.2026)
    r")|\.(unlink|unlinksync|rmsync|rmdirsync|rmdir)\(",
    re.IGNORECASE,
)
if not UDALENIE.search(proverka):
    sys.exit(0)

# --- Исключение для временных папок ---
# Раньше хватало, чтобы метка Temp встречалась где угодно в команде: «rm C:/work/a.txt; echo %TEMP%»
# проходило (аудит GPT 29.09.2026). Теперь цепочка режется на отдельные команды, и КАЖДАЯ команда
# с удалением должна смотреть только во временные места: все её аргументы — пути в Temp, ключи
# (-rf, -Recurse, /s) или служебные слова. Переменная ($f, $_), относительный путь, «..» — блок.
# Путь должен НАЧИНАТЬСЯ с папки Temp (после неё — ещё хоть что-то): подстрока «%temp%» или
# «appdata/local/temp» в середине чужого пути (Pictures/x%temp%.jpg) Temp не делает (аудит GPT 29.09.2026).
TEMP_NACHALO = ("~/appdata/local/temp",
                "$home/appdata/local/temp", "$env:userprofile/appdata/local/temp", "$env:localappdata/temp",
                "%localappdata%/temp", "%userprofile%/appdata/local/temp", "$env:temp", "$env:tmp", "${env:temp}",
                "%temp%", "%tmp%", "c:/windows/temp", "/tmp")
# Полные пути берём из окружения получателя; добавляем также форму Git Bash.
for put in (os.environ.get("TEMP"), os.environ.get("TMP"),
            os.path.join(os.environ["LOCALAPPDATA"], "Temp") if os.environ.get("LOCALAPPDATA") else None):
    if put:
        put = put.lower().replace("\\", "/").rstrip("/")
        TEMP_NACHALO += (put,)
        if re.match(r"^[a-z]:/", put):
            TEMP_NACHALO += ("/" + put[0] + put[2:],)
TEMP_NACHALO = tuple(dict.fromkeys(TEMP_NACHALO))
TEMP_METKI = ("/_kesh/",)
RABOCHIE = ("desktop", "рабочий стол", "onedrive", "documents", "downloads",
            "/.claude/projects", "/.claude/skills", "/.claude/settings")
SLUZHEBNYE = {
    "rm", "rmdir", "rd", "del", "erase", "unlink", "shred", "remove-item", "ri", "find", "sudo", "cmd", "bash", "sh",
    "powershell", "pwsh", "silentlycontinue", "stop", "continue", "ignore", "$true", "$false", "$null",
    "nul", "/dev/null", "true", "false", "&", "@",
}
VYZOV_UDALENIYA = re.compile(
    r"(os\.remove|os\.unlink|os\.rmdir|shutil\.rmtree|fs\.(rm|rmsync|unlinksync|rmdirsync)|"
    r"\[?(system\.)?io\.(file|directory)\]?::delete)(\((r|f|rb)?)?"
)


def vremennyi_put(t):
    if any(r in t for r in RABOCHIE):
        return False
    return any(t.startswith(p + "/") and len(t) > len(p) + 1 for p in TEMP_NACHALO) or any(m in t for m in TEMP_METKI)


def argument_bezopasen(t):
    t = t.strip("(){}[],;")
    if not t or t in SLUZHEBNYE or t.startswith("-"):
        return True
    if re.fullmatch(r"/[a-z?]{1,2}", t):          # ключи cmd: /s /q /f
        return True
    if re.match(r"\d?>>?", t) or t == "2>&1":     # перенаправления вывода
        return True
    if VYZOV_UDALENIYA.fullmatch(t):
        return True
    return vremennyi_put(t)


def tolko_vremennoe(segment):
    s = segment.lower().replace("\\", "/")
    if ".." in s:
        return False
    tokeny = [t for t in re.split(r"[\s\"'`]+", s) if t]
    return any(vremennyi_put(t.strip("(){}[],;")) for t in tokeny) and all(argument_bezopasen(t) for t in tokeny)


segmenty = [seg for seg in re.split(r"\r?\n|;|&&|\|\||\||&", proverka) if UDALENIE.search(seg)]
# Удаление, склеенное с соседней командой без разделителя, в сегментах не найдётся — тогда блок.
if segmenty and all(tolko_vremennoe(seg) for seg in segmenty):
    sys.exit(0)

sys.stderr.write(
    "Удаление заблокировано хуком no_delete.py. Правило пользователя: файлы и папки не удалять без явного "
    "разрешения, а с разрешением — не удалять физически, а переносить в подпапку _Удалить рядом с исходным "
    "местом (Move-Item / mv), сохранив имя. Спроси пользователя, что именно и зачем удаляется. "
    "git clean, git reset --hard, git checkout --, git restore, git stash drop/clear и git branch -D тоже "
    "блокируются: они стирают незакоммиченные правки или несохранённые коммиты — сначала git stash или копия "
    "в _Архив, и только с согласия пользователя. "
    "Временные файлы удалять можно: в самой команде удаления укажи полный путь в Temp ($env:TEMP, %TEMP%, "
    "AppData/Local/Temp, /tmp) — без переменных вроде $f и без «..». "
    "Если это не команда, а текст с такими словами (заметка, heredoc, echo) — запиши его через Write/Edit.\n"
)
sys.exit(2)
