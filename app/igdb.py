"""IGDB (run by Twitch): covers, screenshots, trailers and official summaries, including console exclusives.
Needs a free Twitch developer app; the client secret lives in the encrypted vault."""
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from art import similar, same_title, _norm

IMG = "https://images.igdb.com/igdb/image/upload/{size}/{id}.jpg"


class IGDB:
    def __init__(self, vault):
        self.vault = vault
        self.lock = threading.Lock()
        self.cache = {}

    def configured(self):
        c = self.vault.get("igdb") or {}
        return bool(c.get("id") and c.get("secret"))

    def set_credentials(self, client_id, secret):
        self.vault.set("igdb", {"id": client_id.strip(), "secret": secret.strip()})
        self.vault.set("igdb_token", None)
        self._token()  # fails loudly if wrong
        return True

    def _token(self):
        tok = self.vault.get("igdb_token") or {}
        if tok.get("token") and time.time() < tok.get("until", 0):
            return tok["token"]
        c = self.vault.get("igdb") or {}
        q = urllib.parse.urlencode({"client_id": c["id"], "client_secret": c["secret"], "grant_type": "client_credentials"})
        req = urllib.request.Request(f"https://id.twitch.tv/oauth2/token?{q}", data=b"", method="POST")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                out = json.load(r)
        except urllib.error.HTTPError:
            raise ValueError("Twitch didn't accept that Client ID and secret.")
        tok = {"token": out["access_token"], "until": time.time() + int(out.get("expires_in", 3600)) - 300}
        self.vault.set("igdb_token", tok)
        return tok["token"]

    def _query(self, endpoint, body):
        c = self.vault.get("igdb") or {}
        req = urllib.request.Request(f"https://api.igdb.com/v4/{endpoint}", data=body.encode(), method="POST",
                                     headers={"Client-ID": c["id"], "Authorization": f"Bearer {self._token()}",
                                              "Accept": "application/json", "Content-Type": "text/plain"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)

    def game(self, name):
        if not self.configured():
            return None
        key = name.lower().strip()
        if key in self.cache:
            return self.cache[key]
        safe = name.replace('"', "")
        rows = self._query("games", f'search "{safe}"; fields name,summary,storyline,first_release_date,cover.image_id,'
                                    f'screenshots.image_id,artworks.image_id,videos.video_id,videos.name,platforms.abbreviation,'
                                    f'involved_companies.company.name,involved_companies.developer; limit 8;')
        # the same game only: never the sequel or the original ('Red Dead Redemption 2' vs 'Red Dead Redemption')
        rows = [r for r in rows or [] if same_title(name, r.get("name", ""), 0.8)]
        best = max(rows, key=lambda r: (_norm(r.get("name", "")) == _norm(name), similar(name, r.get("name", ""))), default=None)
        self.cache[key] = best
        return best

    def search(self, name, limit=10):
        """Raw search results (names and release dates), used to spot a game's official full title."""
        if not self.configured():
            return []
        safe = name.replace('"', "")
        return self._query("games", f'search "{safe}"; fields name,first_release_date,category,version_parent; limit {limit};')

    @staticmethod
    def img(image_id, size="t_1080p"):
        return IMG.format(size=size, id=image_id)
