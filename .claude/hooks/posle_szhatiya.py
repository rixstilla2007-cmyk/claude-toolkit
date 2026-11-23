# Хук SessionStart с matcher compact: после сжатия контекста возвращает в разговор то, что
# сводка теряет чаще всего, — какие файлы в этой сессии правились и создавались.
# Чтобы вернуть контекст после
# сжатия, нужен SessionStart с matcher compact, а не PostCompact — только его вывод попадает в разговор.
# Любая ошибка — молча выходим: хук не должен мешать работе.
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
PRAVKI = ("Edit", "Write", "NotebookEdit")


def pravlenye_faily(put):
    """Файлы из вызовов Edit/Write в журнале сессии, по порядку последней правки."""
    faily = []
    with open(put, "rb") as f:
        f.seek(0, 2)
        f.seek(max(0, f.tell() - 3000000))
        hvost = f.read().decode("utf-8", "ignore").splitlines()
    for stroka in hvost:
        if '"tool_use"' not in stroka:
            continue
        try:
            zapis = json.loads(stroka)
        except Exception:
            continue
        for blok in (zapis.get("message") or {}).get("content") or []:
            if not isinstance(blok, dict) or blok.get("type") != "tool_use" or blok.get("name") not in PRAVKI:
                continue
            vhod = blok.get("input") or {}
            p = vhod.get("file_path") or vhod.get("notebook_path")
            if p:
                if p in faily:
                    faily.remove(p)
                faily.append(p)
    return faily


def main():
    vhod = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
    if vhod.get("agent_type"):
        return  # в субагентах не нужно
    stroki = ["[После сжатия контекста]"]
    try:
        faily = pravlenye_faily(vhod.get("transcript_path") or "")
    except Exception:
        faily = []
    if faily:
        stroki.append("Файлы, которые в этой сессии правились или создавались (последние внизу):")
        stroki += ["- " + p for p in faily[-15:]]
        stroki.append("Их содержимого в сводке нет: перед новой правкой перечитай нужный кусок.")
    cwd = vhod.get("cwd") or ""
    if cwd and os.path.exists(os.path.join(cwd, "00 ПЕРЕДАЧА.md")):
        stroki.append("В рабочей папке есть «00 ПЕРЕДАЧА.md» — там план и состояние задачи.")
    stroki.append("Кэш после сжатия всё равно пишется заново. Если оставшаяся работа заметно проще или сложнее "
                  "начатой, сейчас дешёвый момент одной строкой предложить пользователю другую модель или effort.")
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart",
                                             "additionalContext": "\n".join(stroki)}}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
