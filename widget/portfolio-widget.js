// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: teal; icon-glyph: chart-line;

// ---------------------------------------------------------------------------
// MyWealth — iPhone widget
//
// Shows the same headline KPIs as the top of the app: portfolio value, total
// return and daily change. Reads /api/summary, so prices are fresh even when
// the app hasn't been opened.
//
// Setup: see widget/README.md. Nothing here needs editing — the token is taken
// from the widget parameter, or from the Keychain after you enter it once by
// running this script inside Scriptable.
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://portfolio-track-app.vercel.app/api/summary';
const APP_URL = 'https://portfolio-track-app.vercel.app/';

// A widget tap can only ever hand the URL to the default browser — iOS has no way
// to launch the home-screen web app itself, so the browser gives you a logged-out,
// non-standalone copy. Left off by default: tap the app's own icon instead.
// Set to true to open the site in the default browser on tap.
const TAP_OPENS_SITE = false;

const KEYCHAIN_KEY = 'myWealthWidgetToken';
const CACHE_FILE = 'mywealth-summary.json';
const REFRESH_MINUTES = 15;

const COLORS = {
  bg: new Color('#111827'),
  border: new Color('#1e293b'),
  value: new Color('#f8fafc'),
  label: new Color('#94a3b8'),
  muted: new Color('#64748b'),
  up: new Color('#22c55e'),
  down: new Color('#ef4444'),
};

const family = config.widgetFamily || 'medium';
const isAccessory = family.startsWith('accessory');

try {
  const token = await resolveToken();
  const { data, stale } = await loadSummary(token);
  const widget = isAccessory ? buildAccessoryWidget(data, stale) : buildHomeWidget(data, stale);
  if (TAP_OPENS_SITE) widget.url = APP_URL;
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);

  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
} catch (e) {
  console.error(e);
  if (config.runsInWidget) Script.setWidget(buildErrorWidget(e));
  else await buildErrorWidget(e).presentMedium();
}
Script.complete();

// --- data ------------------------------------------------------------------

async function resolveToken() {
  const fromParameter = (args.widgetParameter || '').trim();
  if (fromParameter) return fromParameter;
  if (Keychain.contains(KEYCHAIN_KEY)) return Keychain.get(KEYCHAIN_KEY);

  if (config.runsInWidget) {
    throw new Error('No token — run this script inside Scriptable once to save it.');
  }

  const alert = new Alert();
  alert.title = 'MyWealth widget';
  alert.message = 'הדבק את ה-WIDGET_TOKEN. הוא יישמר ב-Keychain של המכשיר.';
  alert.addSecureTextField('token');
  alert.addAction('שמור');
  alert.addCancelAction('ביטול');
  if ((await alert.presentAlert()) === -1) throw new Error('No token provided');

  const entered = alert.textFieldValue(0).trim();
  if (!entered) throw new Error('No token provided');
  Keychain.set(KEYCHAIN_KEY, entered);
  return entered;
}

// Fetch fresh data, falling back to the last successful response so the widget
// keeps showing numbers when the network or the endpoint is unavailable.
async function loadSummary(token) {
  try {
    const request = new Request(`${ENDPOINT}?key=${encodeURIComponent(token)}`);
    request.timeoutInterval = 20;
    const data = await request.loadJSON();
    if (typeof data?.totalILS !== 'number') throw new Error(data?.error || 'Bad response');
    writeCache(data);
    return { data, stale: false };
  } catch (e) {
    console.error(e);
    const cached = readCache();
    if (cached) return { data: cached, stale: true };
    throw e;
  }
}

function cachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
}

function writeCache(data) {
  try {
    FileManager.local().writeString(cachePath(), JSON.stringify(data));
  } catch (e) {
    console.warn(`Could not write cache: ${e}`);
  }
}

function readCache() {
  try {
    const fm = FileManager.local();
    const path = cachePath();
    if (!fm.fileExists(path)) return null;
    return JSON.parse(fm.readString(path));
  } catch {
    return null;
  }
}

// --- rendering -------------------------------------------------------------

