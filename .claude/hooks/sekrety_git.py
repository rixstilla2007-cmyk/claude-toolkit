# Хук PreToolUse для Bash и PowerShell: перед git commit и git push ищет секреты в том, что
# уйдёт в репозиторий, — ключи API, токены ботов и входа, приватные ключи. Нашёл — отказ с
# причиной (сам секрет в ответ не пишется). Идея из справочника sfrangulov/claude-code-handbook-ru,
# переписано на Python под Windows и ключи сервисов (Firecrawl, Telegram, Claude, OpenAI, GitHub).
# Смотрит только добавленные строки диффа.
# С 29.09.2026: если это commit/push, а проверить не получилось (не нашёл репозиторий, git упал,
# таймаут) — не пропускает молча, а спрашивает пользователя (permissionDecision "ask").
# С 30.09.2026: «ask» — только в режимах, где запрос видит человек (default, acceptEdits, plan,
# или режим не передан). В bypassPermissions VS Code молча одобряет «ask» (проверено вживую 30.09),
# в auto его может решить классификатор, поэтому в остальных режимах — отказ.
# Команду, где git не в начале (например, grep "git commit"), не трогает.
# С 10.11.2026: хук срабатывает ДО выполнения команды, поэтому в цепочке «git add -A && git commit
# -m x && git push» индекс на момент проверки ещё пуст — она проходила целиком, вместе с push
# (найдено пробой 10.11.2026). Теперь проверяется каждый commit и push в цепочке; если перед commit
# в той же команде стоит git add — смотрим ещё правки рабочего дерева и новые файлы, которых git
# пока не знает; если у commit есть пути или -a — правки рабочего дерева.
import json
import os
import re
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")

SEKRETY = [
    ("ключ Anthropic", r"sk-ant-[A-Za-z0-9_-]{20,}"),
    ("ключ OpenAI", r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}"),
    ("ключ Firecrawl", r"\bfc-[0-9a-f]{32}\b"),
    ("токен GitHub", r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})"),
    ("ключ Google", r"\bAIza[0-9A-Za-z_-]{35}\b"),
    ("токен Telegram-бота", r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b"),
    ("ключ AWS", r"\bAKIA[0-9A-Z]{16}\b"),
    ("приватный ключ", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    ("токен входа", r"\"(?:accessToken|refreshToken)\"\s*:\s*\"[^\"]{20,}\""),
]
# git в позиции команды: начало строки или после ; & | ( — иначе это текст внутри другой команды
GIT = re.compile(r"(?:^|[;&|\n(]\s*)git(?:\.exe)?\s+(?:-C\s+(\"[^\"]+\"|'[^']+'|\S+)\s+)?[^\n;&|]*?\b(commit|push)\b")
CD = re.compile(r"(?:^|[;&|]\s*)(?:cd|Set-Location|pushd|sl)\s+(?:-Path\s+|-LiteralPath\s+)?(\"[^\"]+\"|'[^']+'|[^\s;&|]+)", re.I)
# git add как подкоманда (а не слово «add» в сообщении коммита)
ADD = re.compile(r"(?:^|[;&|\n(]\s*)git(?:\.exe)?\s+(?:-C\s+(?:\"[^\"]+\"|'[^']+'|\S+)\s+)?add\b")
# ключи git commit, после которых идёт значение, а не путь
SO_ZNACHENIEM = {"-m", "-F", "-C", "-c", "-t", "--message", "--file", "--author", "--date", "--template",
                 "--reuse-message", "--reedit-message", "--fixup", "--squash", "--cleanup", "--pathspec-from-file"}


class NeProverit(Exception):
    pass


def put_windows(p):
    p = os.path.expanduser(p.strip("\"'"))
    return re.sub(r"^/([a-zA-Z])(/|$)", r"\1:/", p)  # /c/Users/... из Git Bash -> C:/Users/...


def git(papka, *arg):
    r = subprocess.run(["git", *arg], cwd=papka, capture_output=True, timeout=10)
    if r.returncode != 0:
        return None
    return r.stdout.decode("utf-8", "ignore")


def nayti(diff):
    fail, naydeno = "?", []
    for stroka in diff.splitlines():
        if stroka.startswith("+++ "):
            fail = stroka[6:] if stroka.startswith("+++ b/") else stroka[4:]
        elif stroka.startswith("+"):
            for nazv, shablon in SEKRETY:
                if re.search(shablon, stroka) and (nazv, fail) not in naydeno:
                    naydeno.append((nazv, fail))
    return naydeno


def kommit_vse_ili_puti(hvost):
    """По тому, что стоит после слова commit: есть ли -a/--all и есть ли пути (git commit файл -m x).
    В обоих случаях в коммит уходят правки мимо индекса. Строки в кавычках заменяем на Q, чтобы
    текст сообщения не принять за ключи и пути. Не разобрали — ошибаемся в сторону лишней проверки."""
    hvost = re.sub(r"\"[^\"]*\"|'[^']*'", "Q", hvost)
    tokeny = re.split(r"[;&|\n]", hvost)[0].split()
    vse = po_putyam = False
    i = 0
    while i < len(tokeny):
        t = tokeny[i]
        if t == "--":
            po_putyam = po_putyam or i + 1 < len(tokeny)
            break
        if t in SO_ZNACHENIEM:
            i += 2
            continue
        if t == "--all" or re.fullmatch(r"-[a-zA-Z]*a[a-zA-Z]*", t):
            vse = True
        elif not t.startswith("-") and not re.match(r"\d?[<>]", t):
            po_putyam = True
        i += 1
    return vse, po_putyam


def novye_faily(koren):
    """Файлы, которых git ещё не знает (и которых нет в .gitignore): git add из той же команды добавит
    их уже после этой проверки. Читаем их сами и подаём как добавленные строки диффа."""
    spisok = git(koren, "ls-files", "--others", "--exclude-standard", "-z")
    if spisok is None:
        raise NeProverit("git не отдал список новых файлов")
    imena = [x for x in spisok.split("\0") if x]
    if len(imena) > 1500:
        raise NeProverit("новых файлов %d — похоже, чего-то не хватает в .gitignore" % len(imena))
    kuski, nachalo = [], time.time()
    for imya in imena:
        if time.time() - nachalo > 8:
            raise NeProverit("не успел прочитать новые файлы")
        put = os.path.join(koren, imya)
        try:
            if os.path.getsize(put) > 2000000:
                continue
            with open(put, "rb") as f:
                dannye = f.read()
        except OSError:
            continue
        if b"\0" in dannye[:8000]:
            continue  # двоичный файл
        kuski.append("+++ b/" + imya + "\n" + "\n".join("+" + s for s in dannye.decode("utf-8", "ignore").splitlines()))
    return "\n".join(kuski)


def otvet(reshenie, prichina):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": reshenie,
                                             "permissionDecisionReason": prichina}}, ensure_ascii=False))


