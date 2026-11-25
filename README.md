# Masterlog

A console-style desktop library for my game backlog. It reads the Google Sheet, shows every game as a PS2-style case, and slides the disc out when you hover.

## Get it

Download **Masterlog.exe** from the latest [release](../../releases). No install. Windows may warn that the app isn't signed: click **More info → Run anyway**.

## First run: connect your sheet

The app reads and edits your Google Sheet through a small script that lives inside the sheet. Your sheet stays private: nothing is published, and the app pairs with the script once and keeps a secret key on your PC.

1. In the Google Sheet, open **Extensions → Apps Script**.
2. Replace what's in the editor with the contents of [`app/ui/connect.gs`](app/ui/connect.gs) (the app's Settings has a **Copy the script** button) and press **Save**.
3. **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then **Deploy** and authorize. If Google says the app isn't verified, choose **Advanced → Go to (unsafe)**; it's your own script.
4. Copy the **Web app** link and paste it into the app's **Settings → Sheet connection**.

To disconnect the app, run `resetConnection` in the Apps Script editor.

Optional, for better covers: make a free key at [steamgriddb.com/profile/preferences/api](https://www.steamgriddb.com/profile/preferences/api) and paste it into Settings.

Settings and the cover cache live only on this PC, in `%APPDATA%\Masterlog`. Linked-account keys are stored there too, encrypted with Windows DPAPI so only your Windows account on this PC can read them.

## Updating

When a new version is out, an **Update** button appears in the top bar. Click it and the app downloads the new version, swaps itself and restarts.

## What it shows

- Games and Books catalogs (switch at the top left).
- Covers or a sheet-style list (toggle in the toolbar). In the list, hovering a row fades the cover in.
- For each game: Metacritic critic and user scores, the score on your platform, Steam and PlayStation Store ratings, DLC with their own scores, Wikipedia, news, and a "Newly updated!" flag when the game got a patch in the last 14 days.
- PS4 discs and Switch 1 games show whether the upgrade to PS5 or Switch 2 is free or paid.
- Epic and GOG games are grouped as Heroic in the library and launch through Heroic.

## Controls

- Arrow keys or a gamepad move around, Enter opens a game, Esc closes.
- Q / E (or LB / RB) switch tabs.
- Each game's panel has links to open it in the library of the platform you own it on (Steam, Heroic for Epic/GOG, Ubisoft Connect), or the store page if it's on your wishlist. A **Store link** column in the sheet overrides the link for any game.

## Build it yourself

```
pip install -r requirements.txt
pyinstaller --noconfirm --onefile --windowed --name Masterlog --icon assets/icon.ico --add-data "app/ui;ui" --paths app app/main.py
```

Every push to `main` builds the exe on GitHub Actions and publishes a release.
