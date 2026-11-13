// Chapter 3 figures, drawn as SVG in the same style as the original thesis figures.
// Each figure keeps the old layout; only the content that no longer matches the system changed.
// build.mjs turns these into images/*.svg and images/*.png.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ---------- style of the original figures ----------
const C = {
  blue: '#CFE2FF', green: '#C3F5C3', head: '#55C466', bright: '#52C463',
  stroke: '#3B3F46', ink: '#111111', line: '#3B3F46', grey: '#444444',
};
const INTER = "Inter, 'Segoe UI', Arial, sans-serif";
const POPPINS = "Poppins, 'Segoe UI', Arial, sans-serif";
const ARIAL = 'Arial, Helvetica, sans-serif';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lines = (t) => (Array.isArray(t) ? t : String(t).split('\n'));

function text(x, y, t, o = {}) {
  const { size = 16, weight = 700, anchor = 'middle', fill = C.ink, lh = 1.38, italic = false, family = INTER, rotate } = o;
  const ls = lines(t);
  const y0 = y - ((ls.length - 1) * size * lh) / 2 + size * 0.36;
  const rot = rotate ? ` transform="rotate(${rotate} ${x} ${y})"` : '';
  return `<text x="${x}" y="${y0.toFixed(1)}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}"${italic ? ' font-style="italic"' : ''}${rot}>` +
    ls.map((l, i) => `<tspan x="${x}" dy="${i ? (size * lh).toFixed(1) : 0}">${esc(l)}</tspan>`).join('') + '</text>';
}
const textW = (t, size, k = 0.58) => Math.max(...lines(t).map((l) => l.length)) * size * k;

// Label sitting on a line, with a white background like the original figures
function lbl(x, y, t, o = {}) {
  const { size = 15, weight = 700, bg = '#FFFFFF', family = INTER, pad = 4 } = o;
  const n = lines(t).length, w = textW(t, size) + pad * 2, h = n * size * 1.35 + pad;
  return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" fill="${bg}"/>` + text(x, y, t, { size, weight, family });
}

function rect(x, y, w, h, o = {}) {
  const { fill = C.blue, rx = 4, stroke = C.stroke, sw = 1.5, dash } = o;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}
function box(cx, cy, w, h, t, o = {}) {
  const { fill = C.blue, rx = 4, size = 16, weight = 700, sw = 1.5 } = o;
  return rect(cx - w / 2, cy - h / 2, w, h, { fill, rx, sw }) + text(cx, cy, t, { size, weight });
}
const term = (cx, cy, w, h, t, o = {}) => box(cx, cy, w, h, t, { fill: C.green, rx: h / 2, ...o });
function dec(cx, cy, w, h, t, o = {}) {
  const { size = 16 } = o;
  return `<polygon points="${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}" fill="${C.green}" stroke="${C.stroke}" stroke-width="1.5" stroke-linejoin="round"/>` + text(cx, cy, t, { size });
}
const SKEW = 20;
function io(cx, cy, w, h, t, o = {}) {
  const { size = 16 } = o, l = cx - w / 2, r = cx + w / 2, tp = cy - h / 2, b = cy + h / 2;
  return `<polygon points="${l + SKEW},${tp} ${r},${tp} ${r - SKEW},${b} ${l},${b}" fill="${C.blue}" stroke="${C.stroke}" stroke-width="1.5" stroke-linejoin="round"/>` + text(cx, cy, t, { size });
}
function cyl(cx, cy, w, h, t, o = {}) {
  const { size = 16 } = o, l = cx - w / 2, r = cx + w / 2, ry = 14, tp = cy - h / 2 + ry, b = cy + h / 2 - ry;
  return `<path d="M${l},${tp} A${w / 2},${ry} 0 0 1 ${r},${tp} L${r},${b} A${w / 2},${ry} 0 0 1 ${l},${b} Z" fill="${C.blue}" stroke="${C.stroke}" stroke-width="1.5"/>` +
    `<path d="M${l},${tp} A${w / 2},${ry} 0 0 0 ${r},${tp}" fill="none" stroke="${C.stroke}" stroke-width="1.5"/>` + text(cx, cy + 8, t, { size });
}
function arrow(pts, o = {}) {
  const { head = true, dash, sw = 2, color = C.line, start = false } = o;
  return `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"` +
    `${dash ? ` stroke-dasharray="${dash}"` : ''}${head ? ' marker-end="url(#ah)"' : ''}${start ? ' marker-start="url(#ah)"' : ''}/>`;
}
const DEFS = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.line}"/></marker>` +
  `<marker id="ahs" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.line}"/></marker></defs>`;
