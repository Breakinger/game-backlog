/**
 * Masterlog connection (version 4). Besides reading and writing the sheet, it lets more PCs use Masterlog:
 * a new PC asks here, you tick Allow next to its code in the "Masterlog PCs" tab, and it gets its own key.
 * It also keeps your PCs in step (All Time Classic, hidden games, DLC marks, covers, your ambience track)
 * and passes your account keys between them sealed, so this script never sees them in the clear.
 * Deploying asks for Google Drive access: your own covers and ambience track are kept in a private
 * "Masterlog (app files)" folder in your Drive.
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
    if (key) return withLock_(() => requestDevice_(p));   // another PC: wait for you to allow it in the sheet
    const fresh = newKey_();
    props.setProperty('KEY', fresh);
    try { devicesSheet_(); } catch (err) {}
    return { key: fresh, device: 'main', title: SpreadsheetApp.getActive().getName() };
  }
  if (p.action === 'device_poll') return withLock_(() => pollDevice_(p));
  const device = whoIs_(p.key, key, p.action === 'read');
  if (!device) {
    return { error: 'The app isn\'t connected to this sheet. Paste the Web app link in Settings again.', code: 'auth' };
  }
  p.device = device;
  if (p.action === 'device_wrap') return withLock_(() => wrapFor_(p));
  if (p.action === 'file_put') return withLock_(() => filePut_(p));
  if (p.action === 'file_get') return fileGet_(p);
  if (p.action === 'read') return read_();
  if (p.action === 'update') return withLock_(() => update_(p));
  if (p.action === 'add') return withLock_(() => add_(p));
  if (p.action === 'rank') return withLock_(() => rank_(p));
  if (p.action === 'state_get') return stateGet_(p.device);
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
    script: 4,
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

/* ---------- more PCs: each asks, you allow it in the "Masterlog PCs" tab ---------- */
const DEVICES_TAB = 'Masterlog PCs';

function newKey_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function devicesRead_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('DEVICES') || '{}'); } catch (err) { return {}; } }
function devicesWrite_(d) { PropertiesService.getScriptProperties().setProperty('DEVICES', JSON.stringify(d)); }

function devicesSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(DEVICES_TAB);
  if (!sh) {
    sh = ss.insertSheet(DEVICES_TAB);
    sh.getRange(3, 1, 1, 5).setValues([['PC', 'Code', 'Asked', 'Allow', 'Status']]).setFontWeight('bold');
    sh.setFrozenRows(3);
    sh.setColumnWidth(1, 220); sh.setColumnWidth(5, 320);
  }
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) {}
  sh.getRange(1, 1, 1, 2).setValues([['Link for a new PC', url ? url : 'Deploy the script as a web app to see the link here']]);
  sh.getRange(2, 1).setValue('Paste the link in Masterlog on the new PC, then tick Allow next to the code it shows. Untick to disconnect a PC.');
  return sh;
}

function deviceRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 4) return 0;
  const notes = sh.getRange(4, 6, last - 3, 1).getValues();
  for (let i = 0; i < notes.length; i++) if (String(notes[i][0]) === id) return i + 4;
  return 0;
}

function requestDevice_(p) {
  const props = PropertiesService.getScriptProperties();
  const pending = JSON.parse(props.getProperty('PENDING') || '{}');
  const now = Date.now();
  Object.keys(pending).forEach(k => { if (now - pending[k].t > 86400000) delete pending[k]; });
  if (Object.keys(pending).length >= 5) return { error: 'Too many PCs are waiting to be allowed. Allow or delete them in the Masterlog PCs tab first.' };
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  code = code.slice(0, 3) + '-' + code.slice(3);
  const id = Utilities.getUuid().replace(/-/g, '');
  const name = String(p.name || 'New PC').slice(0, 60);
  pending[id] = { name: name, code: code, pub: String(p.pub || '').slice(0, 100), t: now };
  props.setProperty('PENDING', JSON.stringify(pending));
  const sh = devicesSheet_();
  const row = Math.max(sh.getLastRow() + 1, 4);
  sh.getRange(row, 1, 1, 6).setValues([[name, code, new Date(), false, 'Waiting: tick Allow if this is your PC', id]]);
  sh.getRange(row, 4).insertCheckboxes();
  sh.hideColumns(6);
  return { pending: id, code: code, title: SpreadsheetApp.getActive().getName(), tab: DEVICES_TAB };
}

