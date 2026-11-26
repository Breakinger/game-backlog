"""Steam Family: the games other members of your Steam Family share with you.

Valve only shows a family's shared library to a signed-in Steam session, so Masterlog signs in the same way the
Steam store does: you sign in once in a Masterlog window, and the store hands that window a short-lived web token.
The token stays in the encrypted vault on this PC (never in the sheet, never copied to your other PCs), is only
used to read your family's library, and expires on its own within about a day; Masterlog renews it quietly while the
store still remembers your sign-in, and asks again when it doesn't."""
import base64
import json
import os
import time
import urllib.parse
import urllib.request

API = "https://api.steampowered.com"
CONFIG_URL = "https://store.steampowered.com/pointssummary/ajaxgetasyncconfig"
LOGIN_URL = "https://store.steampowered.com/login/?redir=" + urllib.parse.quote("pointssummary/ajaxgetasyncconfig")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"


def _get(url, timeout=25):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def token_from_config(text):
    """The web token in the store's async config, or None when the store isn't signed in."""
    try:
        data = json.loads(text or "{}").get("data") or {}
    except ValueError:
        return None
    tok = data.get("webapi_token") if isinstance(data, dict) else None
    return tok if isinstance(tok, str) and tok.count(".") == 2 else None


def token_expiry(tok):
    try:
        payload = tok.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return int(json.loads(base64.urlsafe_b64decode(payload)).get("exp") or 0)
    except Exception:
        return 0


def token_steamid(tok):
    try:
        payload = tok.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return str(json.loads(base64.urlsafe_b64decode(payload)).get("sub") or "")
    except Exception:
        return ""


class Family:
    def __init__(self, data_dir, vault):
        self.vault = vault
        self.path = os.path.join(data_dir, "family.json")
        try:
            with open(self.path, encoding="utf-8") as f:
                self.data = json.load(f)
        except Exception:
            self.data = {"apps": [], "members": {}, "t": 0}

    # ----- the token -----
    def token(self):
        v = self.vault.get("steam_family") or {}
        tok = v.get("token")
        if tok and token_expiry(tok) - time.time() > 300:
            return tok
        return None

    def save_token(self, tok):
        self.vault.set("steam_family", {"token": tok, "exp": token_expiry(tok)})

    def forget(self):
        self.vault.set("steam_family", None)
        self.data = {"apps": [], "members": {}, "t": 0}
        self._write()

    def linked(self):
        return bool((self.vault.get("steam_family") or {}).get("token"))

    # ----- the library -----
    def refresh(self, key=None):
        tok = self.token()
        if not tok:
            raise PermissionError("Sign in to Steam again to see your family's games.")
        sid = token_steamid(tok)
        q = urllib.parse.quote(tok)
        grp = (_get(f"{API}/IFamilyGroupsService/GetFamilyGroupForUser/v1/?access_token={q}&steamid={sid}").get("response") or {})
        gid = grp.get("family_groupid")
        if not gid:
            self.data = {"apps": [], "members": {}, "t": time.time(), "none": True}
            self._write()
            return self.data
        res = (_get(f"{API}/IFamilyGroupsService/GetSharedLibraryApps/v1/?access_token={q}&family_groupid={gid}"
                    f"&include_own=false&include_excluded=false&include_free=false&include_non_games=false&steamid={sid}").get("response") or {})
        apps = []
        owners = set()
        for a in res.get("apps") or []:
            if a.get("exclude_reason") or not a.get("name") or a.get("app_type", 1) not in (1, None):
                continue
            own = [str(o) for o in a.get("owner_steamids") or [] if str(o) != sid]
            if not own:
                continue
            owners.update(own)
            apps.append({"appid": a.get("appid"), "name": a.get("name"), "owners": own,
                         "playtime": a.get("rt_playtime") or 0, "last": a.get("rt_last_played") or 0})
        members, fam = {}, {}
        try:
            fam = (_get(f"{API}/IFamilyGroupsService/GetFamilyGroup/v1/?access_token={q}&family_groupid={gid}").get("response") or {})
            ids = [str(m.get("steamid")) for m in fam.get("members") or []]
            if ids:
                summ = _get(f"{API}/ISteamUser/GetPlayerSummaries/v2/?access_token={q}&steamids={','.join(ids)}")
                for p in (summ.get("response") or {}).get("players") or []:
                    members[str(p.get("steamid"))] = p.get("personaname") or ""
        except Exception:
            pass
        if not members and key:
            try:
                summ = _get(f"{API}/ISteamUser/GetPlayerSummaries/v2/?key={urllib.parse.quote(key)}&steamids={','.join(owners)}")
                for p in (summ.get("response") or {}).get("players") or []:
                    members[str(p.get("steamid"))] = p.get("personaname") or ""
            except Exception:
                pass
        self.data = {"apps": sorted(apps, key=lambda x: x["name"].lower()), "members": members, "family": fam.get("name") or "",
                     "t": time.time()}
        self._write()
        return self.data

    def _write(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f)
        os.replace(tmp, self.path)

    def view(self):
        """What the page shows: the shared games and who shares each."""
        m = self.data.get("members") or {}
        return {"linked": self.linked(), "valid": bool(self.token()), "t": self.data.get("t", 0), "none": self.data.get("none", False),
                "family": self.data.get("family") or "",
                "apps": [{"appid": a["appid"], "name": a["name"], "owners": [m.get(o) or "a family member" for o in a["owners"]],
                          "playtime": a.get("playtime", 0), "last": a.get("last", 0)} for a in self.data.get("apps") or []]}