const svg = (w, h, body, extraDefs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  `<rect width="${w}" height="${h}" fill="#FFFFFF"/>${DEFS}${extraDefs}${body}</svg>`;

// Images from the original figures (avatars, product photos), cropped with nested viewBoxes
function imageDef(id, file, w, h) {
  const b64 = readFileSync(resolve(here, 'assets', file)).toString('base64');
  return `<defs><image id="${id}" width="${w}" height="${h}" xlink:href="data:image/png;base64,${b64}"/></defs>`;
}
let clipN = 0;
const crop = (id, [cx, cy, cw, ch], x, y, w = cw, h = ch) =>
  `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${cx} ${cy} ${cw} ${ch}"><use xlink:href="#${id}"/></svg>`;
// Crop clipped to a circle (avatars), so leftover line ends around them in the old figure are hidden
function cropCircle(id, [ocx, ocy, r], x, y) {
  const n = `cc${++clipN}`;
  return `<clipPath id="${n}"><circle cx="${x + r}" cy="${y + r}" r="${r}"/></clipPath><g clip-path="url(#${n})">` +
    crop(id, [ocx - r, ocy - r, 2 * r, 2 * r], x, y) + '</g>';
}

// ======================================================================
// Figure 3-4: Proposed Operational Workflow (vertical swimlanes)
// ======================================================================
function fig34() {
  const W = 2280, H = 1350, top = 30, bot = 1320, headH = 58;
  const lanes = [[30, 900, 'IoT System'], [900, 1270, 'Alert Service'], [1270, 1730, 'Water Controllers'], [1730, 2250, 'Director (Admin)']];
  let b = `<clipPath id="lanes"><rect x="30" y="${top}" width="2220" height="${bot - top}" rx="12"/></clipPath>`;
  b += `<g clip-path="url(#lanes)"><rect x="30" y="${top}" width="2220" height="${headH}" fill="${C.head}"/></g>`;
  b += `<rect x="30" y="${top}" width="2220" height="${bot - top}" rx="12" fill="none" stroke="#111" stroke-width="3"/>`;
  b += `<line x1="30" y1="${top + headH}" x2="2250" y2="${top + headH}" stroke="#111" stroke-width="3"/>`;
  for (const [x1, x2, name] of lanes) {
    if (x1 > 30) b += `<line x1="${x1}" y1="${top}" x2="${x1}" y2="${bot}" stroke="#111" stroke-width="3"/>`;
    b += text((x1 + x2) / 2, top + headH / 2, name, { size: 34 });
  }
  // edges first, nodes on top
  b += arrow([[440, 210], [440, 250]]);
  b += arrow([[440, 330], [440, 375]]);
  b += arrow([[440, 445], [440, 492]]);
  b += arrow([[440, 568], [440, 600], [290, 600], [290, 625]]);
  b += arrow([[440, 600], [600, 600], [600, 625]]);
  b += arrow([[165, 690], [90, 690], [90, 290], [335, 290]]);
  b += arrow([[725, 690], [810, 690], [810, 310], [545, 310]]);
  b += arrow([[290, 755], [290, 850], [990, 850]]);
  b += arrow([[600, 755], [600, 850]], { head: false });
  b += arrow([[1085, 888], [1085, 942]]);
  b += arrow([[1180, 980], [1370, 980]]);
  b += arrow([[1500, 1018], [1500, 1052]]);
  b += arrow([[1500, 1128], [1500, 1162]]);
  b += arrow([[1665, 1200], [1700, 1200], [1700, 265], [545, 265]]);
  b += arrow([[1085, 1018], [1085, 1290], [1840, 1290], [1840, 1018]]);
  b += arrow([[1935, 980], [2035, 980]]);
  b += arrow([[2130, 1018], [2130, 1070]]);
  b += arrow([[2130, 1130], [2130, 1185]]);
  b += lbl(128, 690, 'No', { size: 14 }) + lbl(767, 690, 'No', { size: 14 });
  b += lbl(290, 805, 'Yes', { size: 14 }) + lbl(600, 805, 'Yes', { size: 14 });
  // nodes
  b += term(440, 170, 190, 80, 'Continuous 24/7\nMonitoring', { size: 17 });
  b += box(440, 290, 210, 80, 'Read Sensor Data\n(Level, pH)', { size: 17 });
  b += box(440, 410, 210, 70, 'Filter & Convert\nReadings', { size: 17 });
  b += box(440, 530, 260, 76, 'Log Data to Database\n(On Change or Every 10 s)', { size: 17 });
  b += dec(290, 690, 250, 130, 'Level Low/High\nfor 5 Seconds?', { size: 17 });
  b += dec(600, 690, 250, 130, 'pH Unsafe\nfor 5 Seconds?', { size: 17 });
  b += box(1085, 850, 190, 76, 'Create Alert\nNotification', { size: 17 });
  b += box(1085, 980, 190, 76, 'Send Push\nNotification (FCM)', { size: 17 });
  b += box(1500, 980, 260, 76, 'Receive Toast, Chime\n& Push Notification', { size: 17 });
  b += box(1500, 1090, 250, 76, 'Acknowledge Alert\n(Silence Chime, Logged)', { size: 17 });
  b += box(1500, 1200, 330, 76, 'Perform Manual Intervention /\nOn-Site Inspection', { size: 17 });
  b += box(1840, 980, 190, 76, 'View Dashboard\nAlert', { size: 17 });
  b += box(2130, 980, 190, 76, 'Monitor Real-Time\nRecovery', { size: 17 });
  b += box(2130, 1100, 160, 60, 'View Reports', { size: 17 });
  b += term(2130, 1215, 170, 60, 'End Process', { size: 17 });
  return svg(W, H, b);
}

// ======================================================================
// Figure 3-5: System Data Processing and Logic Flowchart
// ======================================================================
function fig35() {
  const W = 1440, H = 3000, M = 685;
  const ioL = (cx, w) => cx - w / 2 + SKEW / 2, ioR = (cx, w) => cx + w / 2 - SKEW / 2;
  let b = '';
  b += arrow([[M, 86], [M, 137]]);
  b += arrow([[M, 233], [M, 280]]);
  b += arrow([[535, 360], [285, 360]]);
  b += arrow([[160, 310], [160, 185], [ioL(M, 290), 185]]);
  b += arrow([[M, 440], [M, 508]]);
  b += arrow([[M, 592], [M, 650]]);
  b += arrow([[495, 735], [70, 735]], { head: false });
  b += arrow([[M, 820], [M, 880]]);
  b += arrow([[835, 950], [940, 950]]);
  b += arrow([[M, 1020], [M, 1095]]);
  b += arrow([[795, 1170], [920, 1170]]);
  b += arrow([[575, 1170], [475, 1170]]);
  b += arrow([[185, 1170], [70, 1170]], { head: false });
  b += arrow([[70, 735], [70, 2860], [550, 2860]]);
  b += arrow([[1230, 950], [1270, 950], [1270, 1420], [865, 1420]]);
  b += arrow([[1060, 1213], [1060, 1380], [865, 1380]]);
  b += arrow([[M, 1475], [M, 1537]]);
  b += arrow([[565, 1620], [245, 1620], [245, 1742]]);
  b += arrow([[805, 1620], [1060, 1620], [1060, 1707]]);
  b += arrow([[945, 1790], [ioR(245, 290), 1790]]);
  b += arrow([[245, 1838], [245, 2860]], { head: false });
  b += arrow([[1060, 1873], [1060, 1935]]);
  b += arrow([[1060, 2045], [1060, 2112]]);
  b += arrow([[1060, 2208], [1060, 2275]]);
  b += arrow([[1180, 2340], [1225, 2340]]);
  b += arrow([[1300, 2300], [1300, 2160], [ioR(1060, 360), 2160]]);
  b += arrow([[1060, 2405], [1060, 2462]]);
  b += arrow([[1060, 2538], [1060, 2595]]);
  b += arrow([[1225, 2680], [1290, 2680], [1290, 2568], [1064, 2568]]);
  b += arrow([[1060, 2765], [1060, 2822]]);
  b += arrow([[930, 2860], [820, 2860]]);
  b += arrow([[M, 2896], [M, 2950], [1400, 2950], [1400, 185], [ioR(M, 290), 185]]);
  // edge labels
  b += lbl(410, 360, 'Invalid / Voltage Spike');
  b += lbl(M, 474, 'Valid Reading');
  b += lbl(300, 735, 'No') + lbl(M, 850, 'Yes');
  b += lbl(888, 950, 'Yes') + lbl(M, 1057, 'No');
  b += lbl(858, 1170, 'Yes') + lbl(525, 1170, 'No');
  b += lbl(405, 1620, 'Normal (15%–95% Level,\n6.5–8.5 pH)');
  b += lbl(935, 1620, 'Threshold\nBreached');
  b += lbl(668, 1790, 'Transient Noise (< 5 s)');
  b += lbl(1060, 1904, 'Persistent (≥ 5 s)');
  b += text(1203, 2322, 'No', { size: 15 });
  b += lbl(1060, 2433, 'Yes') + lbl(1258, 2680, 'No') + lbl(1060, 2793, 'Yes');
  // nodes
  b += term(M, 60, 150, 52, 'Start', { size: 17 });
  b += io(M, 185, 290, 96, 'Read Analog Sensors\n(Hydrostatic & pH)\nEvery 20 ms', { size: 17 });
  b += dec(M, 360, 300, 160, '4-Stage\nSignal Filter & Bounds\nCheck?', { size: 17 });
  b += box(160, 360, 250, 100, 'Discard Reading &\nResample (Sensor Fault\nif Invalid for 10 s)', { size: 16 });
  b += box(M, 550, 330, 84, 'Convert to Height, Level %\n& pH (Calibration Values)', { size: 17 });
  b += dec(M, 735, 380, 170, 'Changed ≥ 2% or\n≥ 0.15 pH, or 10 s\nHeartbeat Due?', { size: 17 });
  b += dec(M, 950, 300, 140, 'Primary\nEthernet Link Active?', { size: 17 });
  b += box(1085, 950, 290, 100, 'Transmit via LAN8720\nEthernet & CPE210 P2P\nBridge', { size: 17 });
  b += dec(M, 1170, 220, 150, 'Backup Wi-Fi\nConnected?', { size: 17 });
  b += box(1060, 1170, 280, 86, 'Transmit via 2.4GHz\nWi-Fi Backup', { size: 17 });
  b += box(330, 1170, 290, 100, 'Buffer Payload in RAM Ring\nBuffer & Reconnect (90s\nWatchdog)', { size: 16 });
  b += cyl(M, 1400, 360, 150, 'Firebase Realtime\nDatabase Sync\n(History Every 10 min)', { size: 17 });
  b += dec(M, 1620, 240, 165, 'Threshold\nValidation\nCheck?', { size: 17 });
  b += io(245, 1790, 290, 96, 'Update Web & Mobile\nDashboard', { size: 17 });
  b += dec(1060, 1790, 230, 165, '5-Second\nPersistence\nCheck?', { size: 17 });
  b += box(1060, 1990, 360, 110, 'Alert Service Raises Alert:\nCRITICAL (Low Level, pH),\nWARNING (Overflow); Log Event', { size: 16 });
  b += io(1060, 2160, 360, 96, 'Send Push Notification;\nToast & Audible Chime\non Web & Android', { size: 16 });
  b += dec(1060, 2340, 240, 130, 'Acknowledged?', { size: 17 });
  b += box(1300, 2340, 150, 80, 'Repeat\nEvery 60 s', { size: 16 });
  b += box(1060, 2500, 280, 76, 'Silence Chime &\nLog Acknowledgment', { size: 17 });
  b += dec(1060, 2680, 330, 170, 'Normal for 5 s?\n(Level ≥ 17% / ≤ 93%,\npH Back in Range)', { size: 16 });
  b += box(1060, 2860, 260, 76, 'Alert Resolved;\nRecovered Logged', { size: 17 });
  b += term(M, 2860, 270, 72, 'Next Reading Cycle', { size: 17 });
  return svg(W, H, b);
}

// ======================================================================
// Figure 3-6: HIPO (three layers)
// ======================================================================
function fig36() {
  const W = 1470, H = 1800;
  const layer = (y, h, title, sub) =>
    rect(75, y, 1320, h, { rx: 40, sw: 3 }) + text(735, y + 48, title, { size: 44 }) + text(735, y + 118, sub, { size: 33, weight: 400 });
  const inner = (x, y, w, h, title, body, ts = 34, bs = 28) => {
    const tl = lines(title).length;
    return rect(x, y, w, h, { fill: C.green, rx: 10, sw: 3 }) + text(x + w / 2, y + 22 + (tl * ts * 1.3) / 2, title, { size: ts, lh: 1.3 }) +
      text(x + w / 2, y + 22 + tl * ts * 1.3 + (h - 22 - tl * ts * 1.3) / 2, body, { size: bs, weight: 400, lh: 1.3 });
  };
  const blockArrow = (y) => `<rect x="726" y="${y}" width="18" height="62" fill="${C.stroke}"/><polygon points="704,${y + 58} 766,${y + 58} 735,${y + 110}" fill="${C.stroke}"/>`;
  let b = '';
  b += layer(75, 525, 'Input Layer (Perception)', 'ESP32 Edge Node at Reservoir Site');
  b += inner(157, 262, 563, 300, 'Sensors', 'Submersible Hydrostatic Level\nSensor (via Current-to-Voltage\nModule) & PH-4502C pH Sensor');
  b += inner(757, 262, 563, 300, 'Processing & Network\nHardware', 'ESP32-WROOM-32\nMicrocontroller + LAN8720 PHY\nEthernet Module');
  b += blockArrow(600);
  b += layer(712, 470, 'Process Layer (Network & Application)', 'Connectivity, Cloud Database, Alert Service & Logic');
  b += inner(115, 900, 405, 245, 'Connectivity', 'TP-Link CPE210 2.4GHz\nP2P Wireless Bridge;\nWi-Fi Standby Link', 32, 26);
  b += inner(532, 900, 405, 245, 'Cloud & Logic', 'Firebase Realtime\nDatabase, Cloud Firestore,\nAuthentication & Logs', 32, 26);
  b += inner(949, 900, 405, 245, 'Alert Service', 'Node.js Worker: 5-Second\nCheck, Alerts, FCM Push,\nOffline Detection', 32, 26);
  b += blockArrow(1182);
  b += layer(1294, 470, 'Output Layer (End Users & Devices)', 'Web Dashboard and Mobile Application');
  b += inner(157, 1482, 563, 245, 'End Users', 'Motor Pool Staff, Maintenance\nTechnicians, System\nAdministrators');
  b += inner(764, 1482, 563, 245, 'Client Devices', 'React + Vite Web App &\nCapacitor Android App\n(Toast, Chime & Push Alerts)');
  return svg(W, H + 20, b);
}

// ======================================================================
// Figures 3-8 and 3-9: IPO card columns
// ======================================================================
function ipo(rows) {
  const cols = [50, 505, 957], cw = 375, card = 325, rowH = 225, gap = 25, y0 = 125;
  const H = y0 + rows.length * (rowH + gap) + 25;
  let b = '';
  ['Input', 'Process', 'Output'].forEach((name, i) => {
    b += rect(cols[i], 50, cw, H - 75, { rx: 30, sw: 2.5 });
    b += text(cols[i] + cw / 2, 82, name, { size: 30 });
  });
  rows.forEach((row, r) => {
    const y = y0 + r * (rowH + gap), mid = y + rowH / 2;
    row.forEach(([title, body], i) => {
      const x = cols[i] + 25;
      b += rect(x, y, card, rowH, { fill: C.green, rx: 6, sw: 2 });
      const tl = lines(title).length, bl = lines(body).length, th = tl * 22 * 1.3, bh = bl * 20 * 1.4, total = th + 12 + bh;
      b += text(x + card / 2, mid - total / 2 + th / 2, title, { size: 22, lh: 1.3 });
      b += text(x + card / 2, mid + total / 2 - bh / 2, body, { size: 20, weight: 400, lh: 1.4 });
    });
    for (const [x1, x2] of [[cols[0] + 25 + card, cols[1] + 25], [cols[1] + 25 + card, cols[2] + 25]]) {
      b += `<line x1="${x1}" y1="${mid}" x2="${x2 - 28}" y2="${mid}" stroke="${C.stroke}" stroke-width="9"/>`;
      b += `<polygon points="${x2 - 32},${mid - 19} ${x2},${mid} ${x2 - 32},${mid + 19}" fill="${C.stroke}"/>`;
    }
  });
  return svg(1382, H, b);
}

const fig38 = () => ipo([
  [['JSON Payload from\nESP32', 'waterLevel, waterHeight,\nphLevel, RSSI, status\n(on change or every 10 s)'],
    ['Validate, Parse &\nPersist to RTDB', 'Authenticated HTTPS\nREST write directly to\nRTDB tanks/{id}'],
    ['Stored, Timestamped\nTelemetry Records', 'Live RTDB record per\ntank, lastUpdate\ntimestamp']],
  [['Alert Threshold\nConfiguration', 'Low 15%, Overflow\n95%, pH 6.5–8.5'],
    ['Alert Service:\n5-Second Check', 'Node.js worker compares\nreadings with the limits;\na breach must last 5 s'],
    ['Alert Notifications\n& Logs', 'CRITICAL (low level, pH),\nWARNING (overflow) in\n/notifications and /logs']],
  [['Device Push\nTokens', 'fcmTokens saved for\neach user in\nuserState/{uid}'],
    ['Push, Repeat &\nResolve Alerts', 'Send FCM push; repeat\nevery 60 s until acknowledged;\nresolve after 5 s normal'],
    ['Push & Real-Time\nToast Alerts', 'Push to Web & Android;\ntoast & audible chime\nin open dashboards']],
  [['Controller Update\nTimes', 'lastUpdate of\neach tank'],
    ['Offline Detection', 'Mark a controller offline\nafter 30 s without\nan update'],
    ['Controller Offline\nStatus & Log', 'controllerOffline flag and\nCONTROLLER_OFFLINE\nwarning log']],
  [['User Login\nCredentials', 'Email or username +\npassword, Firebase\nAuth token'],
    ['Auth & RBAC\nVerification', 'Firebase Auth sign-in;\nrole in roles/{uid}\nchecked by security rules'],
    ['Role-Gated\nDashboard Access', 'Admin / Worker / Viewer\nroutes unlocked based\non assigned role']],
  [['Reports & Historical\nRequests', 'Tank ID, date range\nfilters (7 / 14 / 30 days)'],
    ['Query Logs & Build\nRecharts Datasets', 'Filter RTDB telemetry &\ndiagnostic logs by tank\nand range, build trend\narrays'],
    ['Interactive Analytics\n& Exportable Reports', 'Recharts trend\nvisualizers & exportable\nreports (PDF, Excel,\nCSV)']],
  [['Admin Calibration\nInput', 'Vmin/Vmax,\ntankHeight, phSlope,\nphOffset'],
    ['Update Calibration\nParams in RTDB', 'Admin writes parameters\nto tanks/{id} fields'],
    ['Dynamic Sensor\nCalibration', 'ESP32 applies updated\ncalibration formula on\nnext poll without\nre-flashing']],
  [['User Registry\nManagement', 'User details\nand role'],
    ['Register Auth &\nFirestore Profile', 'Firebase Auth user\ncreation; profile in\nusers/{uid}, role in\nroles/{uid}'],
    ['Active User Registry\nProfile', 'User profile visible in\nAdmin Panel with\nrole-gated access']],
  [['Stored History, Logs\n& Notifications', 'Records with\ntimestamps'],
    ['Retention &\nHeartbeat', 'Delete records older than\n90 days (daily); heartbeat\nevery 10 s to /system/worker'],
    ['Lean Database &\nFail-Safe Alerting', 'Old records removed;\nbrowsers take over alert\nchecks if heartbeat stops']],
]);

const fig39 = () => ipo([
  [['Live telemetry from\nFirebase RTDB', 'waterLevel,\nwaterHeight, phLevel,\nRSSI, status'],
    ['onValue listener,\nthrottle & stabilize UI', 'Smooth interpolation,\ndeadband, 1.5 s throttle'],
    ['Real-time tank cards\nwith water gauges', 'Level %, height, pH,\nsafe/warning/danger\nbadge']],
  [['Alert & sensor fault\nstate from RTDB', 'lowLevelAlert,\nhighLevelAlert, phAlert,\nphSensorOk,\nlevelSensorOk'],
    ['Show alerts; fallback\n5 s check', 'Toast & chime on new\nalerts; SystemMonitor checks\nonly if Alert Service stops'],
    ['Inline alert badges &\nsensor fault labels', 'CRITICAL / WARNING /\nRECOVERED / FAULT\ntags']],
  [['Notification\nmessages from RTDB', 'notifications/ node,\ntype:\ninfo/warning/danger'],
    ['Sort, track unread\n& acknowledge', 'Record who acknowledged\nand when; read state in\nuserState/{uid}'],
    ['Notification center\nwith unread badge', 'Bell icon pulse,\nscrollable history,\nacknowledge action']],
  [['Push notifications\n(FCM)', 'Sent by the Alert\nService when an\nalert starts'],
    ['Register device &\nshow notification', 'Device token saved in\nuserState/{uid};\ntap opens the alert'],
    ['Alerts even when the\napp is closed', 'System notification on\nWeb & Android']],
  [['Reports request &\ndate range filter', 'Tank selection, 7 / 14 /\n30-day range'],
    ['Query RTDB telemetry,\nbuild chart datasets', 'Recharts time-series\ncharts, hourly/daily\naggregation'],
    ['Trend charts &\nexportable reports', 'PDF / Excel / CSV\nfrom the Reports page']],
  [['Audit log search &\nlevel filter', 'Keyword query,\nINFO/WARNING/ERROR/\nCRITICAL'],
    ['Filter logs/ node,\nhighlight matches', 'Regex-safe highlight, sort\nby timestamp desc'],
    ['Filtered audit log with\nhighlighted terms', 'Paginated list, clear-all\nfor admin role only']],
  [['Admin configuration\n& settings input', 'Thresholds,\ncalibration,\nmaintenance mode\ntoggle'],
    ['Validate input, write\nto config/ & tanks/', 'updateConfig /\nupdateTank RTDB write,\ntoast confirm'],
    ['Updated system\nconfig & calibration\nsettings', 'Changes apply live,\nESP32 picks up on poll']],
  [['User management', 'New user, role\n(admin/worker/viewer)'],
    ['Register via\nsecondary Auth,\nFirestore profile', 'onSnapshot user list;\nactivate/deactivate,\ndelete'],
    ['Active user registry\nlist, role-based\naccess live', 'Admin panel user\ntable updated in real\ntime']],
  [['Tank assignment', 'Worker chosen for\neach tank'],
    ['Write assignedWorker\nto RTDB tanks/{id}', 'Saved with the tank,\nnot in Firestore'],
    ['Worker sees the\nassigned tank', 'Assignment shown in\nAdmin Panel and\ndashboard']],
]);

// ======================================================================
// Figure 3-10: Use Case Diagram
// ======================================================================
function fig310() {
  const W = 1820, H = 1960, IMG = 'uc';
  let b = '';
  const E = {};
  const uc = (id, cx, cy, rx, ry, t, kind = 'blue', size = 15) => { E[id] = { cx, cy, rx, ry, t, kind, size }; };
  // human use cases (column 1) and their includes / extends
  uc('cfg', 600, 210, 78, 40, 'Configure\nSystem');
  uc('setph', 860, 75, 82, 38, 'Set pH Level\nThreshold', 'green');
  uc('setwl', 1090, 120, 82, 38, 'Set Water\nLevel Threshold', 'green');
  uc('cal', 1150, 225, 78, 38, 'Calibrate\nSensors', 'green');
  uc('awc', 1090, 330, 82, 38, 'Assign Water\nController', 'green');
  uc('loc', 860, 345, 74, 36, 'Set Location', 'green');
  uc('mua', 600, 500, 82, 40, 'Manage User\nAccount');
  uc('add', 880, 470, 76, 36, 'Add User\n(with Role)', 'green');
  uc('del', 1130, 520, 70, 34, 'Delete User', 'green');
  uc('act', 900, 600, 108, 44, 'Activate/Deactivate\nAccount', 'green');
  uc('gar', 600, 760, 82, 40, 'Generate\nAnalytic Report');
  uc('vrd', 880, 720, 82, 38, 'View Report\non Dashboard', 'green');
  uc('exp', 880, 840, 98, 40, 'Export Report to\n(PDF/Excel/CSV)', 'green');
  uc('fd', 1130, 760, 68, 34, 'Filter Data', 'green');
  uc('vsl', 600, 940, 78, 40, 'View System\nLogs');
  uc('ack', 600, 1080, 78, 40, 'Acknowledge\nAlert');
  uc('vnh', 600, 1220, 92, 40, 'View Notification\nHistory');
  uc('vd', 600, 1370, 74, 40, 'View\nDashboard');
  uc('mtt', 900, 1370, 92, 54, 'Monitor Tank\nTelemetry', 'bright', 19);
  uc('vdd', 1150, 1260, 82, 38, 'View\nDashboard Data', 'green');
  uc('rt', 960, 1500, 98, 44, 'Real-Time In-App /\nToast & Push Alert');
  uc('login', 600, 1680, 52, 34, 'Login');
  uc('vc', 880, 1640, 76, 38, 'Validate\nCredentials', 'green');
  uc('cur', 880, 1760, 76, 38, 'Check User\nRole', 'green');
  uc('lus', 880, 1875, 76, 38, 'Load User\nSession', 'green');
  // system use cases (right column)
  uc('pd', 1430, 1000, 64, 40, 'Provide\nData');
  uc('ra', 1430, 1460, 64, 40, 'Raise Alert');
  uc('spn', 1430, 1610, 80, 40, 'Send Push\nNotification');
  uc('dco', 1430, 1750, 86, 40, 'Detect Controller\nOffline');

  const edgePt = (e, tx, ty) => { // point on ellipse border toward (tx,ty)
    const dx = tx - e.cx, dy = ty - e.cy, k = 1 / Math.sqrt((dx * dx) / (e.rx * e.rx) + (dy * dy) / (e.ry * e.ry));
    return [e.cx + dx * k, e.cy + dy * k];
  };
  const rel = (from, to, kind, lx, ly) => { // dashed include / extend, arrow from -> to
    const a = E[from], c = E[to];
    const p1 = edgePt(a, c.cx, c.cy), p2 = edgePt(c, a.cx, a.cy);
    b += arrow([p1, p2], { dash: '6 5', sw: 1.4 });
    const mx = lx ?? (p1[0] + p2[0]) / 2, my = ly ?? (p1[1] + p2[1]) / 2;
    b += lbl(mx, my, `<<${kind}>>`, { size: 14, weight: 500 });
  };
  const assoc = (x, y, to) => { const c = E[to]; b += arrow([[x, y], edgePt(c, x, y)], { sw: 1.4 }); };

  // actors: avatars from the original figure; Alert Service drawn in the same flat style
  const admin = [200, 402], worker = [200, 900], viewer = [200, 1422], iot = [1648, 1180], svc = [1648, 1640];
  for (const id of ['cfg', 'mua', 'gar', 'vsl', 'ack', 'vnh', 'vd', 'login']) assoc(...admin, id);
  for (const id of ['gar', 'vsl', 'ack', 'vnh', 'vd', 'login']) assoc(...worker, id);
  for (const id of ['vnh', 'vd', 'login']) assoc(...viewer, id);
  for (const id of ['pd', 'ra']) assoc(...iot, id);
  for (const id of ['ra', 'spn', 'dco']) assoc(...svc, id);

  for (const id of ['setph', 'setwl', 'cal', 'awc', 'loc']) rel('cfg', id, 'include');
  for (const id of ['add', 'del', 'act']) rel(id, 'mua', 'extend');
  rel('gar', 'vrd', 'include'); rel('gar', 'fd', 'include', 960, 760); rel('exp', 'gar', 'extend');
  rel('vd', 'mtt', 'include'); rel('mtt', 'vdd', 'include');
  rel('pd', 'mtt', 'include'); rel('pd', 'fd', 'include');
  rel('rt', 'vd', 'extend'); rel('rt', 'ack', 'extend'); rel('ra', 'rt', 'include');
  rel('login', 'vc', 'include'); rel('login', 'cur', 'include'); rel('login', 'lus', 'include');

  for (const e of Object.values(E)) {
    const fill = e.kind === 'green' ? C.green : e.kind === 'bright' ? C.bright : C.blue;
    b += `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="${fill}" stroke="#2B2F36" stroke-width="1.6"/>`;
    b += text(e.cx, e.cy, e.t, { size: e.size, lh: 1.3 });
  }
  b = rect(378, 25, 1180, H - 50, { fill: 'none', rx: 3, stroke: '#111', sw: 1.6 }) + b;

  b += cropCircle(IMG, [139, 404, 62], 139, 340) + text(200, 306, 'Admin', { size: 25 });
  b += cropCircle(IMG, [139, 900, 62], 139, 838) + text(200, 806, 'Worker', { size: 25 });
  b += cropCircle(IMG, [139, 1420, 59], 141, 1363) + text(200, 1330, 'Viewer', { size: 25 });
  b += cropCircle(IMG, [1710, 1030, 70], 1646, 1110) + text(1716, 1080, 'IoT Sensors', { size: 25 });
  // Alert Service actor: blue disc with a server glyph
  const [sx, sy] = [1716, 1640];
  b += `<circle cx="${sx}" cy="${sy}" r="68" fill="#6FAEDC"/>`;
  for (const dy of [-34, -6, 22]) {
    b += `<rect x="${sx - 38}" y="${sy + dy}" width="76" height="22" rx="5" fill="#111"/>`;
    b += `<circle cx="${sx + 24}" cy="${sy + dy + 11}" r="4" fill="#6FAEDC"/><rect x="${sx - 28}" y="${sy + dy + 8}" width="26" height="6" rx="2" fill="#6FAEDC"/>`;
  }
  b += text(sx, sy - 95, 'Alert Service', { size: 25 });
  return svg(W, H, b, imageDef(IMG, 'old-3-10-use-case.png', 1812, 1713));
}

// ======================================================================
// Figure 3-11: Activity Diagram (horizontal swimlanes)
// ======================================================================
function fig311() {
  const W = 2045, H = 1210, L = 212, R = 1968;
  const lanes = [[30, 440, 'IoT System'], [440, 650, 'Alert Service'], [650, 930, 'Operator'], [930, 1180, 'Admin']];
  let b = `<clipPath id="al"><rect x="${L}" y="30" width="${R - L}" height="1150" rx="10"/></clipPath>`;
  b += `<g clip-path="url(#al)"><rect x="${L}" y="30" width="45" height="1150" fill="${C.head}"/></g>`;
  b += `<rect x="${L}" y="30" width="${R - L}" height="1150" rx="10" fill="none" stroke="#111" stroke-width="3"/>`;
  b += `<line x1="${L + 45}" y1="30" x2="${L + 45}" y2="1180" stroke="#111" stroke-width="3"/>`;
  for (const [y1, y2, name] of lanes) {
    if (y1 > 30) b += `<line x1="${L}" y1="${y1}" x2="${R}" y2="${y1}" stroke="#111" stroke-width="2.5"/>`;
    b += text(L + 23, (y1 + y2) / 2, name, { size: 28, rotate: -90 });
  }
  const row1 = 141, D = '9 7';
  b += arrow([[442, row1], [520, row1]]) + arrow([[734, row1], [842, row1]]) + arrow([[998, row1], [1098, row1]]);
  b += arrow([[1298, row1], [1400, row1]]) + arrow([[1570, row1], [1691, row1]]);
  b += arrow([[1776, 188], [1776, 258]]);
  b += arrow([[1656, 320], [1586, 320]]);
  b += arrow([[1896, 320], [1922, 320], [1922, 1045], [1862, 1045]], { dash: D, sw: 2.5 });
  b += arrow([[1485, 360], [1485, 500]], { dash: D, sw: 2.5 });
  b += arrow([[1385, 540], [1299, 540]]);
  b += arrow([[1098, 540], [627, 540], [627, 716]], { dash: D, sw: 2.5 });
  b += arrow([[750, 780], [834, 780]]) + arrow([[1005, 780], [1092, 780]]) + arrow([[1303, 780], [1368, 780]]);
  b += arrow([[1601, 780], [1632, 780], [1632, 952], [627, 952], [627, 982]], { dash: D, sw: 2.5 });
  b += arrow([[750, 1045], [810, 1045]]) + arrow([[1029, 1045], [1092, 1045]]) + arrow([[1303, 1045], [1369, 1045]]) + arrow([[1601, 1045], [1690, 1045]]);
  b += lbl(1620, 320, 'Yes', { size: 17 }) + lbl(1922, 380, 'No', { size: 17 });
  b += term(380, row1, 124, 62, 'Start', { size: 26 });
  b += box(627, row1, 214, 92, 'Read Water Level\n(Hydrostatic)', { size: 18 });
  b += box(920, row1, 155, 92, 'Read pH\nSensor', { size: 18 });
  b += box(1198, row1, 200, 94, 'Process & Evaluate\nThresholds', { size: 18 });
  b += box(1485, row1, 170, 94, 'Log Telemetry\nto Database', { size: 18 });
  b += box(1776, row1, 170, 94, 'Update Live\nDashboard', { size: 18 });
  b += dec(1776, 320, 240, 124, 'Critical Value\nfor 5 Seconds?', { size: 18 });
  b += box(1485, 320, 200, 80, 'Log Alert Event', { size: 18 });
  b += box(1485, 540, 200, 80, 'Create Alert\nNotification', { size: 18 });
  b += box(1198, 540, 200, 80, 'Send Push\nNotification', { size: 18 });
  b += box(627, 780, 245, 124, 'Receive Real-Time\nToast, Chime &\nPush Alert', { size: 18 });
  b += box(920, 780, 170, 94, 'Inspect Tank\nStatus', { size: 18 });
  b += box(1198, 780, 210, 94, 'Acknowledge Alert\n(Silence Chime)', { size: 18 });
  b += box(1485, 780, 232, 124, 'Perform On-Site\nManual Inspection', { size: 18 });
  b += box(627, 1045, 245, 122, 'Receive System Alert\n(Simultaneous\nBroadcast)', { size: 18 });
  b += box(920, 1045, 218, 94, 'Monitor Real-Time\nTelemetry', { size: 18 });
  b += box(1198, 1045, 210, 94, 'Inspect System\nDiagnostic Logs', { size: 18 });
  b += box(1485, 1045, 232, 122, 'Verify Telemetry\nStabilization (Alert\nResolves After 5 s)', { size: 18 });
  b += term(1776, 1045, 170, 62, 'End', { size: 26 });
  return svg(W, H, b);
}

// ======================================================================
// Figure 3-12: ERD (typed tables, crow's foot)
// ======================================================================
function fig312() {
  const W = 2560, H = 2160, ROW = 37.5, HEAD = 70, TW = 610;
  const RT = 'Firebase Realtime Database';
  let b = '', ents = {};
  const ent = (id, x, y, title, sub, rows, fs = false) => {
    const h = HEAD + rows.length * ROW;
    ents[id] = { x, y, h, rows };
    let s = `<rect x="${x}" y="${y}" width="${TW}" height="${HEAD}" fill="${fs ? '#FCE8CC' : '#D6E4F5'}"/>`;
    s += text(x + TW / 2, y + 25, title, { size: 26, family: ARIAL });
    s += text(x + TW / 2, y + 53, sub, { size: 17, weight: 400, italic: true, fill: '#444', family: ARIAL });
    rows.forEach(([key, name, type], i) => {
      const ry = y + HEAD + i * ROW;
      s += `<rect x="${x}" y="${ry}" width="${TW}" height="${ROW}" fill="${i % 2 ? '#F4F4F4' : '#FFFFFF'}"/>`;
      s += `<line x1="${x}" y1="${ry}" x2="${x + TW}" y2="${ry}" stroke="#CCCCCC"/>`;
      if (key) s += text(x + 33, ry + ROW / 2, key, { size: 17, family: ARIAL });
      s += text(x + 78, ry + ROW / 2, name, { size: 20, weight: 400, anchor: 'start', family: ARIAL });
      s += text(x + 467, ry + ROW / 2, type, { size: 20, weight: 400, anchor: 'start', fill: '#444', family: ARIAL });
    });
    s += `<line x1="${x + 66}" y1="${y + HEAD}" x2="${x + 66}" y2="${y + h}" stroke="#CCCCCC"/><line x1="${x + 455}" y1="${y + HEAD}" x2="${x + 455}" y2="${y + h}" stroke="#CCCCCC"/>`;
    s += `<line x1="${x}" y1="${y + HEAD}" x2="${x + TW}" y2="${y + HEAD}" stroke="#111" stroke-width="2"/>`;
    s += `<rect x="${x}" y="${y}" width="${TW}" height="${h}" fill="none" stroke="#111" stroke-width="2"/>`;
    b += s;
  };
  const rowY = (id, i) => ents[id].y + HEAD + i * ROW + ROW / 2;

  ent('config', 60, 40, 'CONFIG', `${RT}  /config  (single record)`, [
    ['', 'lowLevelThreshold', 'NUMBER'], ['', 'overflowThreshold', 'NUMBER'], ['', 'minPh', 'NUMBER'], ['', 'maxPh', 'NUMBER'],
    ['', 'maintenanceMode', 'BOOLEAN'], ['', 'offlineThresholdSec', 'NUMBER'], ['', 'repeatIntervalSec', 'NUMBER'],
    ['', 'soundEnabled', 'BOOLEAN'], ['', 'pushEnabled', 'BOOLEAN']]);
  ent('tanks', 60, 590, 'TANKS', `${RT}  /tanks/{id}`, [
    ['PK', 'id', 'STRING'], ['', 'name', 'STRING'], ['', 'location', 'STRING'], ['', 'enabled', 'BOOLEAN'],
    ['FK', 'assignedWorker', 'STRING'], ['', 'waterLevel', 'NUMBER'], ['', 'waterHeight', 'NUMBER'], ['', 'phLevel', 'NUMBER'],
    ['', 'status', 'STRING'], ['', 'lowLevelAlert', 'STRING'], ['', 'highLevelAlert', 'STRING'], ['', 'phAlert', 'STRING'],
    ['', 'levelSensorOk', 'BOOLEAN'], ['', 'phSensorOk', 'BOOLEAN'], ['', 'levelVmin', 'NUMBER'], ['', 'levelVmax', 'NUMBER'],
    ['', 'tankHeight', 'NUMBER'], ['', 'levelOffset', 'NUMBER'], ['', 'phNeutralVoltage', 'NUMBER'], ['', 'phSlope', 'NUMBER'],
    ['', 'phOffset', 'NUMBER'], ['', 'rssi', 'NUMBER'], ['', 'wifiConnected', 'BOOLEAN'], ['', 'ethConnected', 'BOOLEAN'],
    ['', 'controllerOffline', 'BOOLEAN'], ['', 'lastUpdate', 'TIMESTAMP']]);
  ent('hist', 60, 1810, 'HISTORY_TANKS', `${RT}  /history/tanks/{tankId}`, [
    ['PK', 'sampleKey', 'STRING'], ['FK', 'tankId', 'STRING'], ['', 'waterLevel', 'NUMBER'], ['', 'waterHeight', 'NUMBER'],
    ['', 'phLevel', 'NUMBER'], ['', 'timestamp', 'TIMESTAMP']]);
  ent('users', 970, 590, 'USERS', 'Cloud Firestore  users/{uid}', [
    ['PK', 'id (Auth UID)', 'STRING'], ['', 'username', 'STRING'], ['', 'email', 'STRING'], ['', 'role', 'STRING'],
    ['', 'jobTitle', 'STRING'], ['', 'status', 'STRING'], ['', 'createdAt', 'TIMESTAMP']], true);
  ent('logs', 970, 1060, 'LOGS', `${RT}  /logs/{id}`, [
    ['PK', 'id', 'STRING'], ['', 'action', 'STRING'], ['', 'details', 'STRING'], ['', 'performedBy (name)', 'STRING'],
    ['', 'logLevel', 'STRING'], ['', 'timestamp', 'TIMESTAMP']]);
  ent('notif', 970, 1480, 'NOTIFICATIONS', `${RT}  /notifications/{id}`, [
    ['PK', 'id', 'STRING'], ['FK', 'tankId', 'STRING'], ['', 'title', 'STRING'], ['', 'message', 'STRING'], ['', 'type', 'STRING'],
    ['', 'timestamp', 'TIMESTAMP'], ['', 'acknowledged', 'BOOLEAN'], ['', 'acknowledgedBy (name)', 'STRING'],
    ['FK', 'acknowledgedByUid', 'STRING'], ['', 'acknowledgedAt', 'TIMESTAMP'], ['', 'resolved', 'BOOLEAN'],
    ['', 'resolvedAt', 'TIMESTAMP'], ['', 'lastRepeatedAt', 'TIMESTAMP']]);
  ent('roles', 1880, 590, 'ROLES', `${RT}  /roles/{uid}`, [
    ['PK,FK', 'uid', 'STRING'], ['', 'role', 'STRING']]);
  ent('ustate', 1880, 860, 'USER_STATE', `${RT}  /userState/{uid}`, [
    ['PK,FK', 'uid', 'STRING'], ['', 'notificationsLastReadAt', 'TIMESTAMP'], ['', 'notificationsReadIds', 'MAP'], ['', 'fcmTokens', 'MAP']]);
  ent('worker', 1880, 1240, 'SYSTEM_WORKER', `${RT}  /system/worker`, [
    ['', 'lastSeen', 'TIMESTAMP'], ['', 'startedAt', 'TIMESTAMP']]);
  b += text(1880 + TW / 2, 590 + HEAD + 2 * ROW + 30, 'role = admin, worker, viewer or device', { size: 17, weight: 400, italic: true, fill: '#444', family: ARIAL });
  b += text(1880 + TW / 2, 1240 + HEAD + 2 * ROW + 32, 'Alert service heartbeat (no relationships)', { size: 17, weight: 400, italic: true, fill: '#444', family: ARIAL });

  // crow's foot ends: p = point on the entity edge, d = unit direction away from the entity
  const end = ([px, py], [dx, dy], kind) => {
    const nx = -dy, ny = dx, at = (k) => [px + dx * k, py + dy * k];
    const bar = (k) => { const [x, y] = at(k); return `<line x1="${x + nx * 12}" y1="${y + ny * 12}" x2="${x - nx * 12}" y2="${y - ny * 12}" stroke="#111" stroke-width="2"/>`; };
    const circ = (k) => { const [x, y] = at(k); return `<circle cx="${x}" cy="${y}" r="8" fill="#FFF" stroke="#111" stroke-width="2"/>`; };
    if (kind === 'one') return bar(14) + bar(24);
    if (kind === 'zeroOne') return bar(16) + circ(36);
    const [fx, fy] = at(28); // zero or many
    return `<line x1="${px + nx * 16}" y1="${py + ny * 16}" x2="${fx}" y2="${fy}" stroke="#111" stroke-width="2"/><line x1="${px - nx * 16}" y1="${py - ny * 16}" x2="${fx}" y2="${fy}" stroke="#111" stroke-width="2"/>` + circ(38);
  };
  const link = (pts, a, b2, dash) => {
    const [p0, p1] = [pts[0], pts[1]], [q0, q1] = [pts[pts.length - 1], pts[pts.length - 2]];
    const u = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); return [dx / l, dy / l]; };
    return `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#111" stroke-width="2"${dash ? ' stroke-dasharray="10 7"' : ''}/>` +
      end(p0, u(p0, p1), a) + end(q0, u(q0, q1), b2);
  };
  const it = (x, y, t, anchor = 'start') => text(x, y, t, { size: 21, weight: 400, italic: true, anchor, family: ARIAL });
  const cfgB = 40 + HEAD + 9 * ROW, tnkB = 590 + HEAD + 26 * ROW;
  b += link([[365, cfgB], [365, 590]], 'one', 'zeroMany') + it(385, (cfgB + 590) / 2, 'governs thresholds of');
  b += link([[365, tnkB], [365, 1810]], 'one', 'zeroMany') + it(385, (tnkB + 1810) / 2, 'stores 10-minute samples in');
  b += link([[670, rowY('tanks', 4)], [970, rowY('tanks', 4)]], 'zeroMany', 'zeroOne') + it(820, rowY('tanks', 4) - 25, 'is assigned to', 'middle');
  b += link([[670, rowY('notif', 1)], [970, rowY('notif', 1)]], 'one', 'zeroMany') + it(820, rowY('notif', 1) - 25, 'raises', 'middle');
  const usrB = 590 + HEAD + 7 * ROW;
  b += link([[1275, usrB], [1275, 1060]], 'zeroOne', 'zeroMany', true) + it(1295, (usrB + 1060) / 2, 'performs / is recorded in (by name)');
  b += link([[1580, rowY('users', 6)], [1680, rowY('users', 6)], [1680, rowY('notif', 8)], [1580, rowY('notif', 8)]], 'zeroOne', 'zeroMany') + it(1700, 1400, 'acknowledges');
  b += link([[1580, rowY('users', 0)], [1880, rowY('roles', 0)]], 'one', 'one') + it(1730, rowY('users', 0) - 25, 'has', 'middle');
  b += link([[1580, rowY('users', 2)], [1760, rowY('users', 2)], [1760, rowY('ustate', 0)], [1880, rowY('ustate', 0)]], 'one', 'zeroOne') + it(1780, 900, 'has');

  // legend
  const lx = 1880, ly = 40;
  b += `<rect x="${lx}" y="${ly}" width="${TW}" height="470" fill="#FFF" stroke="#999" stroke-width="1.5"/>`;
  b += text(lx + 18, ly + 28, 'Legend', { size: 20, anchor: 'start', family: ARIAL });
  const lg = (y, kind, t) => `<line x1="${lx + 30}" y1="${y}" x2="${lx + 80}" y2="${y}" stroke="#111" stroke-width="2"/>` + end([lx + 30, y], [1, 0], kind) + text(lx + 100, y, t, { size: 18, weight: 400, anchor: 'start', family: ARIAL });
  b += lg(ly + 70, 'one', 'exactly one') + lg(ly + 115, 'zeroMany', 'zero or many') + lg(ly + 160, 'zeroOne', 'zero or one');
  b += `<line x1="${lx + 30}" y1="${ly + 205}" x2="${lx + 80}" y2="${ly + 205}" stroke="#111" stroke-width="2" stroke-dasharray="10 7"/>` + text(lx + 100, ly + 205, 'linked by name, not a strict key', { size: 18, weight: 400, anchor: 'start', family: ARIAL });
  b += text(lx + 30, ly + 250, 'PK = primary key     FK = foreign (logical) key', { size: 18, weight: 400, anchor: 'start', family: ARIAL });
  b += `<rect x="${lx + 30}" y="${ly + 280}" width="30" height="22" fill="#FCE8CC" stroke="#999"/>` + text(lx + 75, ly + 291, 'Cloud Firestore', { size: 18, weight: 400, anchor: 'start', family: ARIAL });
  b += `<rect x="${lx + 30}" y="${ly + 318}" width="30" height="22" fill="#D6E4F5" stroke="#999"/>` + text(lx + 75, ly + 329, 'Firebase Realtime Database', { size: 18, weight: 400, anchor: 'start', family: ARIAL });
  b += text(lx + 30, ly + 395, 'Keys are maintained by the application;\nFirebase does not enforce foreign keys.', { size: 18, weight: 400, anchor: 'start', fill: '#444', family: ARIAL });
  return svg(W, H, b);
}

