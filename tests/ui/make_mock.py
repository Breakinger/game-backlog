"""A stand-in library for the UI tests in CI: the games in app/top100.txt (already public) plus a few extras, given
statuses, platforms, dates and scores by a fixed recipe. Writes dev/mock.js, the same file dev/make_mock.py builds
locally from a real export, so dev/preview.html runs the real app on it."""
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
names = [l.strip() for l in open(os.path.join(ROOT, "app", "top100.txt"), encoding="utf-8") if l.strip()]
extra = ["Elden Ring", "Clair Obscur: Expedition 33", "Legend of Zelda: Breath of the Wild", "Astro Bot", "Pragmata",
         "Hollow Knight", "Stray", "Alan Wake 2", "Warframe", "Halo Master Chief Collection", "Starfield", "Hades"]
for n in extra:
    if n not in names:
        names.append(n)
PLATS = ["Steam", "Steam", "PS5", "Steam", "Switch 2", "PS4", "GOG", "Epic Games", "Steam", "PS2", "Switch", "Steam"]
STATUS = ["Completed", "Completed", "Library", "Playing", "Wishlist", "Completed", "Paused", "Library", "Completed", "Dropped", "Library", "Completed"]
PRIO = ["", "High", "Medium", "", "Low", "Extreme", "", "Medium", "Low", "", "High", ""]
games = []
for i, n in enumerate(names):
    st, pl = STATUS[i % 12], PLATS[(i * 7) % 12]
    done = st == "Completed"
    y = 2015 + i % 12
    games.append({"id": i, "row": i + 3, "name": n, "status": st, "priority": "" if done else PRIO[i % 12],
                  "completed": f"{y}-{1 + i % 12:02d}-{1 + i % 27:02d}" if done else None, "completed_known": done, "completed_raw": "",
                  "dropped": f"{y}-05-01" if st == "Dropped" else None, "second_chance": False, "platform": pl,
                  "play_on": "" if pl in ("PS5", "PS4", "PS2", "Switch", "Switch 2") else ("Steam Deck" if i % 5 == 0 else "PC"),
                  "format": "Physical" if i % 4 == 0 else "Digital", "upgrade": "Paid upgrade" if pl == "PS4" and i % 3 == 0 else "",
                  "upgrade_owned": False, "dlc_owned": i % 6 == 0, "dlc_done": False, "platinum": done and i % 5 == 0, "modded": i % 9 == 0,
                  "runs": 1 if done else 0, "beaten_on": [], "hours": round(5 + (i * 13) % 140, 1) if st != "Wishlist" and st != "Library" else None,
                  "hours_text": "", "score": float(6 + i % 5) if done else None, "genre": ["RPG", "Shooter", "Action-Adventure", "Platformer", "Strategy"][i % 5],
                  "developer": "Studio " + str(i % 9), "publisher": "Publisher " + str(i % 7), "migrate_to": "", "notes": "", "store_link": "",
                  "type": "Live service" if n in ("Warframe",) else ""})
    games[-1]["hours_text"] = str(games[-1]["hours"] or "")
books = [{"id": i, "row": i + 2, "name": t, "author": a, "series": "", "number": None, "status": s, "priority": "", "finished": "2026-03-14" if s == "Read" else None,
          "format": "Physical", "score": 9.0 if s == "Read" else None, "notes": "", "store_link": ""}
         for i, (t, a, s) in enumerate([("Neuromancer", "William Gibson", "Reading"), ("Fahrenheit 451", "Ray Bradbury", "Read"), ("Dune", "Frank Herbert", "To read")])]
data = {"ranking": [{"rank": i + 1, "game": n} for i, n in enumerate(names[:100])], "games": games,
        "playthroughs": [{"row": 2, "game": "Elden Ring", "run": 2, "platform": "", "play_on": "", "modded": False, "dlc": False, "platinum": False,
                          "finished": True, "finished_on": "2024-03-02", "hours": None, "notes": "Replay"}],
        "books": books, "can_edit": True, "synced_at": 1764078000,
        "games_options": {"status": ["Library", "Playing", "Paused", "Wishlist", "Completed", "Dropped"], "priority": ["Extreme", "High", "Medium", "Low"],
                          "platform": ["Steam", "PS5", "Switch 2", "GOG", "Epic Games", "Ubisoft Connect", "EA App", "Emulation", "PS4", "PS2", "PC (Other)", "Switch"],
                          "play_on": ["PC", "Steam Deck"], "format": ["Digital", "Physical"], "upgrade": ["Free upgrade", "Paid upgrade", "No upgrade"]},
        "books_options": {}, "playthroughs_options": {}}
api = open(os.path.join(ROOT, "dev", "mock_api.js"), encoding="utf-8").read()
open(os.path.join(ROOT, "dev", "mock.js"), "w", encoding="utf-8").write("window.MOCK = " + json.dumps(data) + ";\n" + api)
print(len(games), "games")
