"""Builds dev/mock.js from a CSV shaped like the real Google export, for previewing the UI without the app."""
import csv, io, json, sys
sys.path.insert(0, "app")
import sheet
hdr = json.load(open("/home/claude/v2/games_hdr.json"))
rows = json.load(open("/home/claude/v2/games_data.json"))
de = json.load(open("/home/claude/v2/games_DE.json"))
out = io.StringIO(); w = csv.writer(out)
w.writerow([b or "" for b in hdr[0]] + [""]); w.writerow(hdr[1] + ["Store link"])
for r, (d, e) in zip(rows, de):
    r = list(r)
    r[3] = ("✓  " + d) if d and not str(d).startswith("=") and d != "unknown date" else ("unknown date" if d == "unknown date" else "")
    r[4] = "unknown date" if e == "unknown date" else ""
    r = ["TRUE" if v is True else "FALSE" if v is False else ("" if v is None else str(v).lstrip("'")) for v in r]
    if r[1] == "Completed": r[13] = "1"
    w.writerow(r + [""])
games = sheet.parse_games(list(csv.reader(io.StringIO(out.getvalue()))))
for g in games:
    if g["name"] == "Elden Ring": g["runs"] = 3; g["beaten_on"] = ["Steam"]
    if g["name"].startswith("The Witcher 3"): g["runs"] = 2; g["beaten_on"] = ["Steam", "PS4"]
    if g["name"] == "Baldur's Gate 3": g["status"] = "Playing"; g["play_on"] = "Steam Deck"
    if g["name"] == "Hades": g["play_on"] = "Steam Deck"
    if g["name"] == "Starfield": g["second_chance"] = True
plays_csv = "Game,Run #,Platform,Play on,Modded,With DLC,100% / Plat,✓ Finished,Finished on,Hours,Notes\nThe Witcher 3: Wild Hunt,Run 2,PS4,,FALSE,FALSE,FALSE,TRUE,unknown date,,First run\nElden Ring,Run 2,,,FALSE,FALSE,FALSE,TRUE,✓  2024-03-02,,Replay\n"
plays = sheet.parse_playthroughs(list(csv.reader(io.StringIO(plays_csv))))
print(len(games), sum(g["status"] == "Completed" for g in games), plays[1])
print([ (g["name"], g["completed"], g["score"], g["hours"], g["hours_text"]) for g in games if g["name"] in ("Elden Ring", "Alien: Isolation", "Starfield", "Cyberpunk 2077")])
print(sheet.csv_url("https://docs.google.com/spreadsheets/d/e/2PACX-1abc/pubhtml", "200"))
print(sheet.csv_url("https://docs.google.com/spreadsheets/d/1duTh/edit#gid=0", "0"))
data = {"games": games, "playthroughs": plays, "synced_at": 1764078000}
open("dev/mock.js", "w").write("window.MOCK = " + json.dumps(data) + ";\n" + open("dev/mock_api.js").read())