// ======================================================================
// Figure 3-13: Architectural Design (photos from the original figure)
// ======================================================================
function serverIcon(cx, cy, r = 46) {
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#5F6368"/>`;
  for (const dy of [-22, -4, 14]) {
    s += `<rect x="${cx - 26}" y="${cy + dy}" width="52" height="14" rx="3" fill="#FFFFFF"/><circle cx="${cx + 17}" cy="${cy + dy + 7}" r="3" fill="#5F6368"/><rect x="${cx - 20}" y="${cy + dy + 5}" width="18" height="4" rx="1" fill="#5F6368"/>`;
  }
  return s;
}
function bellIcon(cx, cy, r = 46) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#F6AE2D"/>` +
    `<path d="M${cx - 20},${cy + 14} L${cx - 20},${cy - 4} A20,20 0 0 1 ${cx + 20},${cy - 4} L${cx + 20},${cy + 14} L${cx + 26},${cy + 20} L${cx - 26},${cy + 20} Z" fill="#FFFFFF"/>` +
    `<circle cx="${cx}" cy="${cy + 27}" r="6" fill="#FFFFFF"/><circle cx="${cx}" cy="${cy - 26}" r="4" fill="#FFFFFF"/>`;
}
function fig313() {
  const W = 1680, H = 650, IMG = 'arch', NET = 'net';
  const P = (x, y, t, size = 17) => text(x, y, t, { size, family: POPPINS, weight: 600, lh: 1.35 });
  const A = (pts, o) => arrow(pts, { sw: 2.5, color: '#000', ...o });
  let b = '';
  // wiring
  b += A([[165, 225], [212, 225]]);
  b += A([[328, 225], [372, 225], [372, 320], [398, 320]]);
  b += A([[165, 440], [372, 440], [372, 350], [398, 350]]);
  b += A([[440, 300], [440, 140], [488, 140]]);
  b += A([[618, 140], [688, 140]]);
  b += arrow([[740, 140], [808, 140]], { sw: 2.5, color: '#000', dash: '8 6', start: true });
  b += A([[842, 222], [842, 296]]);
  b += A([[472, 446], [472, 520], [860, 520], [860, 490]], { dash: '8 6' });
  b += A([[935, 350], [1045, 350]]) + A([[1045, 380], [935, 380]]);
  b += A([[1180, 350], [1415, 350]]) + A([[1415, 380], [1180, 380]]);
  b += arrow([[1112, 182], [1112, 288]], { sw: 2.5, color: '#000', start: true });
  b += A([[1160, 136], [1283, 136]]);
  b += A([[1330, 184], [1330, 262], [1505, 262], [1505, 302]], { dash: '8 6' });
  // photos and icons
  b += crop(IMG, [15, 165, 145, 110], 20, 170);
  b += crop(IMG, [15, 360, 145, 112], 20, 385);
  b += crop(IMG, [285, 260, 145, 125], 400, 290);
  b += crop(IMG, [466, 70, 126, 95], 490, 92);
  b += crop(NET, [325, 145, 55, 155], 688, 66);
  b += crop(NET, [680, 145, 55, 155], 808, 66);
  b += crop(IMG, [630, 255, 140, 130], 790, 296);
  b += crop(IMG, [873, 245, 106, 140], 1060, 292);
  b += crop(IMG, [1130, 255, 170, 105], 1420, 310);
  // current-to-voltage module, drawn as a small board
  b += `<rect x="214" y="190" width="112" height="72" rx="6" fill="#2B5C9E" stroke="#1B3B66" stroke-width="2"/>`;
  b += `<rect x="226" y="202" width="28" height="22" rx="2" fill="#4A90E2" stroke="#FFF"/><rect x="270" y="204" width="44" height="18" rx="2" fill="#111"/>`;
  for (let i = 0; i < 4; i++) b += `<rect x="${232 + i * 20}" y="240" width="10" height="16" fill="#E2B33B"/>`;
  b += serverIcon(1112, 136) + bellIcon(1330, 136);
  // labels
  b += P(100, 130, 'Hydrostatic Water\nLevel Sensor\n(4–20 mA)', 16);
  b += P(270, 296, 'Current-to-Voltage\nModule', 16);
  b += P(92, 520, 'pH Sensor\n(PH-4502C)', 16);
  b += P(472, 428, 'ESP32 Microcontroller', 16);
  b += P(552, 50, 'LAN8720 PHY\nEthernet Module', 16);
  b += P(775, 34, 'TP-Link CPE210\nP2P Bridge (2.4GHz)', 16);
  b += P(655, 120, 'RJ45', 14);
  b += P(860, 460, 'Internet Connection\n(Wireless Router)', 16);
  b += lbl(666, 520, 'Standby: 2.4GHz Wi-Fi (Used if Ethernet Goes Down)', { size: 15, family: POPPINS, weight: 500 });
  b += P(1112, 460, 'Firebase Cloud\nService', 16);
  b += P(1112, 52, 'Alert Service\n(Node.js Worker)', 16);
  b += P(1330, 52, 'Firebase Cloud\nMessaging (FCM)', 16);
  b += lbl(1420, 262, 'Push', { size: 15, family: POPPINS, weight: 500 });
  b += P(1505, 460, 'Web & Mobile\nDashboard Client', 16);
  b += P(240, 610, 'Physical Perception Layer', 26) + P(940, 610, 'Network & Cloud Infrastructure Layer', 26) + P(1505, 610, 'Client Application Layer', 26);
  return svg(W, H, b, imageDef(IMG, 'old-3-13-architecture.png', 1385, 579) + imageDef(NET, 'old-3-14-network.png', 1430, 523));
}

