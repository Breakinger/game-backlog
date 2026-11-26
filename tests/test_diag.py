"""The diagnostics report must never carry keys, tokens, e-mails, Steam IDs or folder names."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
import diag


def test_scrub():
    raw = ("401 https://api.igdb.com/v4/games?client_id=abcd1234efgh5678ijkl9012mnop3456&x=1 Authorization: Bearer tok.123 "
           "me@mail.com C:\\Users\\Giorgi\\AppData 76561198012345678 /home/giorgi/x key=SECRET password: hunter2 "
           "1duThbwmKNdye3u0N0Nf869_A08H8keGpKvcgr_qLBEo")
    s = diag.scrub(raw)
    for bad in ("abcd1234", "tok.123", "me@mail.com", "Giorgi", "giorgi", "76561198012345678", "SECRET", "hunter2", "1duThbwm"):
        assert bad not in s, bad
    assert "api.igdb.com" in s and "401" in s


def test_report_keeps_only_flags(tmp_path):
    diag.install(str(tmp_path))
    diag.note("window api.x", "boom token=abc")
    diag.note("window api.x", "boom token=abc")
    r = diag.report("1.0.0", {"deck": True}, {"big_picture": True, "igdb_key": "zzz", "sheet": "my sheet", "steam_id": 5}, {}, {"view": "home", "evil": "x"})
    assert "big_picture=True" in r and "zzz" not in r and "my sheet" not in r and "steam_id" not in r and "evil" not in r
    assert "×2" in r and "abc" not in r
