#!/usr/bin/env node
/**
 * Creates the firmware folder for a new tank (Tank 5 and up) from the Tank 4 sketch.
 *
 *   npm run firmware:new-tank -- 5
 *
 * Writes backend/firmware/tank5/tank5.ino (TANK_ID = 5) and its secrets.example.h.
 * The Tank 2–4 sketches differ only in TANK_ID, so the copy is the same controller.
 * Never overwrites an existing folder. Next: register the tank in Admin Panel → Tank
 * Assignment, create its device account, copy secrets.example.h to secrets.h, upload.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_TANK_ID = 999; // same as MAX_TANK_ID in frontend/src/lib/constants.ts

const firmwareDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'firmware');
const arg = process.argv[2] ?? '';

if (!/^[1-9]\d*$/.test(arg) || Number(arg) > MAX_TANK_ID) {
  console.error(`Usage: npm run firmware:new-tank -- <tank id>   (a whole number from 5 to ${MAX_TANK_ID})`);
  process.exit(1);
}
const id = Number(arg);
if (id <= 4) {
  console.error(`Tank ${id} already has firmware: ${id === 1 ? 'backend/firmware/esp32_firmware.ino' : `backend/firmware/tank${id}/`}`);
  process.exit(1);
}

const target = join(firmwareDir, `tank${id}`);
if (existsSync(target)) {
  console.error(`backend/firmware/tank${id}/ already exists; nothing was changed.`);
  process.exit(1);
}

const replaceOnce = (text, from, to, file) => {
  if (!text.includes(from)) {
    console.error(`Could not find "${from}" in ${file}; the Tank 4 sketch has changed. Nothing was written.`);
    process.exit(1);
  }
  return text.replace(from, to);
};

const sketchSrc = join(firmwareDir, 'tank4', 'tank4.ino');
const secretsSrc = join(firmwareDir, 'tank4', 'secrets.example.h');
const sketch = replaceOnce(readFileSync(sketchSrc, 'utf8'), 'const int TANK_ID = 4;', `const int TANK_ID = ${id};`, 'tank4.ino');
let secrets = readFileSync(secretsSrc, 'utf8');
secrets = replaceOnce(secrets, 'Tank 4 controller', `Tank ${id} controller`, 'secrets.example.h');
secrets = replaceOnce(secrets, 'this tank4', `this tank${id}`, 'secrets.example.h');
secrets = replaceOnce(secrets, 'the Tank 4 device account', `the Tank ${id} device account`, 'secrets.example.h');
secrets = replaceOnce(secrets, 'esp32-tank4@', `esp32-tank${id}@`, 'secrets.example.h');

mkdirSync(target);
writeFileSync(join(target, `tank${id}.ino`), sketch);
writeFileSync(join(target, 'secrets.example.h'), secrets);

console.log(`Created backend/firmware/tank${id}/ (TANK_ID = ${id}).
Next:
  1. Admin Panel → Tank Assignment → Register New Tank, ID ${id} (if not done yet)
  2. Admin Panel → Device Accounts: create the account for Tank ${id}
  3. Copy secrets.example.h to secrets.h in that folder and fill it in (never commit it)
  4. Open tank${id}/tank${id}.ino in the Arduino IDE and upload it to the new ESP32`);
