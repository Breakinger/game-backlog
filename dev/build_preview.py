"""Builds dev/preview.html from the real index.html, with mock data instead of the Python side."""
import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "app/ui/index.html").read_text(encoding="utf-8")
html = html.replace('href="style.css"', 'href="../app/ui/style.css"')
html = html.replace('<script src="fx.js"></script>', '<script src="../app/ui/fx.js"></script>')
html = html.replace('<script src="walk.js"></script>', '<script src="../app/ui/walk.js"></script>')
# the app's scripts load from app/ui/js; the mock data (instead of Python) goes in just before the first of them
first = html.index('<script src="js/')
html = html[:first] + '<script>window.SKIP_INTRO = !location.hash.includes("intro")</script><script src="mock.js"></script>' + html[first:]
html = html.replace('<script src="js/', '<script src="../app/ui/js/')
(root / "dev/preview.html").write_text(html, encoding="utf-8")
print("dev/preview.html written")