function pollDevice_(p) {
  const props = PropertiesService.getScriptProperties();
  const pending = JSON.parse(props.getProperty('PENDING') || '{}');
  const req = pending[p.id];
  if (!req) return { error: 'That request is gone. Start again from Masterlog on the new PC.', code: 'gone' };
  const sh = devicesSheet_();
  const row = deviceRow_(sh, p.id);
  if (!row) { delete pending[p.id]; props.setProperty('PENDING', JSON.stringify(pending)); return { error: 'The request was removed from the sheet.', code: 'denied' }; }
  if (sh.getRange(row, 4).getValue() !== true) return { waiting: true, code: req.code };
  const devices = devicesRead_();
  const key = newKey_();
  devices[p.id] = { key: key, name: req.name, pub: req.pub, t: Date.now() };
  devicesWrite_(devices);
  delete pending[p.id];
  props.setProperty('PENDING', JSON.stringify(pending));
  sh.getRange(row, 5).setValue('Allowed ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy'));
  return { key: key, device: p.id, title: SpreadsheetApp.getActive().getName() };
}

/* which PC is asking: the first one (KEY) or one you allowed. Unticking Allow disconnects a PC at its next sync. */
function whoIs_(given, mainKey, check) {
  if (!given) return null;
  if (mainKey && given === mainKey) return 'main';
  const devices = devicesRead_();
  const id = Object.keys(devices).find(k => devices[k].key === given);
  if (!id) return null;
  if (check) {
    const sh = SpreadsheetApp.getActive().getSheetByName(DEVICES_TAB);
    const row = sh ? deviceRow_(sh, id) : 0;
    if (!row || sh.getRange(row, 4).getValue() !== true) {
      delete devices[id]; devicesWrite_(devices);
      PropertiesService.getScriptProperties().deleteProperty('WRAP_' + id);
      if (row) sh.getRange(row, 5).setValue('Disconnected');
      return null;
    }
  }
  return id;
}

/* account keys travel sealed: an allowed PC posts the sealing key wrapped for a new PC's public key */
function stateGet_(device) {
  const props = PropertiesService.getScriptProperties();
  const devices = devicesRead_();
  const wanted = Object.keys(devices).filter(id => id !== device && devices[id].pub && !props.getProperty('WRAP_' + id))
    .map(id => ({ id: id, pub: devices[id].pub, name: devices[id].name }));
  return { state: stateRead_(), keys_wanted: wanted, wrapped: device !== 'main' ? (props.getProperty('WRAP_' + device) || '') : '' };
}

function wrapFor_(p) {
  const devices = devicesRead_();
  if (!devices[p.id] || !p.blob) return { error: 'Unknown PC.' };
  PropertiesService.getScriptProperties().setProperty('WRAP_' + p.id, String(p.blob).slice(0, 2000));
  return { ok: true };
}

/* your own covers and ambience track, in a private folder in your Drive */
function filesFolder_() {
  const it = DriveApp.getFoldersByName('Masterlog (app files)');
  return it.hasNext() ? it.next() : DriveApp.createFolder('Masterlog (app files)');
}

function filePut_(p) {
  const name = String(p.name || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80);
  if (!name || !p.data) return { error: 'Nothing to save.' };
  const folder = filesFolder_();
  const old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  const blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.mime || 'application/octet-stream', name);
  folder.createFile(blob);
  return { ok: true };
}

function fileGet_(p) {
  const name = String(p.name || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80);
  const files = filesFolder_().getFilesByName(name);
  if (!files.hasNext()) return { error: 'No such file.' };
  return { data: Utilities.base64Encode(files.next().getBlob().getBytes()) };
}
