# Game Backlog

A console-style desktop library for my game backlog. It reads the Google Sheet, shows every game as a PS2-style case, and slides the disc out when you hover.

## Get it

Download **GameBacklog.exe** from the latest [release](../../releases). No install. Windows may warn that the app isn't signed: click **More info → Run anyway**.

## First run

1. In the Google Sheet: **File → Share → Publish to web → Entire document → Comma-separated values (.csv) → Publish**. Copy the link.
2. In the app, open **Settings** (gear, top right) and paste the link.
3. Optional, for better covers: make a free key at [steamgriddb.com/profile/preferences/api](https://www.steamgriddb.com/profile/preferences/api) and paste it into Settings. Without one, covers come from Steam where it can find them.

The key and settings are stored only on this PC, in `%APPDATA%\GameBacklog`.

## How it stays up to date

The sheet is the source of truth. The app re-reads it every few minutes (Settings → refresh interval) and whenever you come back to the window. Completion and drop dates are stamped by the sheet itself, so the app just shows them.

## Controls

- Arrow keys or a gamepad move around, Enter opens a game, Esc closes.
- Q / E (or LB / RB) switch tabs.
- Each game's panel has links to open it in the library of the platform you own it on (Steam, Heroic for Epic/GOG, Ubisoft Connect), or the store page if it's on your wishlist. A **Store link** column in the sheet overrides the link for any game.

## Build it yourself

```
pip install -r requirements.txt
pyinstaller --noconfirm --onefile --windowed --name GameBacklog --icon assets/icon.ico --add-data "app/ui;ui" --paths app app/main.py
```

Every push to `main` builds the exe on GitHub Actions and publishes a release.
