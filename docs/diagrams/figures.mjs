// Chapter 3 figures, drawn as SVG in the same style as the original thesis figures.
// Laid out for a portrait page: narrow canvas, large text, little empty space (see PAGE_W below).
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
// Crop clipped to a circle of radius R centred at (cx, cy); [ocx, ocy, r] is the circle in the source image
function cropCircleAt(id, [ocx, ocy, r], cx, cy, R) {
  const n = `cc${++clipN}`;
  return `<clipPath id="${n}"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath><g clip-path="url(#${n})">` +
    crop(id, [ocx - r, ocy - r, 2 * r, 2 * r], cx - R, cy - R, 2 * R, 2 * R) + '</g>';
}

// ---------- print size ----------
// Every figure below except 3-6 is drawn 1200 units wide, so on a 6-inch-wide page 1 unit = 0.36 pt.
// Keep body text at 19 units or more (about 7 pt in print) and labels at 16 or more.
const PAGE_W = 1200;

// Rough text width, used to wrap card text and size use-case ellipses
function estW(s, size, bold = false) {
  let w = 0;
  for (const ch of String(s)) {
    if (ch === ' ') w += 0.28;
    else if ("iljtfr.,;:'|!()[]/".includes(ch)) w += 0.36;
    else if ('mwMW'.includes(ch)) w += 0.85;
    else if (ch >= 'A' && ch <= 'Z') w += 0.68;
    else if (ch >= '0' && ch <= '9') w += 0.62;
    else w += 0.56;
  }
  return w * size * (bold ? 1.06 : 1);
}
function wrap(t, maxW, size, bold = false) {
  const out = [];
  let cur = '';
  for (const word of String(t).replace(/\n/g, ' ').split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && estW(next, size, bold) > maxW) { out.push(cur); cur = word; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

// ======================================================================
// Figure 3-4: Proposed Operational Workflow (vertical swimlanes)
// ======================================================================
function fig34() {
  const W = PAGE_W, H = 1255, top = 10, bot = 1245, headH = 50, F = 22;
  const lanes = [[10, 400, 'IoT System'], [400, 650, 'Alert Service'], [650, 940, 'Water Controllers'], [940, 1190, 'Director (Admin)']];
  let b = `<clipPath id="lanes"><rect x="10" y="${top}" width="1180" height="${bot - top}" rx="10"/></clipPath>`;
  b += `<g clip-path="url(#lanes)"><rect x="10" y="${top}" width="1180" height="${headH}" fill="${C.head}"/></g>`;
  b += `<rect x="10" y="${top}" width="1180" height="${bot - top}" rx="10" fill="none" stroke="#111" stroke-width="2.5"/>`;
  b += `<line x1="10" y1="${top + headH}" x2="1190" y2="${top + headH}" stroke="#111" stroke-width="2.5"/>`;
  for (const [x1, x2, name] of lanes) {
    if (x1 > 10) b += `<line x1="${x1}" y1="${top}" x2="${x1}" y2="${bot}" stroke="#111" stroke-width="2.5"/>`;
    b += text((x1 + x2) / 2, top + headH / 2, name, { size: 24 });
  }
  // edges first, nodes on top
  b += arrow([[200, 145], [200, 167]]) + arrow([[200, 243], [200, 267]]) + arrow([[200, 343], [200, 366]]) + arrow([[200, 470], [200, 505]]);
  b += arrow([[200, 675], [200, 725]]);
  b += arrow([[55, 810], [30, 810], [30, 205], [75, 205]]);
  b += arrow([[345, 590], [375, 590], [375, 700], [417, 700]]);
  b += arrow([[345, 810], [375, 810], [375, 700]], { head: false });
  b += arrow([[525, 738], [525, 778]]);
  b += arrow([[633, 830], [665, 830]]);
  b += arrow([[785, 882], [785, 913]]) + arrow([[785, 1017], [785, 1049]]);
  b += arrow([[905, 1115], [922, 1115], [922, 205], [325, 205]]);
  b += arrow([[525, 882], [525, 1218], [952, 1218], [952, 830], [968, 830]]);
  b += arrow([[1068, 868], [1068, 900]]) + arrow([[1068, 1004], [1068, 1040]]) + arrow([[1068, 1100], [1068, 1138]]);
  b += lbl(200, 698, 'No', { size: 20 }) + lbl(30, 760, 'No', { size: 20 });
  b += lbl(375, 640, 'Yes', { size: 20 }) + lbl(375, 760, 'Yes', { size: 20 });
  // nodes
  b += term(200, 110, 250, 70, 'Continuous 24/7\nMonitoring', { size: F });
  b += box(200, 205, 250, 76, 'Read Sensor Data\n(Level, pH)', { size: F });
  b += box(200, 305, 250, 76, 'Filter, Convert &\nRun Pump Logic', { size: F });
  b += box(200, 418, 276, 104, 'Log Data to\nDatabase (On Change\nor Every 10 s)', { size: F });
  b += dec(200, 590, 300, 176, 'Level Low/High\nfor 5 s, or Falling\nat Night?', { size: 20 });
  b += dec(200, 810, 290, 170, 'pH Unsafe\nfor 5 Seconds?', { size: 21 });
  b += box(525, 700, 216, 76, 'Create Alert\nNotification', { size: F });
  b += box(525, 830, 216, 104, 'Send Push\nNotification\n(FCM)', { size: F });
  b += box(785, 830, 240, 104, 'Receive Toast,\nChime & Push\nNotification', { size: F });
  b += box(785, 965, 240, 104, 'Acknowledge Alert\n(Silence Chime,\nLogged)', { size: F });
  b += box(785, 1115, 240, 132, 'Perform Manual\nIntervention /\nOn-Site\nInspection', { size: F });
  b += box(1068, 830, 200, 76, 'View Dashboard\nAlert', { size: F });
  b += box(1068, 952, 200, 104, 'Monitor\nReal-Time\nRecovery', { size: F });
  b += box(1068, 1070, 200, 60, 'View Reports', { size: F });
  b += term(1068, 1168, 200, 60, 'End Process', { size: F });
  return svg(W, H, b);
}

// ======================================================================
// Figure 3-5: System Data Processing and Logic Flowchart
// Left half: reading and sending (spine at x = 215). Right half: database and alerts (spine at x = 815).
// ======================================================================
function fig35() {
  const W = PAGE_W, H = 1672, L = 215, R = 815, F = 20, S = 18;
  const note = (x, y, t) => text(x, y, t, { size: S, lh: 1.25 });
  const tag = (x, y, t) => lbl(x, y, t, { size: S });
  let b = '';
  // left half
  b += arrow([[L, 70], [L, 110]]);
  b += arrow([[L, 210], [L, 255]]);
  b += arrow([[370, 345], [500, 345], [500, 279]]);
  b += arrow([[394, 180], [353, 180]]);
  b += arrow([[L, 435], [L, 485]]);
  b += arrow([[L, 585], [L, 630]]);
  b += arrow([[50, 725], [32, 725], [32, 1455], [L, 1455]], { head: false });
  b += arrow([[L, 820], [L, 875]]);
  b += arrow([[375, 950], [394, 950]]);
  b += arrow([[L, 1025], [L, 1080]]);
  b += arrow([[355, 1150], [394, 1150]]);
  b += arrow([[L, 1220], [L, 1275]]);
  b += arrow([[L, 1375], [L, 1533]]);
  b += arrow([[75, 1565], [12, 1565], [12, 160], [75, 160]]);
  // both transmit boxes feed the database at the top of the right half
  b += arrow([[606, 1150], [628, 1150], [628, 950]], { head: false });
  b += arrow([[606, 950], [628, 950], [628, 90], [665, 90]]);
  // right half
  b += arrow([[R, 160], [R, 215]]);
  b += arrow([[940, 300], [1080, 300], [1080, 380]]);
  b += arrow([[R, 385], [R, 445]]);
  b += arrow([[940, 530], [1080, 530], [1080, 480]]);
  b += arrow([[1158, 430], [1186, 430], [1186, 1650], [L, 1650], [L, 1597]]);
  b += arrow([[R, 615], [R, 676]]);
  b += arrow([[R, 804], [R, 845]]);
  b += arrow([[R, 945], [R, 990]]);
  b += arrow([[940, 1045], [992, 1045]]);
  b += arrow([[1080, 986], [1080, 895], [972, 895]]);
  b += arrow([[R, 1100], [R, 1157]]);
  b += arrow([[R, 1233], [R, 1280]]);
  b += arrow([[990, 1375], [1060, 1375], [1060, 1256], [819, 1256]]);
  b += arrow([[R, 1470], [R, 1527]]);
  b += arrow([[685, 1565], [355, 1565]]);
  // edge labels
  b += note(442, 380, 'Invalid / Spike /\nUnstable Level');
  b += tag(L, 457, 'Valid Reading');
  b += tag(32, 790, 'No') + tag(L, 845, 'Yes');
  b += note(362, 918, 'Yes') + tag(L, 1050, 'No');
  b += note(376, 1130, 'Yes') + tag(L, 1245, 'No');
  b += note(1072, 250, 'Normal\n(15%–95% Level,\n6.5–8.5 pH)');
  b += tag(R, 412, 'Threshold Breached');
  b += note(1072, 568, 'Transient Noise\n(< 5 s)');
  b += tag(R, 643, 'Persistent (≥ 5 s)');
  b += note(966, 1026, 'No') + tag(R, 1126, 'Yes');
  b += tag(1060, 1320, 'No') + tag(R, 1496, 'Yes');
  // nodes, left half
  b += term(L, 45, 130, 50, 'Start', { size: F });
  b += io(L, 160, 300, 100, 'Read Analog Sensors\n(Hydrostatic & pH)\nEvery 20 ms', { size: F });
  b += dec(L, 345, 310, 180, '4-Stage Signal\nFilter & Bounds\nCheck?', { size: F });
  b += box(500, 215, 212, 128, 'Hold Last Value;\nAfter 10 s: Flag\nFault, Keep Sending\n(Clamped)', { size: 19 });
  b += box(L, 535, 290, 100, 'Convert to Height,\nLevel % & pH;\nRun Pump Logic', { size: F });
  b += dec(L, 725, 330, 190, 'Changed ≥ 2% or\n≥ 0.15 pH, or 10 s\nHeartbeat Due?', { size: F });
  b += dec(L, 950, 320, 150, 'Ethernet Up\n& Responding?', { size: F });
  b += box(500, 950, 212, 128, 'Transmit via\nW5500 Ethernet\n& CPE210 P2P\nBridge', { size: 19 });
  b += dec(L, 1150, 280, 140, 'Backup Wi-Fi\nConnected?', { size: F });
  b += box(500, 1150, 212, 102, 'Transmit via\n2.4GHz Wi-Fi\nBackup', { size: 19 });
  b += box(L, 1325, 320, 100, 'Buffer Critical Logs in\nRAM (20 Entries) &\nReconnect (90 s Watchdog)', { size: F });
  b += term(L, 1565, 280, 64, 'Next Reading Cycle', { size: F });
  // nodes, right half
  b += cyl(R, 90, 300, 140, 'Firebase Realtime\nDatabase Sync\n(History Every 10 min)', { size: F });
  b += dec(R, 300, 250, 170, 'Threshold or\nNight Watch\nCheck?', { size: F });
  b += io(1080, 430, 176, 100, 'Update Web\n& Mobile\nDashboard', { size: 19 });
  b += dec(R, 530, 250, 170, '5-Second\nPersistence\nCheck?', { size: F });
  b += box(R, 740, 340, 128, 'Alert Service Raises Alert:\nCRITICAL (Low Level, pH),\nWARNING (Overflow), Danger\n(Night Leak); ESP32 Logs', { size: F });
  b += io(R, 895, 330, 100, 'Send Push Notification;\nToast & Audible Chime\non Web & Android', { size: F });
  b += dec(R, 1045, 250, 110, 'Acknowledged?', { size: F });
  b += box(1080, 1045, 176, 118, 'Re-show Toast\n& Chime Every\n60 s (Push Only\nat Start)', { size: 18 });
  b += box(R, 1195, 270, 76, 'Silence Chime &\nLog Acknowledgment', { size: F });
  b += dec(R, 1375, 350, 190, 'Normal for 5 s?\n(Level ≥ 17% / ≤ 93%,\npH 6.65–8.35)', { size: F });
  b += box(R, 1565, 260, 76, 'Alert Resolved;\nRecovered Logged', { size: F });
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
  b += layer(75, 525, 'Input Layer (Perception)', 'One ESP32 Edge Node per Registered Reservoir Tank');
  b += inner(157, 262, 563, 300, 'Sensors', 'Submersible Hydrostatic Level\nSensor (via Current-to-Voltage\nModule) & PH-4502C pH Sensor');
  b += inner(757, 262, 563, 300, 'Processing & Network\nHardware', 'ESP32-WROOM-32\nMicrocontroller, W5500\nEthernet & Pump Relay');
  b += blockArrow(600);
  b += layer(712, 470, 'Process Layer (Network & Application)', 'Connectivity, Cloud Database, Alert Service & Logic');
  b += inner(115, 900, 405, 245, 'Connectivity', 'TP-Link CPE210 2.4GHz\nP2P Wireless Bridge;\nWi-Fi Standby Link', 32, 26);
  b += inner(532, 900, 405, 245, 'Cloud & Logic', 'Firebase Realtime\nDatabase, Cloud Firestore,\nAuthentication & Logs', 32, 26);
  b += inner(949, 900, 405, 245, 'Alert Service', 'Cloud-Hosted: 5-Second\nCheck, Night Leak Watch,\nFCM Push, Offline Check', 32, 26);
  b += blockArrow(1182);
  b += layer(1294, 470, 'Output Layer (End Users & Devices)', 'Web Dashboard and Mobile Application');
  b += inner(157, 1482, 563, 245, 'End Users', 'Motor Pool Staff, Maintenance\nTechnicians, System\nAdministrators');
  b += inner(764, 1482, 563, 245, 'Client Devices', 'React + Vite Web App &\nCapacitor Android App\n(Toast, Chime & Push Alerts)');
  return svg(W, H + 20, b);
}

// ======================================================================
// Figures 3-8 and 3-9: IPO card columns
// Card text is wrapped to the card width here, so the line breaks in the data below do not matter.
// ======================================================================
function ipo(rows) {
  const cols = [8, 412, 816], cw = 376, pad = 10, card = cw - 2 * pad, y0 = 62, gap = 10;
  const TS = 21, BS = 20, TL = TS * 1.28, BL = BS * 1.32;
  let b = '', y = y0;
  const cards = [];
  for (const row of rows) {
    const cells = row.map(([title, body]) => ({ t: wrap(title, card - 14, TS, true), d: wrap(body, card - 16, BS) }));
    const rowH = Math.max(...cells.map((c) => c.t.length * TL + 8 + c.d.length * BL)) + 22;
    cards.push({ y, rowH, cells });
    y += rowH + gap;
  }
  const H = y + 8;
  ['Input', 'Process', 'Output'].forEach((name, i) => {
    b += rect(cols[i], 8, cw, H - 16, { rx: 20, sw: 2 });
    b += text(cols[i] + cw / 2, 35, name, { size: 26 });
  });
  for (const { y: cy, rowH, cells } of cards) {
    const mid = cy + rowH / 2;
    cells.forEach((c, i) => {
      const x = cols[i] + pad, th = c.t.length * TL, bh = c.d.length * BL, total = th + 8 + bh;
      b += rect(x, cy, card, rowH, { fill: C.green, rx: 6, sw: 1.5 });
      b += text(x + card / 2, mid - total / 2 + th / 2, c.t, { size: TS, lh: 1.28 });
      b += text(x + card / 2, mid + total / 2 - bh / 2, c.d, { size: BS, weight: 400, lh: 1.32 });
    });
    for (const [x1, x2] of [[cols[0] + pad + card, cols[1] + pad], [cols[1] + pad + card, cols[2] + pad]]) {
      b += `<line x1="${x1}" y1="${mid}" x2="${x2 - 20}" y2="${mid}" stroke="${C.stroke}" stroke-width="7"/>`;
      b += `<polygon points="${x2 - 24},${mid - 14} ${x2},${mid} ${x2 - 24},${mid + 14}" fill="${C.stroke}"/>`;
    }
  }
  return svg(PAGE_W, Math.round(H), b);
}

// Figure 3-7 (redrawn 2026-11-19 in the style of 3-8 and 3-9; the original said LAN8720 and had no pump or fault handling)
const fig37 = () => ipo([
  [['Hydrostatic Level Sensor', 'Analog voltage (0–3.3 V) through the current-to-voltage module, GPIO 35'],
    ['Signal Processing & Depth Calculation', 'Median and moving-average filters, bounds and spike checks; height and level % from Vmin, Vmax and tank height'],
    ['Calibrated Level & Depth', 'Level % and water height (m), with the level sensor health flag']],
  [['pH Glass Electrode Sensor', 'Analog voltage (0–3.3 V), GPIO 34'],
    ['pH Calibration & Conversion', 'Voltage check; neutral-voltage slope formula + offset'],
    ['pH Reading', 'pH value (6.5–8.5 nominal), with the pH sensor health flag']],
  [['Invalid or Unstable Readings', 'Voltage out of range, or a level swing of 25% or more within 30 s'],
    ['Sensor Fault Check (10 s)', 'Hold the last good value; after 10 s flag the sensor faulty and keep sending the clamped reading'],
    ['Monitoring Continues', 'Readings, history and alerts go on, marked as possibly inaccurate; pump held off on a level fault']],
  [['Telemetry Data Packets', 'Structured JSON on change (2% or 0.15 pH) or every 10 s'],
    ['Transport & RTDB Sync', 'W5500 Ethernet + CPE210 P2P bridge to Firebase; Wi-Fi failover when Ethernet is down or slow'],
    ['Live Telemetry Sync', 'Real-time updates to the web dashboard & mobile app; history every 10 min']],
  [['Level, Pump Commands & Pump Settings', 'Live level, thresholds, pumpOn command, Pump System switch, Auto / Manual mode'],
    ['Local Pump Logic (GPIO 32 Relay)', 'Auto start at the low threshold (30 s off time), stop at overflow; safety stops; dry-run guard (3% rise in 10 min, 60 min max); each command checked'],
    ['Refill Pump Control', 'Pump switched on the Pilot Test Tank; accepted or refused answer, pumpFault after a dry-run stop, and a log entry']],
  [['Alert Threshold & Night Watch Configuration', 'Shared limits (default level 15%–95%, pH 6.5–8.5) or the tank\'s own; night window 10 PM–3 AM'],
    ['Alert State Machine & Validation', '5-second persistence check; repeat every 60 s until acknowledged; night level-drop check'],
    ['Real-Time In-App / Toast Alerts & Logs', 'In-app toast & audible chime, push notifications, audit entries']],
  [['Admin Calibration & System Control', 'Shared and per-tank thresholds, calibration, maintenance mode (all tanks or one tank), live calibration view'],
    ['RTDB Configuration Sync', 'Read by the ESP32 every second; live readings sent once per second while the view is open'],
    ['Updated System Behavior', 'No re-flashing required; changes apply live']],
  [['User Authentication & Role Data', 'User credentials & roles (Admin / Worker / Viewer)'],
    ['Firestore Auth & Access Control', 'Firebase Auth validation & Role-Based Access Control (RBAC)'],
    ['Secured Client Dashboard', 'React + Vite Web App & Capacitor Android App']],
]);

const fig38 = () => ipo([
  [['JSON Payload from\nEach Tank\'s ESP32', 'waterLevel, waterHeight, phLevel, sensor health flags, RSSI, status (on change or every 10 s)'],
    ['Validate, Parse &\nPersist to RTDB', 'Authenticated HTTPS\nREST write directly to\nRTDB tanks/{id}'],
    ['Stored, Timestamped\nTelemetry Records', 'Live RTDB record per\ntank, lastUpdate\ntimestamp']],
  [['Alert & Night Watch Configuration', 'Default low 15%, overflow 95%, pH 6.5–8.5, or a tank\'s own limits; night 10 PM–3 AM, 5% fast / 3% slow drop, tanks to watch'],
    ['Alert Service: 5-Second Check & Night Watch', 'Checks each tank against the limits (a breach must last 5 s); at night compares the level with the last 30 min'],
    ['Alert Notifications\n& Logs', 'Alert in /notifications (low level, pH, pump stopped: critical; overflow: warning; possible leak: danger); ESP32 logs threshold alerts in /logs']],
  [['Device Push\nTokens', 'fcmTokens saved for\neach user in\nuserState/{uid}'],
    ['Push, Repeat &\nResolve Alerts', 'FCM push when the alert\nstarts; re-show every 60 s\nuntil acknowledged;\nresolve after 5 s normal'],
    ['Push & Real-Time\nToast Alerts', 'Push to Web & Android;\ntoast & audible chime\nin open dashboards']],
  [['Controller Update\nTimes', 'lastUpdate of\neach tank'],
    ['Offline Detection', 'Mark a controller offline\nafter the set time\n(30 s by default)\nwithout an update'],
    ['Controller Offline\nStatus & Log', 'controllerOffline flag and\nCONTROLLER_OFFLINE\nwarning log']],
  [['User Login\nCredentials', 'Email or username +\npassword, Firebase\nAuth token'],
    ['Auth & RBAC\nVerification', 'Firebase Auth sign-in;\nrole in roles/{uid}\nchecked by security rules'],
    ['Role-Gated\nDashboard Access', 'Admin / Worker / Viewer\nroutes unlocked based\non assigned role']],
  [['Reports & Historical\nRequests', 'Tank ID, date range\nfilters (7 / 14 / 30 days)'],
    ['Query Logs & Build Datasets', 'Filter RTDB telemetry & diagnostic logs by tank and range; build trend arrays and usage analytics (peak hours, peak day, forecasts)'],
    ['Interactive Analytics\n& Exportable Reports', 'Recharts trends, predictive analytics, Pump Activity Log & reports (PDF, Excel, CSV)']],
  [['Admin Calibration\n& Capacity Input', 'Vmin/Vmax, tankHeight, phSlope, phOffset, capacityLiters (per tank); live calibration view (calibrationUntil)'],
    ['Update Calibration\nParams in RTDB', 'Admin selects a tank\nand writes parameters\nto tanks/{id} fields'],
    ['Dynamic Sensor\nCalibration', 'ESP32 applies updated calibration on next poll; live readings once per second while the view is open']],
  [['Pump Command', 'pumpOn written by an Admin or the assigned Worker'],
    ['Rules Check & Controller Answer', 'Security rules allow the write while the lock is off; the ESP32 accepts or refuses it'],
    ['Pump State & Pump Activity Log', 'pumpCommandAt and pumpCommandResult; accepted or refused entry in /logs']],
  [['User Registry\nManagement', 'User details\nand role'],
    ['Register Auth &\nFirestore Profile', 'Firebase Auth user creation; profile in users/{uid}, name in directory/{uid}, role in roles/{uid}'],
    ['Active User Registry\nProfile', 'Profiles visible to admins only, with online status; others see names only']],
  [['Stored History, Logs\n& Notifications', 'Records with\ntimestamps'],
    ['Retention &\nHeartbeat', 'Delete records older than\n90 days (daily); heartbeat\nwritten every 10 s'],
    ['Lean Database &\nFail-Safe Alerting', 'Old records removed; if the heartbeat stops, Admin and Worker browsers check alerts & show "Alert Service Offline"']],
]);

const fig39 = () => ipo([
  [['Live telemetry from\nFirebase RTDB', 'waterLevel, waterHeight, phLevel, pumpOn, RSSI, status'],
    ['onValue listener,\nthrottle & stabilize UI', 'Smooth interpolation,\ndeadband, 1.5 s throttle'],
    ['Real-time tank cards\nwith water gauges', 'Level %, height, pH, safe/warning/danger badge, pump switch']],
  [['Alert & sensor fault\nstate from RTDB', 'lowLevelAlert,\nhighLevelAlert, phAlert,\nphSensorOk,\nlevelSensorOk'],
    ['Show alerts; fallback\nchecks', 'Toast & chime on new alerts; on Admin and Worker pages, SystemMonitor runs the 5 s and night checks only if the Alert Service stops'],
    ['Inline alert badges &\nsensor fault notices', 'CRITICAL / WARNING / RECOVERED / FAULT tags; "monitoring continues" notice']],
  [['Pump switch on a tank card', 'Admin, or a Worker on an assigned tank'],
    ['Write pumpOn, wait for the answer', 'Spinner until pumpCommandResult arrives (15 s timeout); command logged'],
    ['Pump state & result', 'Accepted, refused with the reason, or timed out']],
  [['Notification\nmessages from RTDB', 'notifications/ node,\ntype:\ninfo/warning/danger'],
    ['Sort, track unread\n& acknowledge', 'Record who acknowledged\nand when; read state in\nuserState/{uid}'],
    ['Notification center\nwith unread badge', 'Bell icon pulse,\nscrollable history,\nacknowledge action']],
  [['Push notifications\n(FCM)', 'Sent by the Alert\nService when an\nalert starts'],
    ['Register device &\nshow notification', 'Device token saved in\nuserState/{uid};\ntap opens the alert'],
    ['Alerts even when the\napp is closed', 'System notification on\nWeb & Android']],
  [['Reports request &\ndate range filter', 'Tank selection (any registered tank), 7 / 14 / 30-day range'],
    ['Query RTDB telemetry,\nbuild chart datasets', 'Recharts time-series charts, hourly/daily aggregation; predictive analytics computed in the browser'],
    ['Trend charts &\nexportable reports', 'Predictive analytics, Pump Activity Log, problem counts; PDF / Excel / CSV from the Reports page']],
  [['Audit log search &\ncategory filter', 'Keyword query; tabs\nAll / Alerts / System /\nErrors'],
    ['Filter logs/ node,\nhighlight matches', 'Regex-safe highlight, sort\nby timestamp desc'],
    ['Filtered audit log with\nhighlighted terms', 'Paginated list, clear-all\nfor admin role only']],
  [['Admin configuration\n& settings input', 'Shared and per-tank thresholds; night watch & tanks to watch; Pump System & pump mode; calibration & capacity of the selected tank; maintenance mode (all or one tank)'],
    ['Validate input, write\nto config/ & tanks/', 'updateConfig /\nupdateTank RTDB write,\ntoast confirm'],
    ['Updated system\nconfig & calibration\nsettings', 'Changes apply live,\nESP32 picks up on poll']],
  [['Live calibration view', 'Start or +10 min for one tank (30 min at most)'],
    ['Write calibrationUntil, listen to calibrationLive', 'Readings once per second; "Use as Vmin / Vmax / pH neutral" fills the form'],
    ['Live sensor readings', 'Level voltage, height, %, pH voltage; Save applies the values']],
  [['User management', 'New user, role\n(admin/worker/viewer)'],
    ['Register via\nsecondary Auth,\nFirestore profile', 'onSnapshot user list; activate/deactivate (no delete); online status'],
    ['Active user registry\nlist, role-based\naccess live', 'Admin panel user\ntable updated in real\ntime']],
  [['Tank assignment', 'Worker chosen for\neach tank'],
    ['Write assignedWorker\nto RTDB tanks/{id}', 'Saved with the tank,\nnot in Firestore'],
    ['Worker sees the\nassigned tank', 'Assignment shown in\nAdmin Panel and\ndashboard']],
]);

// ======================================================================
// Figure 3-10: Use Case Diagram
// Three columns inside the system boundary: A = what the people do, B = included / extending
// use cases, C = second-level and system use cases. Ellipses are sized from their text.
// ======================================================================
function fig310() {
  const W = PAGE_W, H = 1760, IMG = 'uc', FS = 19, AX = 200, BX = 575, CX = 870, SX = 945;
  let b = '';
  const E = {};
  const uc = (id, x, cy, t, kind = 'blue', leftAligned = false) => {
    const ls = lines(t), n = ls.length, ry = n === 1 ? 30 : n === 2 ? 38 : 50;
    const half = ((n - 1) * FS * 1.25) / 2 + FS * 0.42, k = Math.sqrt(1 - (half / ry) ** 2);
    const rx = Math.max(52, Math.max(...ls.map((l) => estW(l, FS, true))) / 2 / k + 8);
    E[id] = { cx: leftAligned ? x + rx : x, cy, rx, ry, t, kind };
  };
  const row = (n) => 62 + 84 * (n - 1) + (n >= 17 ? 12 : 0);
  const A = (id, cy, t) => uc(id, AX, cy, t, 'blue', true);
  // column A: left tips line up so the actor lines fan out without crossing other ellipses
  A('cfg', 314, 'Configure\nSystem');
  A('vsl', 554, 'View System\nLogs');
  A('mua', row(9), 'Manage User\nAccount');
  A('gar', row(12), 'Generate\nAnalytic\nReport');
  A('vnh', 1130, 'View\nNotification\nHistory');
  A('vd', row(15), 'View\nDashboard');
  A('ack', row(17), 'Acknowledge\nAlert');
  A('login', row(19), 'Login');
  // column B
  uc('setph', BX - 60, row(1), 'Set pH Level\nThreshold', 'green'); // shifted left so the include lines clear the ellipses below
  uc('setwl', BX, row(2), 'Set Water\nLevel Threshold', 'green');
  uc('cal', BX, row(3), 'Calibrate Sensors\n& Set Capacity', 'green');
  uc('awc', BX, row(4), 'Assign Water\nController', 'green');
  uc('loc', BX, row(5), 'Set Location', 'green');
  uc('pdm', BX, row(6), 'Set Pump\nSystem &\nPump Mode', 'green');
  uc('nw', BX - 60, row(7), 'Set Night Watch', 'green');
  uc('add', BX, row(8), 'Add User\n(with Role)', 'green');
  uc('onl', BX, row(9), 'View User\nOnline Status', 'green');
  uc('act', BX, row(10), 'Activate/Deactivate\nAccount', 'green');
  uc('vrd', BX, row(11), 'View Report\non Dashboard', 'green');
  uc('exp', BX, row(12), 'Export Report to\n(PDF/Excel/CSV)', 'green');
  uc('fd', BX, row(13), 'Filter Data', 'green');
  uc('mtt', BX, row(15), 'Monitor Tank\nTelemetry', 'bright');
  uc('rt', BX, row(17), 'Real-Time In-App /\nToast & Push Alert');
  uc('vc', BX, row(18), 'Validate\nCredentials', 'green');
  uc('cur', BX, row(19), 'Check User\nRole', 'green');
  uc('lus', BX, row(20), 'Load User\nSession', 'green');
  // column C and the system use cases
  uc('sel', CX, row(3), 'Select Tank', 'green');
  uc('live', CX, row(4), 'View Live\nSensor Readings', 'green');
  uc('own', CX, row(1), 'Set Own\nThresholds\nper Tank', 'green');
  uc('tmn', CX, row(6), 'Set Tank\nMaintenance', 'green');
  uc('twt', CX, row(7), 'Choose Tanks\nto Watch', 'green');
  uc('pa', CX, row(11), 'View Predictive\nAnalytics', 'green');
  uc('vdd', CX, row(15), 'View\nDashboard Data', 'green');
  uc('pump', CX, row(16), 'Switch Pump');
  uc('pd', SX, row(14), 'Provide\nData');
  uc('ra', SX, row(17), 'Raise Alert');
  uc('spn', SX, row(18), 'Send Push\nNotification');
  uc('dco', SX, row(19), 'Detect Controller\nOffline');
  uc('dnw', SX, row(20), 'Detect Night\nWater Loss');

  const edgePt = (e, tx, ty) => { // point on ellipse border toward (tx,ty)
    const dx = tx - e.cx, dy = ty - e.cy, k = 1 / Math.sqrt((dx * dx) / (e.rx * e.rx) + (dy * dy) / (e.ry * e.ry));
    return [e.cx + dx * k, e.cy + dy * k];
  };
  const rel = (from, to, kind, lx, ly) => { // dashed include / extend, arrow from -> to
    const a = E[from], c = E[to];
    const p1 = edgePt(a, c.cx, c.cy), p2 = edgePt(c, a.cx, a.cy);
    b += arrow([p1, p2], { dash: '6 5', sw: 1.4 });
    const mx = lx ?? (p1[0] + p2[0]) / 2, my = ly ?? (p1[1] + p2[1]) / 2;
    b += lbl(mx, my, `<<${kind}>>`, { size: 16, weight: 500, pad: 2 });
  };
  const assoc = (x, y, to) => { const c = E[to]; b += arrow([[x, y], [c.cx + (x < c.cx ? -c.rx : c.rx), c.cy]], { sw: 1.4 }); }; // ends at the side tip, so it never cuts across a neighbour

  const LX = 60, RX = 1132, AR = 46;
  const admin = [LX, 500], worker = [LX, 1014], viewer = [LX, 1414], iot = [RX, 1234], svc = [RX, 1560];
  for (const id of ['cfg', 'vsl', 'mua', 'gar', 'vnh', 'vd', 'ack', 'login']) assoc(admin[0] + AR + 4, admin[1], id);
  for (const id of ['vsl', 'gar', 'vnh', 'vd', 'ack', 'login']) assoc(worker[0] + AR + 4, worker[1], id);
  for (const id of ['vnh', 'vd', 'login']) assoc(viewer[0] + AR + 4, viewer[1], id);
  for (const id of ['pd', 'ra']) assoc(iot[0] - AR - 4, iot[1], id);
  for (const id of ['ra', 'spn', 'dco', 'dnw']) assoc(svc[0] - AR - 4, svc[1], id);

  for (const id of ['setph', 'setwl', 'cal', 'awc', 'loc', 'pdm', 'nw']) rel('cfg', id, 'include');
  rel('cal', 'sel', 'include'); rel('live', 'cal', 'extend');
  rel('vrd', 'pa', 'include');
  for (const id of ['add', 'onl', 'act']) rel(id, 'mua', 'extend');
  rel('own', 'setwl', 'extend'); rel('tmn', 'pdm', 'extend'); rel('twt', 'nw', 'extend');
  rel('gar', 'vrd', 'include'); rel('gar', 'fd', 'include'); rel('exp', 'gar', 'extend');
  rel('vd', 'mtt', 'include'); rel('mtt', 'vdd', 'include'); rel('pump', 'mtt', 'extend');
  rel('pd', 'mtt', 'include'); rel('pd', 'fd', 'include');
  rel('rt', 'vd', 'extend'); rel('rt', 'ack', 'extend'); rel('ra', 'rt', 'include');
  rel('login', 'vc', 'include'); rel('login', 'cur', 'include'); rel('login', 'lus', 'include');

  for (const e of Object.values(E)) {
    const fill = e.kind === 'green' ? C.green : e.kind === 'bright' ? C.bright : C.blue;
    b += `<ellipse cx="${e.cx.toFixed(1)}" cy="${e.cy}" rx="${e.rx.toFixed(1)}" ry="${e.ry}" fill="${fill}" stroke="#2B2F36" stroke-width="1.6"/>`;
    b += text(e.cx, e.cy, e.t, { size: FS, lh: 1.25 });
  }
  b += text(CX, row(16) + 54, '[Admin; Worker on assigned tank]', { size: 16, weight: 500 });
  b = rect(126, 12, 938, H - 24, { fill: 'none', rx: 3, stroke: '#111', sw: 1.6 }) + b;

  // actors: avatars from the original figure; Alert Service drawn in the same flat style
  const name = (p, t) => text(p[0], p[1] - AR - 14 - (lines(t).length - 1) * 13, t, { size: 20, lh: 1.25 });
  b += cropCircleAt(IMG, [139, 404, 62], ...admin, AR) + name(admin, 'Admin');
  b += cropCircleAt(IMG, [139, 900, 62], ...worker, AR) + name(worker, 'Worker');
  b += cropCircleAt(IMG, [139, 1420, 59], ...viewer, AR) + name(viewer, 'Viewer');
  b += cropCircleAt(IMG, [1710, 1030, 70], ...iot, AR) + name(iot, 'IoT Sensors\n(one per tank)');
  const [sx, sy] = svc;
  b += `<circle cx="${sx}" cy="${sy}" r="${AR}" fill="#6FAEDC"/>`;
  for (const dy of [-24, -5, 14]) {
    b += `<rect x="${sx - 26}" y="${sy + dy}" width="52" height="15" rx="3.5" fill="#111"/>`;
    b += `<circle cx="${sx + 16}" cy="${sy + dy + 7.5}" r="3" fill="#6FAEDC"/><rect x="${sx - 19}" y="${sy + dy + 5.5}" width="18" height="4" rx="1.5" fill="#6FAEDC"/>`;
  }
  b += name(svc, 'Alert\nService');
  return svg(W, H, b, imageDef(IMG, 'old-3-10-use-case.png', 1812, 1713));
}

// ======================================================================
// Figure 3-11: Activity Diagram (vertical swimlanes, so it fits the page width)
// ======================================================================
function fig311() {
  const W = PAGE_W, H = 1160, top = 10, bot = 1150, headH = 50, F = 22, D = '9 7';
  const lanes = [[10, 330, 'IoT System'], [330, 590, 'Alert Service'], [590, 890, 'Operator'], [890, 1190, 'Admin']];
  let b = `<clipPath id="al"><rect x="10" y="${top}" width="1180" height="${bot - top}" rx="10"/></clipPath>`;
  b += `<g clip-path="url(#al)"><rect x="10" y="${top}" width="1180" height="${headH}" fill="${C.head}"/></g>`;
  b += `<rect x="10" y="${top}" width="1180" height="${bot - top}" rx="10" fill="none" stroke="#111" stroke-width="2.5"/>`;
  b += `<line x1="10" y1="${top + headH}" x2="1190" y2="${top + headH}" stroke="#111" stroke-width="2.5"/>`;
  for (const [x1, x2, name] of lanes) {
    if (x1 > 10) b += `<line x1="${x1}" y1="${top}" x2="${x1}" y2="${bot}" stroke="#111" stroke-width="2.5"/>`;
    b += text((x1 + x2) / 2, top + headH / 2, name, { size: 25 });
  }
  const dashed = (pts) => arrow(pts, { dash: D, sw: 2.5 });
  // IoT System
  for (const [y1, y2] of [[120, 147], [223, 255], [311, 343], [419, 451], [527, 559], [635, 667], [837, 887]]) b += arrow([[170, y1], [170, y2]]);
  b += dashed([[30, 752], [20, 752], [20, 1128], [1040, 1128], [1040, 1090]]);
  b += dashed([[300, 915], [352, 915]]);
  // Alert Service
  b += arrow([[460, 953], [460, 987]]);
  b += dashed([[568, 1025], [579, 1025], [579, 150], [615, 150]]);
  // Operator
  b += arrow([[740, 202], [740, 242]]) + arrow([[740, 318], [740, 362]]) + arrow([[740, 438], [740, 482]]);
  b += dashed([[865, 520], [915, 520]]);
  // Admin
  b += arrow([[1040, 588], [1040, 632]]) + arrow([[1040, 708], [1040, 752]]) + arrow([[1040, 828], [1040, 867]]) + arrow([[1040, 1003], [1040, 1040]]);
  b += lbl(170, 858, 'Yes', { size: 20 }) + text(28, 870, 'No', { size: 20, anchor: 'start' });
  // nodes
  b += term(170, 95, 130, 50, 'Start', { size: 24 });
  b += box(170, 185, 260, 76, 'Read Water Level\n(Hydrostatic)', { size: F });
  b += box(170, 283, 260, 56, 'Read pH Sensor', { size: F });
  b += box(170, 381, 260, 76, 'Process & Evaluate\nThresholds', { size: F });
  b += box(170, 489, 260, 76, 'Log Telemetry\nto Database', { size: F });
  b += box(170, 597, 260, 76, 'Update Live\nDashboard', { size: F });
  b += dec(170, 752, 280, 170, 'Critical Value\nfor 5 Seconds?', { size: 21 });
  b += box(170, 915, 260, 56, 'Log Alert Event', { size: F });
  b += box(460, 915, 216, 76, 'Create Alert\nNotification', { size: F });
  b += box(460, 1025, 216, 76, 'Send Push\nNotification', { size: F });
  b += box(740, 150, 250, 104, 'Receive Real-Time\nToast, Chime &\nPush Alert', { size: F });
  b += box(740, 280, 250, 76, 'Inspect Tank\nStatus', { size: F });
  b += box(740, 400, 250, 76, 'Acknowledge Alert\n(Silence Chime)', { size: F });
  b += box(740, 520, 250, 76, 'Perform On-Site\nManual Inspection', { size: F });
  b += box(1040, 520, 250, 136, 'Receive System\nAlert\n(Simultaneous\nBroadcast)', { size: F });
  b += box(1040, 670, 250, 76, 'Monitor Real-Time\nTelemetry', { size: F });
  b += box(1040, 790, 250, 76, 'Inspect System\nDiagnostic Logs', { size: F });
  b += box(1040, 935, 250, 136, 'Verify Telemetry\nStabilization\n(Alert Resolves\nAfter 5 s)', { size: F });
  b += term(1040, 1065, 150, 50, 'End', { size: 24 });
  return svg(W, H, b);
}

// ======================================================================
// Figures 3-12 and 3-13 (Data Model): Cloud Firestore and Firebase Realtime Database
// Two portrait figures sized for a 6.5-inch page width (text about 8-9 pt when inserted full width):
//   Figure 3-12: Firestore, the RTDB path tree, ROLES, USER_STATE, CONFIG, SYSTEM
//   Figure 3-13: TANKS, HISTORY, NOTIFICATIONS, LOGS
// They replace the ERD (removed 2026-11-22: the adviser asked for the Firebase data model instead).
// ======================================================================
const DM = { W: 1540, TW: 720, ROW: 44, COL: [30, 790], FS: '#FCE8CC', RT: '#D6E4F5', MONO: 'Consolas, monospace' };
function dmKit() {
  const { TW, ROW, RT, MONO } = DM;
  const k = { b: '' };
  k.tbl = (x, y, title, path, by, rows, fill = RT) => {
    const subs = lines(by), hh = 74 + subs.length * 28, h = hh + rows.length * ROW;
    let s = `<rect x="${x}" y="${y}" width="${TW}" height="${hh}" fill="${fill}"/>`;
    s += text(x + 18, y + 32, title, { size: 32, anchor: 'start', family: ARIAL });
    s += text(x + TW - 18, y + 32, path, { size: 24, anchor: 'end', fill: '#1F3A5F', family: MONO });
    subs.forEach((l, i) => { s += text(x + 18, y + 72 + i * 28, (i ? '' : 'Written by: ') + l, { size: 21, weight: 400, italic: true, anchor: 'start', fill: '#222', family: ARIAL }); });
    rows.forEach(([name, type], i) => {
      const ry = y + hh + i * ROW;
      s += `<rect x="${x}" y="${ry}" width="${TW}" height="${ROW}" fill="${i % 2 ? '#F2F2F2' : '#FFFFFF'}"/>`;
      s += `<line x1="${x}" y1="${ry}" x2="${x + TW}" y2="${ry}" stroke="#BBBBBB"/>`;
      s += text(x + 18, ry + ROW / 2, name, { size: 27, weight: 400, anchor: 'start', family: ARIAL });
      s += text(x + 548, ry + ROW / 2, type, { size: 23, weight: 400, anchor: 'start', fill: '#333', family: ARIAL });
    });
    s += `<line x1="${x + 534}" y1="${y + hh}" x2="${x + 534}" y2="${y + h}" stroke="#BBBBBB"/>`;
    s += `<line x1="${x}" y1="${y + hh}" x2="${x + TW}" y2="${y + hh}" stroke="#111" stroke-width="2.5"/>`;
    s += `<rect x="${x}" y="${y}" width="${TW}" height="${h}" fill="none" stroke="#111" stroke-width="2.5"/>`;
    k.b += s;
    return y + h;
  };
  // path pill: fixed names are filled, generated keys ({...}) are dashed and white
  k.pill = (x, y, t) => {
    const key = t.startsWith('{'), w = textW(t, 21, 0.6) + 26;
    k.b += `<rect x="${x}" y="${y - 21}" width="${w}" height="42" rx="21" fill="${key ? '#FFFFFF' : RT}" stroke="#111" stroke-width="2"${key ? ' stroke-dasharray="7 5"' : ''}/>`;
    k.b += text(x + w / 2, y, t, { size: 21, weight: key ? 400 : 700, family: MONO });
    return x + w;
  };
  k.chain = (x, y, parts) => {
    let cx = x;
    parts.forEach((p, i) => {
      if (i) { k.b += `<line x1="${cx}" y1="${y}" x2="${cx + 18}" y2="${y}" stroke="#111" stroke-width="2"/>`; cx += 18; }
      cx = k.pill(cx, y, p);
    });
    return cx;
  };
  k.note = (x, y, t, o = {}) => { k.b += text(x, y, t, { size: 21, weight: 400, italic: true, anchor: 'start', fill: '#333', family: ARIAL, ...o }); };
  k.legend = (x, y, h, items) => {
    k.b += `<rect x="${x}" y="${y}" width="${TW}" height="${h}" fill="#FFF" stroke="#888" stroke-width="2"/>`;
    k.b += text(x + 20, y + 34, 'Legend', { size: 27, anchor: 'start', family: ARIAL });
    let ly = y + 82;
    for (const it of items) {
      const lab = (t, o = {}) => text(x + 130, ly, t, { size: 23, weight: 400, anchor: 'start', family: ARIAL, ...o });
      if (it.swatch) k.b += `<rect x="${x + 30}" y="${ly - 15}" width="70" height="30" fill="${it.swatch}" stroke="#888"/>` + lab(it.t);
      else if (it.pill) { k.pill(x + 24, ly, it.pill); k.b += lab(it.t); }
      else k.b += text(x + 30, ly, it.t, { size: 23, weight: 400, anchor: 'start', fill: it.grey ? '#444' : C.ink, family: ARIAL });
      ly += it.gap || 50;
    }
  };
  return k;
}

function figDataModel1() {
  const { W, TW, COL, FS, RT, MONO } = DM, H = 2370;
  const k = dmKit();
  // ---- column 1: Firestore, ROLES, USER_STATE, legend
  let x = COL[0];
  k.b += `<rect x="${x}" y="30" width="${TW}" height="270" fill="${FS}" stroke="#111" stroke-width="2.5"/>`;
  k.b += text(x + 18, 64, 'Cloud Firestore (document database)', { size: 29, anchor: 'start', family: ARIAL });
  for (const [cy, coll] of [[124, 'users'], [196, 'directory']]) {
    k.b += `<rect x="${x + 30}" y="${cy - 26}" width="170" height="52" rx="4" fill="#FFF" stroke="#111" stroke-width="2"/>` + text(x + 115, cy, coll, { size: 24, family: MONO });
    k.b += `<line x1="${x + 200}" y1="${cy}" x2="${x + 240}" y2="${cy}" stroke="#111" stroke-width="2"/>`;
    k.b += `<rect x="${x + 240}" y="${cy - 26}" width="140" height="52" rx="4" fill="#FFF" stroke="#111" stroke-width="2" stroke-dasharray="7 5"/>` + text(x + 310, cy, '{uid}', { size: 24, weight: 400, family: MONO });
  }
  k.note(x + 115, 256, 'collection', { anchor: 'middle' });
  k.note(x + 310, 256, 'document (Auth UID)', { anchor: 'middle' });
  k.note(x + 400, 160, 'two collections;\nall other paths\nare denied');
  const usersEnd = k.tbl(x, 330, 'USERS', 'users/{uid}', ['Admin Panel (create, role, status);', 'read: the user (own) and admins'], [
    ['id', 'STRING'], ['username', 'STRING'], ['email', 'STRING'], ['role (admin | worker | viewer)', 'STRING'],
    ['jobTitle', 'STRING'], ['status (active | inactive)', 'STRING'], ['createdAt', 'TIMESTAMP']], FS);
  k.b += arrow([[x + 360, usersEnd], [x + 360, usersEnd + 102]], { dash: '10 7', sw: 2.5 });
  k.note(x + 380, usersEnd + 50, 'role copied on create and change;\nremoved when inactive');
  const rolesEnd = k.tbl(x, usersEnd + 110, 'ROLES', 'roles/{uid}', 'Admin Panel; read by database rules', [
    ['(value) admin|worker|viewer|device', 'STRING']]);
  k.note(x, rolesEnd + 30, 'device = an ESP32 controller account (one per tank)');
  const usEnd = k.tbl(x, rolesEnd + 76, 'USER_STATE', 'userState/{uid}', 'web app or APK, only by the same user', [
    ['notificationsLastReadAt', 'TIMESTAMP'], ['notificationsReadIds/{alertId}', 'BOOLEAN'],
    ['fcmTokens/{token}/platform', 'STRING'], ['fcmTokens/{token}/updatedAt', 'TIMESTAMP']]);
  const prEnd = k.tbl(x, usEnd + 40, 'PRESENCE', 'presence/{uid}', 'each user, for themselves; read by admins', [
    ['connections/{id}/since', 'TIMESTAMP'], ['connections/{id}/app (web | android)', 'STRING'], ['lastSeen', 'TIMESTAMP']]);
  k.legend(x, prEnd + 40, 280, [
    { swatch: FS, t: 'Cloud Firestore' }, { swatch: RT, t: 'Firebase Realtime Database' },
    { pill: 'tanks', t: 'fixed path name', gap: 56 }, { pill: '{key}', t: 'generated key (ID, UID, push key)', gap: 50 },
  ]);

  // ---- column 2: RTDB path tree, CONFIG, SYSTEM
  x = COL[1];
  const tree = [
    [['tanks', '{tankId}'], 'TANKS'], [['config'], 'CONFIG'], [['history', 'tanks', '{tankId}', '{pushKey}'], 'HISTORY'],
    [['logs', '{pushKey}'], 'LOGS'], [['notifications', '{alertId}'], 'NOTIFICATIONS'], [['roles', '{uid}'], 'ROLES'],
    [['userState', '{uid}'], 'USER_STATE'], [['presence', '{uid}'], 'PRESENCE'], [['system', 'worker'], 'SYSTEM'],
    [['system', 'nightWatch', '{tankId}'], 'SYSTEM'],
  ];
  const tH = 160 + tree.length * 68;
  k.b += `<rect x="${x}" y="30" width="${TW}" height="${tH}" fill="#FFF" stroke="#111" stroke-width="2.5"/>`;
  k.b += text(x + 18, 64, 'Realtime Database (one JSON tree)', { size: 29, anchor: 'start', family: ARIAL });
  k.b += `<rect x="${x + 22}" y="96" width="50" height="40" rx="20" fill="#111"/>` + text(x + 47, 116, '/', { size: 22, fill: '#FFF', family: MONO });
  const trunk = x + 47;
  tree.forEach(([parts, ent], i) => {
    const y = 180 + i * 68;
    k.b += `<polyline points="${trunk},${i ? y - 68 : 136} ${trunk},${y} ${trunk + 24},${y}" fill="none" stroke="#111" stroke-width="2"/>`;
    const end = k.chain(trunk + 24, y, parts);
    if (end < x + 520) k.note(x + 530, y, ent, { size: 20 });
  });
  k.note(x + 18, 30 + tH - 26, 'Each path leads to the table of the same name.', { size: 20 });
  const cfgEnd = k.tbl(x, 30 + tH + 40, 'CONFIG', 'config', ['Admin Panel (shared by all tanks; a tank\'s', 'own limits are in tanks/{id}/thresholds)'], [
    ['lowLevelThreshold (%, default 15)', 'NUMBER'], ['overflowThreshold (%, default 95)', 'NUMBER'],
    ['minPh (default 6.5)', 'NUMBER'], ['maxPh (default 8.5)', 'NUMBER'], ['maintenanceMode', 'BOOLEAN'],
    ['pumpControlLock', 'BOOLEAN'], ['pumpDemoMode (Pump System)', 'BOOLEAN'], ['pumpMode (auto or manual)', 'STRING'],
    ['offlineThresholdSec (default 30)', 'NUMBER'], ['repeatIntervalSec (default 60)', 'NUMBER'], ['soundEnabled', 'BOOLEAN'], ['pushEnabled', 'BOOLEAN'],
    ['nightWatchEnabled (missing = on)', 'BOOLEAN'], ['nightStartHour, nightEndHour (22, 3)', 'NUMBER'],
    ['nightFastDropPercent (default 5)', 'NUMBER'], ['nightSlowDropPercent (default 3)', 'NUMBER'],
    ['nightWatchTanks/{tankId} (missing = on)', 'BOOLEAN']]);
  const sysEnd = k.tbl(x, cfgEnd + 40, 'SYSTEM', 'system', ['Alert Service: heartbeat, and the night watch', 'state (saved at most once a minute)'], [
    ['worker/lastSeen', 'TIMESTAMP'], ['worker/startedAt', 'TIMESTAMP'], ['nightWatch/{tankId} (leak-check state)', 'OBJECT']]);
  k.tbl(x, sysEnd + 40, 'USER_DIRECTORY', 'directory/{uid}', ['Admins (create, rename, sync);', 'read by all signed-in users'], [
    ['username (name only)', 'STRING']], FS);
  return svg(W, H, k.b);
}

function figDataModel2() {
  const { W, COL, RT } = DM, H = 2230;
  const k = dmKit();
  let x = COL[0];
  const tnkEnd = k.tbl(x, 30, 'TANKS', 'tanks/{tankId}', ['ESP32 (live readings, pumpFault), Admin (setup,', 'calibration, capacity, thresholds, maintenance),', 'Worker (pumpOn), Alert Service (controllerOffline)'], [
    ['id ("1" to "999")', 'STRING'], ['name', 'STRING'], ['location', 'STRING'], ['enabled', 'BOOLEAN'], ['assignedWorker (user UID)', 'STRING'],
    ['waterLevel (%)', 'NUMBER'], ['waterHeight (m)', 'NUMBER'], ['phLevel', 'NUMBER'], ['status (safe|warning|danger|offline)', 'STRING'],
    ['lowLevelAlert', 'STRING'], ['highLevelAlert', 'STRING'], ['phAlert', 'STRING'], ['pumpOn (state and command)', 'BOOLEAN'],
    ['pumpCommandAt', 'TIMESTAMP'], ['pumpCommandResult', 'STRING'],
    ['levelSensorOk', 'BOOLEAN'], ['phSensorOk', 'BOOLEAN'], ['levelVmin (V)', 'NUMBER'], ['levelVmax (V)', 'NUMBER'],
    ['tankHeight (m)', 'NUMBER'], ['capacityLiters (default 200)', 'NUMBER'], ['levelOffset', 'NUMBER'], ['phNeutralVoltage (V)', 'NUMBER'],
    ['phSlope', 'NUMBER'], ['phOffset', 'NUMBER'], ['rssi (dBm)', 'NUMBER'], ['wifiConnected', 'BOOLEAN'], ['ethConnected', 'BOOLEAN'],
    ['firebaseConnected', 'BOOLEAN'], ['controllerOffline', 'BOOLEAN'], ['calibrationUntil (max 30 min ahead)', 'TIMESTAMP'],
    ['calibrationLive (V, m, %, pH V)', 'OBJECT'], ['thresholds (own low, overflow, pH)', 'OBJECT'],
    ['maintenanceMode (this tank)', 'BOOLEAN'], ['pumpFault (no-rise | max-run)', 'STRING'], ['lastUpdate', 'TIMESTAMP']]);
  k.tbl(x, tnkEnd + 40, 'HISTORY', 'history/tanks/{tankId}/{pushKey}', 'ESP32, one sample every 10 minutes', [
    ['waterLevel', 'NUMBER'], ['waterHeight', 'NUMBER'], ['phLevel', 'NUMBER'], ['pumpOn', 'BOOLEAN'],
    ['levelSensorOk, phSensorOk', 'BOOLEAN'], ['timestamp (indexed)', 'TIMESTAMP']]);

  x = COL[1];
  const ntfEnd = k.tbl(x, 30, 'NOTIFICATIONS', 'notifications/{alertId}', ['Alert Service (or open Admin and Worker', 'dashboards while it is down); users acknowledge'], [
    ['id (alert-{tankId}-{type})', 'STRING'], ['tankId', 'STRING'], ['title', 'STRING'], ['message', 'STRING'], ['type (info | warning | danger)', 'STRING'],
    ['timestamp (indexed)', 'TIMESTAMP'], ['read', 'BOOLEAN'], ['acknowledged', 'BOOLEAN'], ['acknowledgedBy (name)', 'STRING'],
    ['acknowledgedByUid', 'STRING'], ['acknowledgedAt', 'TIMESTAMP'], ['resolved', 'BOOLEAN'], ['resolvedAt', 'TIMESTAMP'], ['lastRepeatedAt', 'TIMESTAMP']]);
  const logEnd = k.tbl(x, ntfEnd + 40, 'LOGS', 'logs/{pushKey}', 'ESP32, web app, Alert Service (append only)', [
    ['id', 'STRING'], ['tankId (none = Tank 1)', 'STRING'], ['action', 'STRING'], ['details', 'STRING'],
    ['performedBy (name)', 'STRING'], ['logLevel (see legend)', 'STRING'], ['timestamp (indexed)', 'TIMESTAMP']]);
  k.legend(x, logEnd + 40, 400, [
    { t: 'logLevel = INFO | WARNING | ERROR | CRITICAL' },
    { swatch: RT, t: 'Firebase Realtime Database' },
    { t: 'TIMESTAMP = milliseconds since 1970' },
    { t: '{tankId} = "1" to "999" (one record per tank)' },
    { t: 'Records older than 90 days are deleted daily', grey: true, gap: 32 },
    { t: 'by the Alert Service (notifications, logs, history).', grey: true },
  ]);
  return svg(W, H, k.b);
}

// ======================================================================
// Figure 3-14: Architectural Design (photos from the original figure)
// Top row: sensor node, bridge, router. Bottom row: cloud services and the client.
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
  const W = PAGE_W, H = 940, IMG = 'arch', NET = 'net';
  const P = (x, y, t, size = 19) => text(x, y, t, { size, family: POPPINS, weight: 600, lh: 1.35 });
  const A = (pts, o) => arrow(pts, { sw: 2.5, color: '#000', ...o });
  let b = '';
  // wiring inside the sensor node
  b += A([[196, 151], [272, 151]]);
  b += A([[388, 151], [405, 151], [405, 300], [423, 300]]);
  b += A([[192, 380], [423, 380]]);
  b += A([[545, 262], [545, 230]]);
  // bridge and router
  b += A([[647, 172], [758, 172]]);
  b += A([[822, 172], [888, 172]], { dash: '8 6', start: true });
  b += A([[952, 172], [1016, 172]]);
  b += A([[508, 466], [508, 545], [1000, 545], [1000, 215], [1016, 215]], { dash: '8 6' });
  // cloud and client
  b += A([[1075, 243], [1075, 612]]) + A([[1105, 612], [1105, 243]]);
  b += A([[852, 690], [1032, 690]], { start: true });
  b += A([[748, 690], [572, 690]]);
  b += A([[468, 690], [362, 690]], { dash: '8 6' });
  b += A([[1090, 822], [1090, 860], [252, 860], [252, 822]], { start: true });
  // photos and icons
  b += crop(IMG, [15, 165, 136, 110], 25, 85, 163, 132);
  b += crop(IMG, [15, 360, 139, 112], 30, 318, 154, 124);
  b += crop(IMG, [285, 260, 145, 125], 425, 262, 167, 144);
  b += crop(IMG, [466, 70, 126, 95], 500, 118, 145, 109);
  b += crop(NET, [325, 145, 55, 155], 760, 88, 60, 169);
  b += crop(NET, [680, 145, 55, 155], 890, 88, 60, 169);
  b += crop(IMG, [630, 255, 140, 130], 1018, 110, 140, 130);
  b += crop(IMG, [873, 245, 106, 140], 1037, 615);
  b += crop(IMG, [1130, 255, 170, 105], 150, 630, 204, 126);
  // current-to-voltage module, drawn as a small board
  b += `<rect x="274" y="115" width="112" height="72" rx="6" fill="#2B5C9E" stroke="#1B3B66" stroke-width="2"/>`;
  b += `<rect x="286" y="127" width="28" height="22" rx="2" fill="#4A90E2" stroke="#FFF"/><rect x="330" y="129" width="44" height="18" rx="2" fill="#111"/>`;
  for (let i = 0; i < 4; i++) b += `<rect x="${292 + i * 20}" y="165" width="10" height="16" fill="#E2B33B"/>`;
  b += serverIcon(800, 690) + bellIcon(520, 690);
  // pump relay on GPIO 32 (installed on Tank 1, the Pilot Test Tank)
  b += rect(620, 300, 62, 44, { fill: '#FFF', rx: 5, stroke: '#111', sw: 2 });
  b += A([[594, 322], [620, 322]]);
  b += P(651, 322, 'Relay', 17) + P(651, 386, 'GPIO 32\n(Refill\nPump)', 16);
  // one sensor node per tank: the group is repeated at every registered tank
  b += rect(8, 50, 682, 452, { fill: 'none', rx: 14, stroke: '#555', sw: 2, dash: '10 7' });
  b += P(349, 28, 'One Sensor Node per Registered Tank');
  // labels
  b += P(112, 262, 'Hydrostatic Water\nLevel Sensor\n(4–20 mA)');
  b += P(330, 85, 'Current-to-Voltage\nModule');
  b += P(110, 469, 'pH Sensor\n(PH-4502C)');
  b += P(508, 436, 'ESP32\nMicrocontroller');
  b += P(572, 85, 'W5500\nEthernet Module');
  b += P(855, 45, 'TP-Link CPE210\nP2P Bridge (2.4GHz)');
  b += P(725, 152, 'RJ45', 17);
  b += P(1088, 60, 'Internet\nConnection\n(Wireless Router)');
  b += lbl(754, 545, 'Standby: 2.4GHz Wi-Fi\n(Used if Ethernet Goes Down)', { size: 18, family: POPPINS, weight: 500 });
  b += P(1090, 790, 'Firebase Cloud\nService');
  b += P(800, 775, 'Cloud-Hosted\nAlert Service');
  b += P(520, 775, 'Firebase Cloud\nMessaging (FCM)');
  b += lbl(415, 690, 'Push', { size: 18, family: POPPINS, weight: 500 });
  b += P(252, 790, 'Web & Mobile\nDashboard Client');
  b += P(250, 540, 'Physical Perception Layer', 24) + P(820, 905, 'Network & Cloud Infrastructure Layer', 24) + P(252, 905, 'Client Application Layer', 24);
  return svg(W, H, b, imageDef(IMG, 'old-3-13-architecture.png', 1385, 579) + imageDef(NET, 'old-3-14-network.png', 1430, 523));
}

// ======================================================================
// Figure 3-15: Network Design Topology (photos from the original figure, labels redrawn larger)
// ======================================================================
function fig314() {
  const W = PAGE_W, H = 815, NET = 'net', IMG = 'arch';
  const P = (x, y, t, size = 19, o = {}) => text(x, y, t, { size, family: POPPINS, weight: 600, lh: 1.3, ...o });
  const A = (pts, o) => arrow(pts, { sw: 2.5, color: '#000', ...o });
  let b = '';
  // cloud, above the router
  b += crop(IMG, [873, 245, 106, 140], 969, 12);
  b += P(1022, 180, 'Firebase Cloud\nServices');
  b += serverIcon(720, 82, 50);
  b += P(720, 165, 'Cloud-Hosted\nAlert Service');
  b += A([[774, 82], [962, 82]], { start: true }) + P(868, 62, 'Internet', 17);
  b += A([[1022, 210], [1022, 282]], { start: true }) + P(1008, 246, 'Internet /\nWAN Link', 17, { anchor: 'end' });
  // sensor site to the office
  b += A([[192, 360], [272, 360], [272, 235], [880, 235], [880, 360], [947, 360]], { start: true });
  b += lbl(576, 235, 'Primary Link: W5500 Ethernet + P2P Wireless Bridge', { size: 17, family: POPPINS, weight: 600 });
  b += A([[192, 400], [296, 400]], { start: true }) + A([[800, 400], [947, 400]], { start: true });
  b += A([[100, 458], [100, 590], [985, 590], [985, 450]], { dash: '9 7', start: true });
  b += lbl(542, 590, 'Standby Link: Built-in 2.4GHz Wi-Fi (Used if Ethernet Goes Down)', { size: 17, family: POPPINS, weight: 600 });
  b += crop(NET, [15, 162, 168, 136], 20, 318);
  b += P(135, 280, 'ESP32 Microcontroller\nNode');
  b += crop(NET, [325, 145, 62, 172], 300, 300) + crop(NET, [396, 192, 64, 82], 370, 345);
  b += P(548, 386, '2.4GHz P2P Link\n(15–20 m in Testing)', 17);
  b += crop(NET, [603, 192, 64, 82], 662, 345) + crop(NET, [680, 145, 62, 172], 734, 300);
  b += P(331, 510, 'TP-Link CPE210\n(Client / Station)') + P(765, 510, 'TP-Link CPE210\n(Access Point)');
  b += P(1022, 300, 'Wireless Router');
  b += crop(NET, [882, 164, 138, 128], 953, 318);
  // wireless clients
  b += crop(NET, [1045, 278, 66, 74], 1098, 446);
  b += crop(NET, [1168, 328, 244, 122], 950, 625);
  b += P(1085, 776, 'Client Dashboard\nEndpoints');
  b += P(240, 690, 'Sensor Site: One ESP32 Node per\nTank (Tank 1: Pilot Test Tank,\n200 L Drum; Other Tanks Planned)', 18);
  b += P(690, 700, 'Motor Pool Office / Gateway', 24, { weight: 700 });
  return svg(W, H, b, imageDef(IMG, 'old-3-13-architecture.png', 1385, 579) + imageDef(NET, 'old-3-14-network.png', 1430, 523));
}

// ======================================================================
// Figure 3-1: Iterative and Incremental Agile Methodology Cycle
// Three increments; each repeats Analyze, Plan, Design, Build, Test and ends in a working release.
// ======================================================================
function fig31() {
  // Ring-and-arrow style: each increment is a ring of five chevron segments (the phases, clockwise
  // from the top), sitting on one arrow band that carries the work from increment to increment.
  const W = PAGE_W, H = 395, CY = 195, RO = 162, RI = 96, RM = (RO + RI) / 2, F = 19;
  const NAVY = '#0E3B70';
  const shades = ['#4A9AD8', '#3584C6', '#2470B2', '#175A98', '#0E4580']; // Analyze (light) to Test (dark)
  const phases = ['Analyze', 'Plan', 'Design', 'Build', 'Test'];
  const incs = [
    [200, '1'], [600, '2'], [1000, '3'],
  ];
  const rad = (d) => d * Math.PI / 180;
  const pt = (cx, a, r) => `${(cx + r * Math.cos(rad(a))).toFixed(1)},${(CY + r * Math.sin(rad(a))).toFixed(1)}`;
  const TIP = 6; // degrees the chevron point reaches into the next segment
  let b = '';

  // arrow band (drawn first, the rings sit on top of it)
  const BT = 300, BB = 372, BM = (BT + BB) / 2, D = 30;
  [[10, 400], [400, 800], [800, 1160]].forEach(([x1, x2], i) => {
    const tip = i === 2 ? 1192 : x2 + D;
    b += `<polygon points="${x1},${BT} ${x2},${BT} ${tip},${BM} ${x2},${BB} ${x1},${BB} ${x1 + D},${BM}" fill="${i === 2 ? '#5DB2EC' : NAVY}" stroke="#FFFFFF" stroke-width="3" stroke-linejoin="round"/>`;
  });

  for (const [cx, n] of incs) {
    // white halo so the ring stands off the band
    b += `<circle cx="${cx}" cy="${CY}" r="${RO + 5}" fill="#FFFFFF"/>`;
    phases.forEach((p, i) => {
      const a1 = -126 + i * 72, a2 = a1 + 72;
      b += `<path d="M${pt(cx, a1, RO)} A${RO},${RO} 0 0 1 ${pt(cx, a2, RO)} L${pt(cx, a2 + TIP, RM)} L${pt(cx, a2, RI)} ` +
        `A${RI},${RI} 0 0 0 ${pt(cx, a1, RI)} L${pt(cx, a1 + TIP, RM)} Z" fill="${shades[i]}" stroke="#FFFFFF" stroke-width="3" stroke-linejoin="round"/>`;
      const am = a1 + 36 + TIP / 2;
      b += text(cx + RM * Math.cos(rad(am)), CY + RM * Math.sin(rad(am)), p, { size: F, fill: '#FFFFFF' });
    });
    b += `<circle cx="${cx}" cy="${CY}" r="${RI - 6}" fill="#FFFFFF"/>`;
    b += text(cx, CY - 20, 'Increment', { size: 22, fill: NAVY, family: POPPINS });
    b += text(cx, CY + 22, n, { size: 46, fill: NAVY, family: POPPINS });
  }
  return svg(W, H, b);
}

export const figures = [
  ['Figure 3-1: Iterative and Incremental Agile Methodology Cycle for the Project\'s Development', fig31],
  ['Figure 3-4: Proposed Operational Workflow of MPWSD', fig34],
  ['Figure 3-5: System Data Processing and Logic Flowchart', fig35],
  ['Figure 3-6: Hierarchical Input-Process-Output (HIPO) Model', fig36],
  ['Figure 3-7: Input-Process-Output (IPO) for the IoT System', fig37],
  ['Figure 3-8: Input-Process-Output (IPO) Model for Backend Server and Application Logic', fig38],
  ['Figure 3-9: Input-Process-Output (IPO) Model for Web Dashboard and Mobile Application', fig39],
  ['Figure 3-10: Use Case Diagram for the Water Level and Quality Monitoring System', fig310],
  ['Figure 3-11: Activity Diagram', fig311],
  ['Figure 3-12: Data Model of the Cloud Firestore and Realtime Database Structure', figDataModel1],
  ['Figure 3-13: Data Model of the Realtime Database Tank, History, Notification and Log Records', figDataModel2],
  ['Figure 3-14: Architectural Design of the System', fig313],
  ['Figure 3-15: Network Design Topology', fig314],
].map(([title, draw]) => ({ title, file: title.split(':')[0].replace(/\s+/g, '_'), draw }));
