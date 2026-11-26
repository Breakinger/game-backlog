Saved copies of the pages Masterlog's parsers read, refreshed by the daily "Check outside sites" workflow
(.github/workflows/canary.yml) and committed so every build can test the parsers offline.

- `wp_*.json`: Wikipedia (en.wikipedia.org), text under CC BY-SA 4.0, via the MediaWiki API.
- `pcgw_*.json`: PCGamingWiki (pcgamingwiki.com), content under CC BY-NC-SA 3.0.

Pages that aren't openly licensed (Steam's sale schedule, news feeds) are not kept here; the daily check reads
them live instead.