// ======================================================================
// Figure 3-14: Network Design Topology (original figure with corrected labels)
// ======================================================================
function fig314() {
  const W = 1720, H = 540, NET = 'net';
  const P = (x, y, t, size = 16, weight = 600) => text(x, y, t, { size, family: POPPINS, weight, lh: 1.3 });
  let b = crop(NET, [0, 0, 1430, 518], 0, 0);
  // relabel: test site, link distance, standby link
  b += `<rect x="96" y="446" width="300" height="70" fill="#FFF"/>` + P(246, 480, 'Sensor Site (Drum Model of\nReservoir Tank No. 1)', 22, 600);
  b += `<rect x="462" y="212" width="134" height="46" fill="#FFF"/>` + P(529, 235, '2.4GHz P2P Link\n(15–20 m in Testing)', 12, 600);
  b += `<rect x="232" y="401" width="592" height="26" fill="#FFF"/>` + P(528, 414, 'Standby Link: Built-in 2.4GHz Wi-Fi (Used if Ethernet Goes Down)', 15, 600);
  // alert service beside Firebase
  b += arrow([[1518, 82], [1398, 82]], { sw: 2.5, color: '#000', start: true });
  b += P(1458, 66, 'Internet', 12, 600);
  b += serverIcon(1580, 82, 52);
  b += P(1580, 175, 'Alert Service\n(Node.js Worker)', 16);
  return svg(W, H, b, imageDef(NET, 'old-3-14-network.png', 1430, 523));
}

export const figures = [
  ['Figure 3-4: Proposed Operational Workflow of MPWSD', fig34],
  ['Figure 3-5: System Data Processing and Logic Flowchart', fig35],
  ['Figure 3-6: Hierarchical Input-Process-Output (HIPO) Model', fig36],
  ['Figure 3-8: Input-Process-Output (IPO) Model for Backend Server and Application Logic', fig38],
  ['Figure 3-9: Input-Process-Output (IPO) Model for Web Dashboard and Mobile Application', fig39],
  ['Figure 3-10: Use Case Diagram for the Water Level and Quality Monitoring System', fig310],
  ['Figure 3-11: Activity Diagram', fig311],
  ['Figure 3-12: Entity-Relationship Diagram (ERD)', fig312],
  ['Figure 3-13: Architectural Design of the System', fig313],
  ['Figure 3-14: Network Design Topology', fig314],
].map(([title, draw]) => ({ title, file: title.split(':')[0].replace(/\s+/g, '_'), draw }));
