// Minimal Google Apps Script runtime mock — enough to run Code.gs data paths and record formulas.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const swallow = (target) => new Proxy(target, {
  get(t, p) {
    if (p in t) { const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; }
    if (p === 'then') return undefined;
    return (...a) => swallow(t);
  }
});

function colToNum(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function parseA1(a1) {
  const m = a1.replace(/\$/g, '').match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  const c1 = colToNum(m[1]), r1 = +m[2], c2 = m[3] ? colToNum(m[3]) : c1, r2 = m[4] ? +m[4] : r1;
  return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
}

class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.cells = new Map(); this.formulas = new Map(); this.maxRows = 1000; this.maxCols = 26; this.hidden = new Set(); this.charts = 0; this.protections = 0; }
  key(r, c) { return r + ',' + c; }
  get(r, c) { return this.cells.has(this.key(r, c)) ? this.cells.get(this.key(r, c)) : ''; }
  set(r, c, v) { if (v === '' || v === null || v === undefined) this.cells.delete(this.key(r, c)); else this.cells.set(this.key(r, c), v); }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getLastRow() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[0]); return m; }
  getLastColumn() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[1]); return m; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  insertColumnsAfter(after, n) { this.maxCols += n; }
  getRange(a, b, c, d) {
    let r, col, nr, nc;
    if (typeof a === 'string') [r, col, nr, nc] = parseA1(a); else { r = a; col = b; nr = c || 1; nc = d || 1; }
    if (r < 1 || col < 1) throw new Error('bad range');
    if (col + nc - 1 > this.maxCols && !this.lenient) throw new Error('Range beyond max columns: ' + (col + nc - 1) + ' > ' + this.maxCols + ' in ' + this.name);
    return swallow(new Range(this, r, col, nr, nc));
  }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  deleteRow(r) {
    const nc = new Map();
    for (const [k, v] of this.cells) { const [rr, cc] = k.split(',').map(Number); if (rr < r) nc.set(k, v); else if (rr > r) nc.set((rr - 1) + ',' + cc, v); }
    this.cells = nc;
  }
  deleteRows(start, n) { for (let i = 0; i < n; i++) this.deleteRow(start); }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, i) => this.set(r, i + 1, v)); }
  getCharts() { return []; }
  insertChart() { this.charts++; }
  newChart() { return swallow({ build() { return {}; } }); }
  removeChart() {}
  getBandings() { return []; }
  getFilter() { return null; }
  getProtections() { return []; }
  protect() {
    this.protections++;
    const rec = { calls: [], removed: [], editors: [{ getEmail: () => 'owner@example.com' }, { getEmail: () => 'phada@example.com' }] };
    (this.protectRecs = this.protectRecs || []).push(rec);
    const o = { getEditors: () => rec.editors, removeEditor(e) { rec.removed.push(e.getEmail()); return o; }, canDomainEdit: () => false, addEditor() { rec.calls.push('addEditor'); return o; }, setWarningOnly(v) { rec.calls.push('warningOnly:' + v); return o; } };
    return swallow(o);
  }
  clear() { this.cells.clear(); this.formulas.clear(); }
  hideColumns(c, n) { for (let i = 0; i < (n || 1); i++) this.hidden.add(c + i); }
  showColumns() { this.hidden.clear(); }
  setConditionalFormatRules() {}
  clearConditionalFormatRules() {}
}

class Range {
  constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); out.push(row); } return out; }
  getValue() { return this.sh.get(this.r, this.c); }
  setValues(v) {
    if (v.length !== this.nr || v[0].length !== this.nc) throw new Error(`setValues dimension mismatch: range ${this.nr}x${this.nc} vs ${v.length}x${v[0].length}`);
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, v[i][j]);
    return swallow(this);
  }
  setValue(v) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, v); return swallow(this); }
  setFormula(f) { this.sh.formulas.set(this.sh.key(this.r, this.c), f); return swallow(this); }
  clearDataValidations() { return swallow(this); }
  merge() { return swallow(this); }
  breakApart() { return swallow(this); }
  applyRowBanding() { return swallow({ setHeaderRowColor() { return swallow(this); }, setFirstRowColor() { return swallow(this); }, setSecondRowColor() { return swallow(this); } }); }
  createFilter() { return swallow(this); }
}

function makeEnv(opts = {}) {
  const props = new Map(Object.entries(opts.props || {}));
  const sheets = [];
  const ss = {
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n, pos) => { const s = swallow(new Sheet(ss, n)); if (pos !== undefined) sheets.splice(pos, 0, s); else sheets.push(s); return s; },
    setActiveSheet: (s) => { ss.active = s; return s; },
    moveActiveSheet: (pos) => { const s = ss.active; const i = sheets.indexOf(s); sheets.splice(i, 1); sheets.splice(pos - 1, 0, s); },
    getSpreadsheetTimeZone: () => 'Asia/Bangkok',
    getUi: () => swallow({})
  };
  (opts.sheets || ['Sheet1']).forEach((n) => ss.insertSheet(n));
  const enumProxy = new Proxy({}, { get: (t, p) => String(p) });
  const builder = () => { const b = new Proxy({}, { get: (t, p) => (p === 'build' ? () => ({}) : () => b) }); return b; };
  const pad = (n) => String(n).padStart(2, '0');
  const ctx = {
    console, JSON, Math, Date, String, Number, Object, Array, isNaN, parseInt, parseFloat,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => swallow({ createMenu: () => swallow({}) }), newDataValidation: builder, newConditionalFormatRule: builder, BandingTheme: enumProxy, BorderStyle: enumProxy, ProtectionType: enumProxy, WrapStrategy: enumProxy },
    ContentService: { MimeType: enumProxy, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ waitLock() { if (opts.lockFail) throw new Error('Could not obtain lock'); }, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
    Utilities: { formatDate: (d, tz, f) => { const t = new Date(d.getTime() + 7 * 3600e3); return f.replace('yyyy', t.getUTCFullYear()).replace('MM', pad(t.getUTCMonth() + 1)).replace('dd', pad(t.getUTCDate())).replace('HH', pad(t.getUTCHours())).replace('mm', pad(t.getUTCMinutes())).replace('ss', pad(t.getUTCSeconds())); } },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    Logger: { log() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(opts.code || path.join(__dirname, '..', '..', 'Code.gs'), 'utf8'), ctx);
  const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).text);
  const get = (params) => ctx.doGet({ parameter: params }).text;
  return { ctx, ss, props, post, get, sheets };
}

module.exports = { makeEnv, Sheet };
