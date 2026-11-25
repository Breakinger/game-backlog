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
hdr2, rows2 = sheet._table(list(csv.reader(io.StringIO(out.getvalue()))))
games = sheet.parse_games(hdr2, rows2)
PS4 = {"Assassin's Creed Origin":"No","Beyond: Two Souls":"No","Bloodborne":"No","Call of Duty: Infinite Warfare":"No","Dark Souls Remastered":"No","Devil May Cry 5":"No","Dying Light 2: Stay Human":"Free","Final Fantasy VII Remake":"Free","Final Fantasy XV":"No","Heavy Rain":"No","Horizon: Forbidden West":"Free","Horizon: Zero Dawn":"Paid","Infamous: Second Son":"No","Killzone Shadow Fall":"No","Kingdom Hearts":"No","Kingdom Hearts 2":"No","Kingdom Hearts 3":"No","Mirror's Edge Catalyst":"No","Persona 5 Strikers":"No","Red Dead Redemption 2":"No","Shadow of the Colossus":"No","Sonic Colors Ultimate":"No","Sonic Frontiers":"Free","Star Wars: Jedi Fallen Order":"Free","The Ascent":"Free","The Last of Us Remastered":"No","Uncharted 4: Theif's End":"Paid"}
for g in games:
    if g["name"] in PS4: g["platform"] = "PS4"; g["play_on"] = ""; g["upgrade"] = PS4[g["name"]] + " upgrade"
    if g["name"].startswith("Legend of Zelda: Breath"): g["platform"] = "Switch"; g["upgrade"] = "Paid upgrade"
for g in games:
    if g["name"] == "Elden Ring": g["runs"] = 3; g["beaten_on"] = ["Steam"]
    if g["name"].startswith("The Witcher 3"): g["runs"] = 2; g["beaten_on"] = ["Steam", "PS4"]
    if g["name"] == "Baldur's Gate 3": g["status"] = "Playing"; g["play_on"] = "Steam Deck"
    if g["name"] == "Hades": g["play_on"] = "Steam Deck"
    if g["name"] == "Starfield": g["second_chance"] = True
    g.setdefault("type", "")
    if g["name"] in ("Mass Effect Legendary Edition",): g["platform"] = "EA"
games += [dict(games[0], id=len(games)+i, row=300+i, name=n, status="Playing", type="Live service", platform="Steam", play_on="PC", completed=None, score=None, hours=None, hours_text="", genre="Shooter") for i, n in enumerate(["Warframe", "Deadlock", "The Finals"])]
games.append(dict(games[0], id=len(games), row=310, name="Skyrim: Lorerim", status="Playing", type="Modded", platform="Steam", play_on="PC", completed=None, score=None))
for g in games:
    if g["name"] in ("Assassin's Creed II", "Watch_Dogs"): g["migrate_to"] = "Steam"
plays_csv = "Game,Run #,Platform,Play on,Modded,With DLC,100% / Plat,✓ Finished,Finished on,Hours,Notes\nThe Witcher 3: Wild Hunt,Run 2,PS4,,FALSE,FALSE,FALSE,TRUE,unknown date,,First run\nElden Ring,Run 2,,,FALSE,FALSE,FALSE,TRUE,✓  2024-03-02,,Replay\n"
ph, pr = sheet._table(list(csv.reader(io.StringIO(plays_csv))))
plays = sheet.parse_playthroughs(ph, pr)
print(len(games), sum(g["status"] == "Completed" for g in games), plays[1])
print([ (g["name"], g["completed"], g["score"], g["hours"], g["hours_text"]) for g in games if g["name"] in ("Elden Ring", "Alien: Isolation", "Starfield", "Cyberpunk 2077")])
print(sheet.csv_url("https://docs.google.com/spreadsheets/d/e/2PACX-1abc/pubhtml", "200"))
print(sheet.csv_url("https://docs.google.com/spreadsheets/d/1duTh/edit#gid=0", "0"))
books_raw = [("Neuromancer","William Gibson","Sprawl",1,"Reading"),("Fahrenheit 451","Ray Bradbury","",None,"Read"),("Nineteen Eighty-Four","George Orwell","",None,"To read"),
 ("The Infernal City","Greg Keyes","The Elder Scrolls",1,"To read"),("Lord of Souls","Greg Keyes","The Elder Scrolls",2,"To read"),
 ("Halo: The Fall of Reach","Eric Nylund","Halo",1,"Read"),("Halo: The Flood","William C. Dietz","Halo",2,"Read"),("Halo: First Strike","Eric Nylund","Halo",3,"To read"),
 ("Halo: Ghosts of Onyx","Eric Nylund","Halo",4,"To read"),("Halo: Contact Harvest","Joseph Staten","Halo",5,"To read"),("Halo: The Cole Protocol","Tobias S. Buckell","Halo",6,"To read"),
 ("Dune","Frank Herbert","Dune",1,"Read"),("Dune Messiah","Frank Herbert","Dune",2,"To read"),("Children of Dune","Frank Herbert","Dune",3,"To read"),
 ("God Emperor of Dune","Frank Herbert","Dune",4,"To read"),("Heretics of Dune","Frank Herbert","Dune",5,"To read"),("Chapterhouse: Dune","Frank Herbert","Dune",6,"To read")]
books = [{"id":i,"row":i+2,"name":t,"author":a,"series":s_,"number":n,"status":st,"priority":"High" if t=="Dune Messiah" else "","finished":"2026-03-14" if st=="Read" else None,"format":"Physical","score":9.0 if st=="Read" else None,"notes":"","store_link":""} for i,(t,a,s_,n,st) in enumerate(books_raw)]
data = {"games": games, "playthroughs": plays, "books": books, "can_edit": True, "synced_at": 1764078000,
        "games_options": {"status":["Library","Playing","Paused","Wishlist","Completed","Dropped"],"priority":["Extreme","High","Medium","Low"],"platform":["Steam","PS5","Switch 2","GOG","Epic Games","Ubisoft Connect","EA App","Emulation","PS4","PS2","PC (Other)","Switch"],"play_on":["PC","Steam Deck"],"format":["Digital","Physical"],"upgrade":["Free upgrade","Paid upgrade","No upgrade"]},
        "books_options": {}, "playthroughs_options": {}}
open("dev/mock.js", "w").write("window.MOCK = " + json.dumps(data) + ";\n" + open("dev/mock_api.js").read())
