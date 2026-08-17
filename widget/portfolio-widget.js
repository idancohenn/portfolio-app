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

// Hebrew labels sit on the right, figures on the left, and each KPI gets its own
// two lines — on a small widget a label and its figure can't share one line
// without the figure being truncated.
function buildHomeWidget(data, stale) {
  const small = family === 'small';
  const widget = new ListWidget();
  widget.backgroundColor = COLORS.bg;
  widget.setPadding(12, 12, 10, 12);

  addText(widget, 'שווי תיק נוכחי', {
    align: 'right', font: Font.systemFont(9), color: COLORS.label,
  });
  addText(widget, shekels(data.totalILS), {
    align: 'center', font: Font.boldSystemFont(small ? 19 : 26), color: COLORS.value, scale: 0.5,
  });
  addText(widget, `$${round(data.totalUSD)}`, {
    align: 'center', font: Font.systemFont(10), color: COLORS.muted, scale: 0.7,
  });

  widget.addSpacer(small ? 5 : 10);
  addKpi(widget, 'שינוי יומי', data.dailyChangeILS, data.dailyChangePct);
  widget.addSpacer(small ? 3 : 8);
  addKpi(widget, 'תשואה כוללת', data.totalChangeILS, data.totalChangePct);
  widget.addSpacer(small ? 5 : 10);

  addFooter(widget, data, stale);
  return widget;
}

function addKpi(widget, label, amount, percent) {
  addText(widget, label, { align: 'right', font: Font.systemFont(9), color: COLORS.label });
  addText(widget, signed(amount, percent), {
    align: 'left',
    font: Font.semiboldSystemFont(family === 'small' ? 12 : 15),
    color: amount >= 0 ? COLORS.up : COLORS.down,
    scale: 0.6,
  });
}

// Alignment via spacers rather than rightAlignText(), so it doesn't depend on how
// the text element sizes its own frame.
function addText(container, value, { align, font, color, scale }) {
  const row = container.addStack();
  row.layoutHorizontally();
  if (align !== 'left') row.addSpacer();

  const text = row.addText(value);
  text.font = font;
  if (color) text.textColor = color;
  text.lineLimit = 1;
  if (scale) text.minimumScaleFactor = scale;

  if (align !== 'right') row.addSpacer();
  return text;
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

// Kept terse on the small widget — the spelled-out version doesn't fit its width
// once both the stale and the missing-price markers are present.
function addFooter(widget, data, stale) {
  const failures = data.priceFailures?.length || 0;
  const parts = family === 'small'
    ? [clock(data.asOf), stale ? '↻' : '', failures ? `⚠︎${failures}` : '']
    : [
      `עודכן ${clock(data.asOf)}`,
      stale ? '↻ מנתונים שמורים' : '',
      failures ? `⚠︎ ${failures} ללא מחיר` : '',
    ];

  addText(widget, parts.filter(Boolean).join('  ·  '), {
    align: 'right', font: Font.systemFont(8), color: COLORS.muted, scale: 0.7,
  });
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
