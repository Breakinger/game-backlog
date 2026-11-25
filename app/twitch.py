"""Live Twitch streams for a game, using the same free Twitch developer app as IGDB (no extra setup)."""
import json
import time
import urllib.parse
import urllib.request

from art import same_title, _norm


class Twitch:
    def __init__(self, igdb):
        self.igdb = igdb          # shares its Twitch client ID, secret and app token
        self.games = {}           # name -> (time, twitch game id or None)

    def configured(self):
        return self.igdb.configured()

    def _get(self, path):
        c = self.igdb.vault.get("igdb") or {}
        req = urllib.request.Request("https://api.twitch.tv/helix/" + path,
                                     headers={"Client-ID": c["id"], "Authorization": f"Bearer {self.igdb._token()}"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)

    def game_id(self, name):
        hit = self.games.get(name)
        if hit and time.time() - hit[0] < 7 * 86400:
            return hit[1]
        gid = None
        data = (self._get("games?name=" + urllib.parse.quote(name)).get("data") or [])
        if not data:
            data = [d for d in (self._get("search/categories?first=10&query=" + urllib.parse.quote(name)).get("data") or [])
                    if same_title(name, d.get("name", ""), 0.85)]
        if data:
            exact = [d for d in data if _norm(d.get("name", "")) == _norm(name)]
            gid = (exact or data)[0]["id"]
        self.games[name] = (time.time(), gid)
        return gid

    def streams(self, name, limit=12):
        if not self.configured():
            return {"needs_setup": True, "items": []}
        gid = self.game_id(name)
        if not gid:
            return {"items": []}
        data = self._get(f"streams?first={limit}&game_id={gid}").get("data") or []
        return {"items": [{"login": s.get("user_login"), "name": s.get("user_name"), "title": s.get("title"),
                           "viewers": s.get("viewer_count"), "lang": s.get("language"),
                           "thumb": (s.get("thumbnail_url") or "").replace("{width}", "440").replace("{height}", "248")}
                          for s in data]}
