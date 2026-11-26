/**
 * Masterlog connection (version 3: keeps your PCs in step: the All Time Classic, hidden games, DLC marks,
 * covers you picked, and your account keys, sealed so only your PCs can open them).
 *
 * Paste this into your sheet (Extensions → Apps Script), then Deploy → New deployment →
 * Web app, Execute as: Me, Who has access: Anyone. Copy the Web app link into the app's Settings.
 *
 * The sheet itself stays private. The app pairs with this script once and gets a secret key;
 * every later request must carry that key. To disconnect the app, run resetConnection() below.
 */

const TABS = { games: 'Games', plays: 'Playthroughs', books: 'Books' };
const FIRST_HEADERS = ['Game', 'Book'];

function doGet(e) {
  return respond_(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  const params = Object.assign({}, (e && e.parameter) || {}, body);
  return respond_(params);
}

/** Run this from the editor if you want to disconnect the app (or connect it again). */
function resetConnection() {
  PropertiesService.getScriptProperties().deleteProperty('KEY');
}

function respond_(p) {
  let out;
  try {
    out = route_(p);
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function route_(p) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('KEY');
  if (p.action === 'pair') {
    if (key) {
      return { error: 'This sheet is already connected to Masterlog. To use it on another PC, open Masterlog on the PC that is connected and choose Settings → Your PCs → Set up another PC. (To start over instead, run resetConnection in Extensions → Apps Script.)', code: 'paired' };
    }
    const fresh = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('KEY', fresh);
    return { key: fresh, title: SpreadsheetApp.getActive().getName() };
  }
  if (!key || p.key !== key) {
    return { error: 'The app isn\'t connected to this sheet. Paste the Web app link in Settings again.', code: 'auth' };
  }
  if (p.action === 'read') return read_();
  if (p.action === 'update') return withLock_(() => update_(p));
  if (p.action === 'add') return withLock_(() => add_(p));
  if (p.action === 'rank') return withLock_(() => rank_(p));
  if (p.action === 'state_get') return { state: stateRead_() };
  if (p.action === 'state_put') return withLock_(() => statePut_(p));
  return { error: 'Unknown action: ' + p.action };
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- reading ---------- */

function sheetFor_(tab) {
  const name = TABS[tab];
  if (!name) throw new Error('Unknown tab: ' + tab);
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('The sheet has no "' + name + '" tab.');
  return sh;
}

function headerRow_(sh) {
  const top = sh.getRange(1, 1, Math.min(10, sh.getMaxRows()), 1).getDisplayValues();
  for (let i = 0; i < top.length; i++) {
    if (FIRST_HEADERS.indexOf(String(top[i][0]).trim()) >= 0) return i + 1;
  }
  throw new Error('Couldn\'t find the header row in ' + sh.getName());
}

function options_(sh, headerRow, cols) {
  const rules = sh.getRange(headerRow + 1, 1, 1, cols).getDataValidations()[0];
  const headers = sh.getRange(headerRow, 1, 1, cols).getDisplayValues()[0];
  const out = {};
  rules.forEach((rule, i) => {
    if (!rule) return;
    const type = rule.getCriteriaType();
    const vals = rule.getCriteriaValues();
    const T = SpreadsheetApp.DataValidationCriteria;
    if (type === T.VALUE_IN_LIST) out[headers[i]] = vals[0].filter(String);
    else if (type === T.VALUE_IN_RANGE) out[headers[i]] = vals[0].getDisplayValues().map(r => r[0]).filter(String);
    else if (type === T.CHECKBOX) out[headers[i]] = 'checkbox';
  });
  return out;
}

function table_(tab) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TABS[tab]);
  if (!sh) return null;
  const h = headerRow_(sh);
  const cols = sh.getLastColumn();
  const last = sh.getLastRow();
  const values = last > h ? sh.getRange(h + 1, 1, last - h, cols).getDisplayValues() : [];
  const headers = sh.getRange(h, 1, 1, cols).getDisplayValues()[0];
  const rows = [];
  values.forEach((r, i) => { if (String(r[0]).trim()) rows.push({ row: h + 1 + i, values: r }); });
  return { headers: headers, rows: rows, options: options_(sh, h, cols) };
}

function read_() {
  return {
    title: SpreadsheetApp.getActive().getName(),
    games: table_('games'),
    plays: table_('plays'),
    books: table_('books'),
    ranking: ranking_(),
    script: 3,
  };
}

/* ---------- your ranking (Ranking tab: Rank | Game | Note) ---------- */
function rankingSheet_(create) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Ranking');
  if (!sh && create) { sh = ss.insertSheet('Ranking'); sh.getRange(1, 1, 1, 3).setValues([['Rank', 'Game', 'Note']]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}

function ranking_() {
  const sh = rankingSheet_(false);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues()
    .filter(r => String(r[1]).trim())
    .map(r => ({ rank: Number(r[0]) || 0, game: String(r[1]).trim(), note: String(r[2] || '') }))
    .sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
}

function rank_(p) {
  const list = (p.list || []).map(x => typeof x === 'string' ? { game: x, note: '' } : x).filter(x => x && String(x.game).trim());
  const sh = rankingSheet_(true);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  if (list.length) sh.getRange(2, 1, list.length, 3).setValues(list.map((x, i) => [i + 1, String(x.game).trim(), x.note || (i < 10 ? 'All-time favourite' : '')]));
  return { ok: true, count: list.length };
}

/* ---------- writing ---------- */

function columnOf_(sh, headerRow, header) {
  const headers = sh.getRange(headerRow, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const i = headers.indexOf(header);
  if (i < 0) throw new Error('No column called "' + header + '" in ' + sh.getName());
  return i + 1;
}

function locate_(sh, headerRow, row, name) {
  if (row && name) {
    const at = String(sh.getRange(row, 1).getDisplayValue()).trim();
    if (at === String(name).trim()) return row;
  }
  if (!name) return row;
  const col = sh.getRange(headerRow + 1, 1, Math.max(1, sh.getLastRow() - headerRow), 1).getDisplayValues();
  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim() === String(name).trim()) return headerRow + 1 + i;
  }
  throw new Error('Couldn\'t find "' + name + '" in ' + sh.getName() + '. Sync and try again.');
}

function write_(sh, row, headerRow, changes) {
  const skipped = [];
  Object.keys(changes || {}).forEach(header => {
    const cell = sh.getRange(row, columnOf_(sh, headerRow, header));
    if (cell.getFormula()) { skipped.push(header); return; }  // filled in by the sheet
    let v = changes[header];
    const rule = cell.getDataValidation();
    if (rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX) v = v === true || v === 'TRUE' || v === 'true';
    else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) v = Number(v);
    if (v === null || v === undefined) v = '';
    cell.setValue(v);
  });
  return skipped;
}