function buildHomeWidget(data, stale) {
  const widget = new ListWidget();
  widget.backgroundColor = COLORS.bg;
  widget.setPadding(14, 14, 14, 14);

  addLabel(widget, 'שווי תיק נוכחי');

  const total = widget.addText(shekels(data.totalILS));
  total.font = Font.boldSystemFont(family === 'small' ? 22 : 26);
  total.textColor = COLORS.value;
  total.minimumScaleFactor = 0.6;
  total.lineLimit = 1;

  const usd = widget.addText(`$${round(data.totalUSD)}`);
  usd.font = Font.systemFont(10);
  usd.textColor = COLORS.muted;

  widget.addSpacer(family === 'small' ? 6 : 10);

  if (family === 'small') {
    addKpiRow(widget, 'שינוי יומי', data.dailyChangeILS, data.dailyChangePct);
    widget.addSpacer(4);
    addKpiRow(widget, 'תשואה כוללת', data.totalChangeILS, data.totalChangePct);
  } else {
    const row = widget.addStack();
    row.layoutHorizontally();
    addKpiColumn(row, 'שינוי יומי', data.dailyChangeILS, data.dailyChangePct);
    row.addSpacer();
    addKpiColumn(row, 'תשואה כוללת', data.totalChangeILS, data.totalChangePct);
  }

  widget.addSpacer(6);
  addFooter(widget, data, stale);
  return widget;
}

// Lock-screen rectangular widget: one line of value, one of daily change.
function buildAccessoryWidget(data, stale) {
  const widget = new ListWidget();

  const total = widget.addText(shekels(data.totalILS));
  total.font = Font.boldSystemFont(16);
  total.minimumScaleFactor = 0.7;
  total.lineLimit = 1;

  const daily = widget.addText(
    `${signed(data.dailyChangeILS, data.dailyChangePct)}${stale ? '  ↻' : ''}`
  );
  daily.font = Font.systemFont(12);
  daily.lineLimit = 1;

  const totalReturn = widget.addText(pct(data.totalChangePct));
  totalReturn.font = Font.systemFont(11);
  totalReturn.textColor = Color.gray();

  return widget;
}

function buildErrorWidget(error) {
  const widget = new ListWidget();
  if (!isAccessory) {
    widget.backgroundColor = COLORS.bg;
    widget.setPadding(14, 14, 14, 14);
  }

  const title = widget.addText('MyWealth');
  title.font = Font.semiboldSystemFont(12);
  if (!isAccessory) title.textColor = COLORS.value;

  const message = widget.addText(String(error.message || error));
  message.font = Font.systemFont(10);
  message.lineLimit = 3;
  if (!isAccessory) message.textColor = COLORS.down;

  return widget;
}

function addLabel(container, text) {
  const label = container.addText(text);
  label.font = Font.systemFont(9);
  label.textColor = COLORS.label;
}

function addKpiColumn(row, label, amount, percent) {
  const column = row.addStack();
  column.layoutVertically();
  addLabel(column, label);

  const color = amount >= 0 ? COLORS.up : COLORS.down;

  const value = column.addText(shekels(Math.abs(amount), amount >= 0 ? '+' : '−'));
  value.font = Font.semiboldSystemFont(14);
  value.textColor = color;
  value.lineLimit = 1;

  const change = column.addText(pct(percent));
  change.font = Font.systemFont(10);
  change.textColor = color;
}

function addKpiRow(container, label, amount, percent) {
  const row = container.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const name = row.addText(label);
  name.font = Font.systemFont(9);
  name.textColor = COLORS.label;
  row.addSpacer();

  const value = row.addText(`${signed(amount, percent)}`);
  value.font = Font.semiboldSystemFont(11);
  value.textColor = amount >= 0 ? COLORS.up : COLORS.down;
  value.lineLimit = 1;
}

function addFooter(widget, data, stale) {
  const parts = [`עודכן ${clock(data.asOf)}`];
  if (stale) parts.push('↻ מנתונים שמורים');
  if (data.priceFailures?.length) parts.push(`⚠︎ ${data.priceFailures.length} ללא מחיר`);

  const footer = widget.addText(parts.join('  ·  '));
  footer.font = Font.systemFont(8);
  footer.textColor = COLORS.muted;
  footer.lineLimit = 1;
}

// --- formatting ------------------------------------------------------------

function round(value) {
  return Math.round(value || 0).toLocaleString('en-US');
}

function shekels(value, sign = '') {
  return `${sign}₪${round(value)}`;
}

function pct(value) {
  const v = value || 0;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function signed(amount, percent) {
  const sign = amount >= 0 ? '+' : '−';
  return `${sign}₪${round(Math.abs(amount))}  (${pct(percent)})`;
}

function clock(iso) {
  const formatter = new DateFormatter();
  formatter.dateFormat = 'HH:mm';
  return formatter.string(iso ? new Date(iso) : new Date());
}
