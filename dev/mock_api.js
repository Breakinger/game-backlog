(function () {
  const art = (name, i) => {
    const hues = [210, 260, 15, 160, 330, 45, 190];
    const h = hues[i % hues.length];
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='900'><defs><linearGradient id='g' x1='0' y1='0' x2='0.6' y2='1'><stop offset='0' stop-color='hsl(${h},70%,55%)'/><stop offset='1' stop-color='hsl(${h + 40},60%,12%)'/></linearGradient></defs><rect width='600' height='900' fill='url(#g)'/><circle cx='420' cy='300' r='190' fill='hsla(${h + 20},90%,80%,.35)'/><text x='40' y='820' font-family='Bahnschrift,Arial' font-size='58' font-weight='700' fill='white'>${name.slice(0, 16).replace(/[<&]/g, '')}</text></svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  };
  let i = 0;
  window.pywebview = { api: {
    get_settings: async () => ({ sheet_url: "https://docs.google.com/spreadsheets/d/x/edit", refresh_minutes: 2, has_sgdb_key: false }),
    save_settings: async s => s, cached: async () => window.MOCK, sync: async () => window.MOCK,
    cover: async name => (name.length % 3 === 0 ? null : art(name, i++)),
    links: async g => [{ label: g.status === "Wishlist" ? "Steam store page" : "Play on Steam", url: "steam://x", primary: true }, { label: "Open in Steam library", url: "x" }, { label: "HowLongToBeat", url: "x" }],
    clear_covers: async () => true, open: async () => true, open_sheet: async () => true,
  } };
})();