function update_(p) {
  const sh = sheetFor_(p.tab);
  const h = headerRow_(sh);
  const row = locate_(sh, h, Number(p.row), p.name);
  const skipped = write_(sh, row, h, p.changes);
  return { ok: true, row: row, skipped: skipped };
}

function add_(p) {
  const sh = sheetFor_(p.tab);
  const h = headerRow_(sh);
  const first = String((p.values || {})[sh.getRange(h, 1).getDisplayValue()] || '').trim();
  if (!first) throw new Error('A name is required.');
  const col = sh.getRange(h + 1, 1, Math.max(1, sh.getMaxRows() - h), 1).getDisplayValues();
  let row = 0;
  for (let i = 0; i < col.length; i++) {
    const v = String(col[i][0]).trim();
    if (v.toLowerCase() === first.toLowerCase() && p.tab !== 'plays') throw new Error('"' + first + '" is already in ' + sh.getName() + '.');
    if (!v && !row) row = h + 1 + i;
  }
  if (!row) { sh.insertRowAfter(sh.getMaxRows()); row = sh.getMaxRows(); }
  const skipped = write_(sh, row, h, p.values);
  return { ok: true, row: row, skipped: skipped };
}

/* ---------- what your PCs share besides the sheet (kept in this script's private properties) ---------- */
function stateRead_() {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty('STATE_N') || 0);
  let text = '';
  for (let i = 0; i < n; i++) text += props.getProperty('STATE_' + i) || '';
  try { return text ? JSON.parse(text) : {}; } catch (err) { return {}; }
}

function statePut_(p) {
  const cur = stateRead_();
  const incoming = p.sections || {};
  Object.keys(incoming).forEach(function (k) {
    const s = incoming[k];
    if (s && (!cur[k] || Number(s.t || 0) > Number(cur[k].t || 0))) cur[k] = { t: Number(s.t || 0), data: s.data };
  });
  const text = JSON.stringify(cur);
  if (text.length > 380000) throw new Error('Too much to keep in step between PCs.');
  const props = PropertiesService.getScriptProperties();
  const old = Number(props.getProperty('STATE_N') || 0);
  const parts = {};
  let n = 0;
  for (let i = 0; i < text.length; i += 2500) parts['STATE_' + (n++)] = text.slice(i, i + 2500);
  parts.STATE_N = String(n);
  props.setProperties(parts);
  for (let i = n; i < old; i++) props.deleteProperty('STATE_' + i);
  return { ok: true };
}