def proverit(cmd, m, cwd):
    papka = cwd or os.getcwd()
    cd = [x for x in CD.finditer(cmd) if x.start() < m.start()]
    if cd:
        papka = os.path.join(papka, put_windows(cd[-1].group(1)))
    if m.group(1):
        papka = os.path.join(papka, put_windows(m.group(1)))
    if not os.path.isdir(papka) or git(papka, "rev-parse", "--git-dir") is None:
        raise NeProverit("не нашёл git-репозиторий в папке " + papka)
    if m.group(2) == "commit":
        vse, po_putyam = kommit_vse_ili_puti(cmd[m.end():])
        est_add = any(x.start() < m.start() for x in ADD.finditer(cmd))
        diff = git(papka, "diff", "--cached")
        if diff is not None and (vse or po_putyam or est_add):
            diff += git(papka, "diff", "HEAD") or ""  # в репозитории без коммитов HEAD ещё нет — это не ошибка
        if diff is not None and est_add:
            koren = (git(papka, "rev-parse", "--show-toplevel") or "").strip() or papka
            diff += "\n" + novye_faily(koren)
    else:
        diff = git(papka, "log", "-p", "@{u}..HEAD")
        if diff is None:  # нет upstream — смотрим коммиты, которых нет ни на одном удалённом
            diff = git(papka, "log", "-p", "-20", "HEAD", "--not", "--remotes")
    if diff is None:
        raise NeProverit("git не отдал дифф")
    return nayti(diff)


def main():
    d = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
    cmd = (d.get("tool_input") or {}).get("command") or ""
    sovpadeniya = list(GIT.finditer(cmd))
    if not sovpadeniya:
        return
    m = sovpadeniya[0]
    try:
        naydeno = []
        for m in sovpadeniya:  # в цепочке «commit && push» проверяем оба шага
            naydeno += [x for x in proverit(cmd, m, d.get("cwd")) if x not in naydeno]
    except Exception as e:
        prichina = "Хук sekrety_git.py не смог проверить " + m.group(2) + " на секреты (" + str(e)[:150] + ")."
        rezhim = d.get("permission_mode")
        if rezhim in (None, "", "default", "acceptEdits", "plan"):
            otvet("ask", prichina + " Разреши, если уверен, что ключей и токенов в коммите нет.")
        else:
            otvet("deny", prichina + " В режиме " + str(rezhim) + " запрос разрешения человеку может не показаться, "
                  "поэтому команда заблокирована. Скажи пользователю: пусть выполнит её сам или переключит режим "
                  "на обычный (default) для этой команды.")
        return
    if not naydeno:
        return
    spisok = "; ".join("%s в %s" % x for x in naydeno[:5])
    otvet("deny", "Хук sekrety_git.py: в том, что уйдёт в репозиторий, похоже на секрет — " + spisok +
          ". Убери секрет из файла (ключи держать в переменных окружения или секретах GitHub), для уже сделанного "
          "коммита — git reset --soft HEAD~1 и коммит заново. Если это ложное срабатывание (пример, тестовая строка) — "
          "скажи пользователю и попроси его выполнить команду самому.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
