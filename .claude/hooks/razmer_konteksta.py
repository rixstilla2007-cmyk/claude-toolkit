# Хук UserPromptSubmit: модель не видит строку состояния и не знает, сколько занято контекста,
# поэтому правило «выше ~180k — скилл peredacha» из CLAUDE.md само не срабатывало (нашёл prompt-audit
# 28.09.2026). Хук берёт размер по последнему ответу в журнале сессии и, перевалив порог, один раз
# напоминает (второй раз — за 250k). После сжатия контекст падает, и напоминания начинаются заново.
# Ещё он замечает перерыв больше часа: кэш истёк, и запрос заново записывает весь контекст по
# двойной цене (за неделю до 27.09 — 22 раза, ~$43 по ценам API). Об этом тоже одна строка.
# Любая ошибка — молча выходим: хук не должен мешать работе.
import datetime
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
POROGI = (180000, 250000)
PERERYV = 3600      # столько живёт кэш на этом плане
PERERYV_OT = 60000  # на маленьком контексте перерыв почти ничего не стоит
STATE = os.path.join(os.path.expanduser("~"), ".claude", "state", "kontekst-napominaniya.json")


def vremya(s):
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def razmer(put):
    """Размер контекста и время последнего ответа модели (unix-время или None).
    Сразу после сжатия новых ответов ещё нет, а последний ответ в журнале — от старого,
    большого контекста (сохранённые сообщения могут идти и после отметки сжатия). Поэтому
    ответ старше последней отметки compact_boundary не считаем: размер — её postTokens."""
    with open(put, "rb") as f:
        f.seek(0, 2)
        f.seek(max(0, f.tell() - 600000))
        hvost = f.read().decode("utf-8", "ignore").splitlines()
    granica = None
    otvet = None
    for stroka in reversed(hvost):
        if granica is None and '"compact_boundary"' in stroka:
            try:
                z = json.loads(stroka)
                if z.get("type") == "system" and z.get("subtype") == "compact_boundary":
                    granica = z
            except Exception:
                pass
        if otvet is None and '"usage"' in stroka and '"assistant"' in stroka:
            try:
                z = json.loads(stroka)
                if z.get("type") == "assistant" and z["message"]["usage"]:
                    otvet = z
            except Exception:
                pass
        if granica is not None and otvet is not None:
            break
    if granica is not None and (otvet is None or (vremya(otvet.get("timestamp")) or 0) < (vremya(granica.get("timestamp")) or 0)):
        return (granica.get("compactMetadata") or {}).get("postTokens") or 0, None
    if otvet is None:
        return 0, None
    u = otvet["message"]["usage"]
    return (u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0),
            vremya(otvet.get("timestamp")))


def main():
    vhod = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
    try:
        k, ts = razmer(vhod.get("transcript_path") or "")
    except Exception:
        k, ts = 0, None  # на первом промпте журнала сессии ещё нет
    soobshcheniya = []
    if ts and k >= PERERYV_OT and datetime.datetime.now().timestamp() - ts > PERERYV:
        chasy = (datetime.datetime.now().timestamp() - ts) / 3600
        soobshcheniya.append(
            "[Перерыв %.1f ч] Кэш истёк: этот запрос заново записал весь контекст (~%dk токенов) по двойной цене. "
            "Если впереди больше пары ходов или тема новая — первой строкой предложи скилл peredacha или /clear, "
            "пока не записали ещё раз. Одной строкой." % (chasy, k // 1000))
    sid = vhod.get("session_id") or "?"
    try:
        with open(STATE, encoding="utf-8") as f:
            vse = json.load(f)
    except Exception:
        vse = {}
    byl = vse.get(sid) or {"porog": 0, "k": 0}
    if k < byl["k"] / 2:
        byl = {"porog": 0, "k": 0}  # было сжатие — считаем заново
    porog = max([p for p in POROGI if k >= p] or [0])
    if porog > byl["porog"]:
        soobshcheniya.append(
              "[Размер контекста] Контекст этой сессии уже ~%dk токенов, каждый запрос перечитывает его целиком. "
              "Если задача не закончится за пару ходов — предложи пользователю скилл peredacha "
              "(«00 ПЕРЕДАЧА.md», потом /clear); если тема сменилась — /clear. Одной строкой, без лекций." % (k // 1000))
        byl["porog"] = porog
    if soobshcheniya:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit",
                                                 "additionalContext": "\n".join(soobshcheniya)}}, ensure_ascii=False))
    byl["k"] = k
    vse[sid] = byl
    if len(vse) > 200:  # старые сессии не копим
        vse = dict(list(vse.items())[-100:])
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(vse, f)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
