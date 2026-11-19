# Level Sensor: Multimeter Tests and ZERO/SPAN Adjustment on the HW-685

Step-by-step guide to test the Tank 1 water level sensor with a digital multimeter, adjust the ZERO and SPAN
knobs on the **HW-685** current-to-voltage module, and then calibrate the firmware.

```
Hydrostatic level sensor ──4–20 mA──► HW-685 module ──VOUT (volts)──► ESP32 GPIO 35
(0–5 m, in the drum)                  (ZERO, SPAN, J1, J2)              (firmware turns V into height)
```

Test drum: 0.90 m high (200 L drum model of Reservoir Tank No. 1).

**Order of work:** Part A (set up the meter) → Part B (tests before adjusting) → Part C (ZERO/SPAN) →
Part D (calibrate the firmware) → Part E (check and record).

---

## What you need

- [ ] Digital multimeter with its red and black test leads
- [ ] Small flat screwdriver that fits the brass screw on the blue pots (plastic is best)
- [ ] Tape measure or a marked stick (to measure water depth)
- [ ] Laptop with Arduino IDE, ESP32 connected by USB, Serial Monitor at **115200 baud**
- [ ] Firmware uploaded with `#define LEVEL_VOLTAGE_PRINT 1` (prints a `[LevelCal] V=…` line every second)
- [ ] Admin account for the web app (to enter the calibration)
- [ ] Pen and this sheet (Part E) to write the readings down
- [ ] Cable tie or clip to fix the sensor cable at the top of the drum

---

# Part A: Setting up the multimeter

## A1. Plug the leads into the meter

| Lead | Jack on the meter | Notes |
|---|---|---|
| **Black** | **COM** | Always COM, for every test in this guide |
| **Red** | **VΩmA** (may be labelled V/Ω, VΩHz or VΩmA) | For all voltage tests |

```
   Front of a typical meter
   ┌───────────────────────────┐
   │        [ display ]         │
   │                            │
   │          ( dial )          │
   │                            │
   │   10A     COM     VΩmA     │
   │    ○       ●        ●      │
   │         black      red     │
   └───────────────────────────┘
```

**Never measure voltage with the red lead in the 10A / 20A jack.** In that jack the meter is a short circuit
and can blow its fuse or damage the module.

## A2. Set the dial

| What you measure | Dial setting | Symbol |
|---|---|---|
| Module output voltage (most tests) | **DC volts** | **V⎓** or V with a straight line (not V~) |
| Module supply voltage (test B1) | DC volts, 20 V or 200 V range | V⎓ |
| Sensor current (optional test B5 only) | DC milliamps, 20 mA or 200 mA range | A⎓ / mA⎓ |

Range for the module output:
- **Manual-range meter:** start at **20 V**. When you see the reading is under 2 V, switch to **2 V** (or 2000 m)
  for one more decimal place (for example 0.603 instead of 0.60).
- **Auto-range meter:** just select V⎓.

## A3. Where to put the probes

Look at the labels printed next to the screw terminals on your HW-685. The layout may differ from this
drawing; **the printed labels are what count.**

```
                 HW-685 (labels vary by board)
   ┌──────────────────────────────────────────┐
   │   [ZERO pot]          [SPAN pot]          │
   │   blue box,           blue box,           │
   │   brass screw         brass screw         │
   │                                           │
   │   J1 [::]   J2 [::]   ← range jumpers     │
   │                                           │
   │  Supply side          Output side         │
   │   VCC ●               VOUT ●──── RED probe (wire to ESP32 GPIO 35)
   │   GND ●               GND  ●──── BLACK probe
   │                                           │
   │  Sensor input: 4–20 mA terminals          │
   └──────────────────────────────────────────┘
```

| Probe | Touch it to |
|---|---|
| **Black** | **GND** of the HW-685 (either GND terminal; they are connected inside) |
| **Red** | **VOUT** of the HW-685 |

**Easier alternative, at the ESP32:** red probe on the **GPIO 35** pin (D35), black probe on any **GND** pin of
the ESP32. This is the same voltage, and it is exactly what the ESP32 sees.

## A4. Is the meter set up right? (quick check)

| Meter shows | Meaning | Do this |
|---|---|---|
| About **0.80 V** (sensor out of water) or about **1.37 V** (full drum) | Correct | Go on to Part B |
| **12–24 V** | Red probe is on **VCC** (the supply), not VOUT | Move the red probe to VOUT |
| A **minus** sign, e.g. **−0.60** | Probes swapped | Swap them. Nothing is damaged |
| **0.00** | Wrong terminal, or no power on the module | Check probe position, then do test B1 |
| **OL** or **1.** on the left | Range too low | Switch to a higher range (20 V) |
| Numbers jumping wildly | Probe not touching the metal | Press the probe tip firmly onto the screw head |

---

# Part B: Tests before adjusting anything

Do these first. They show whether the sensor, module and wiring work, and give you "before" values for the
thesis. **Don't turn any knob yet.** Write every result in the record sheet (Part E).

## B1. Module supply voltage

1. Dial: **V⎓**. Manual-range meter: **20 V** range for a 12 V supply, **200 V** range for a 24 V supply
   (24 V is above the 20 V range).
2. Black probe → HW-685 **GND**. Red probe → HW-685 **VCC**.
3. Read it.

| Reading | Meaning |
|---|---|
| **12–24 V**, steady | Good |
| Below about 7 V | Supply too weak; the module and sensor may not work properly |
| 0 V | No power: check the adapter and wiring |
| Jumps around | Loose wire or bad adapter |

## B2. Jumper check (look, don't measure)

Look at **J1** and **J2** on the board.

| J1 | J2 | Output range | OK? |
|---|---|---|---|
| **off** | **off** | **0–3.3 V** | **Yes, this is what you need** |
| on | on | 0–5 V | No |
| on | off | 0–10 V | No |

(From vendor listings for 4–20 mA input. If your board has its own printed table, that one wins.)

If a jumper is on, **turn off the power** before removing it. On 5 V or 10 V a sensor fault can put more than
3.3 V on GPIO 35 and damage the ESP32.

## B3. Baseline output: empty and at a known depth

Meter on **VOUT** (Part A3), dial **V⎓**.

1. **Empty (0 depth):** lift the sensor **out of the water**, holding its tip at the height it normally sits.
   Wait 5 seconds. Write down the meter reading. Expected: about **0.80 V** (measured 0.803 V).
2. **Known depth:** put the sensor back in its usual place (tie the cable). Measure the water depth `h` with the
   tape measure, from the drum floor (sensor tip) to the water surface. Wait 5 seconds. Write down the reading
   and `h`.
   - Expected on the meter: `V ≈ 0.80 + 0.63 × h` (h in metres). Example: h = 0.45 m → about 1.09 V;
     full 0.90 m → about 1.37 V (measured 1.368 V).
3. At the same time, write down the `V=` from the Serial Monitor. (Used in test B6.)

## B4. Does the sensor respond? (lift test)

Meter on VOUT. Sensor in the water at its normal place.

1. Note the reading.
2. Slowly lift the sensor **20 cm** higher (measure it on the cable). Wait 5 seconds.
3. Expected: the voltage **drops by about 0.13 V** (20 cm × 6.3 mV/cm).
4. Lower it back. The voltage should return to the first value (within ±0.01 V).

| Result | Meaning |
|---|---|
| Drops ~0.13 V and comes back | Sensor works. Go on |
| Hardly changes | Sensor, cable or air tube problem. Check that the cable's vent tube isn't pinched or wet |
| Doesn't come back to the same value | Sensor tip not back at the same height, or loose connection |

## B5. (Optional) Sensor current, to test the sensor on its own

This checks the sensor without the HW-685. **Only do it if you're comfortable breaking the wiring.**

1. **Turn off the power.**
2. Move the **red lead** to the meter's **mA** jack (if your meter has a separate mA jack; otherwise VΩmA).
   Dial: **DC mA (A⎓)**, 20 mA or 200 mA range.
3. Undo **one** sensor wire at the HW-685's 4–20 mA input. Connect the meter **in series**: the sensor wire
   to one probe, the module's input terminal to the other. The current must flow **through** the meter.
4. Turn the power on and read.

| Sensor position | Expected current |
|---|---|
| Out of water | about **4.0 mA** |
| 0.45 m deep | about **5.4 mA** (4 + 3.2 × 0.45) |
| 0.90 m deep (full) | about **6.9 mA** |

- A minus sign → the probes are the other way round. Nothing is damaged.
- **Afterwards: turn off the power, put the wire back, and move the red lead back to the VΩ jack.**
  Leaving it in the mA jack and then measuring voltage shorts the circuit.

## B6. Meter vs ESP32

Compare the meter reading with the Serial Monitor `V=` at the same moment (from B3).

Measured on Tank 1 with the **old** firmware (17 Nov 2026):

| Sensor | Meter | ESP32 (Serial) | Difference |
|---|---|---|---|
| Out of water | 0.803 V | 0.60 V | 0.20 V |
| Full drum (0.90 m) | 1.368 V | 1.17 V | 0.20 V |

The old firmware converted the raw ADC value with `raw / 4095 × 3.3`, which ignores the ESP32's factory
calibration and read about 0.2 V low. **The firmware now reads the level sensor with `analogReadMilliVolts()`**
(factory-calibrated), so the Serial Monitor `V=` should match the meter closely.

- Up to about **±0.03 V** difference is normal.
- More than that → check that the new firmware is uploaded, then the VOUT–GPIO 35 wire and the common GND.
- Enter the **Serial Monitor** values in the Admin Panel. With the new firmware they are almost the same as the
  meter values.

## B7. Noise (how steady is it?)

Sensor in still water, pump off. Watch the meter (or Serial Monitor) for **1 minute**. Write down the lowest
and highest value.

| Spread (highest − lowest) | Meaning |
|---|---|
| Up to 0.010 V | Normal. Firmware filters it |
| 0.010–0.030 V | Some electrical noise: see Troubleshooting |
| More than 0.030 V, or jumps | Loose wire or missing ground: fix before adjusting |

---

# Part C: Adjusting ZERO and SPAN

## C1. What the knobs do

| Knob | Changes | Think of it as |
|---|---|---|
| **ZERO** | The voltage when the drum is **empty** (sensor out of water, 4 mA). Moves the whole line up/down. | Where the line starts |
| **SPAN** | How many volts per metre of water. Makes the line steeper or flatter. | How steep the line is |

All voltages below are **meter** readings.

```
Voltage (meter)
  1.37 V ┤                    ●        ← full drum now; SPAN up makes this higher (if the pot allows)
         │              ╱
         │        ╱
  0.80 V ┤ ●──╱                        ← empty now (ZERO sets this)
  0.50 V ┤ - - - - - - - - - - - -     ← lowest allowed for ZERO
         └────────────────────────────
          0 m (empty)          0.90 m (full)
```

## C2. Realistic targets on the HW-685

The HW-685 is made to stretch the **whole** 4–20 mA range (0–5 m) over 0–3.3 V, about 0.2 V per mA. The
0.90 m drum only uses 4 → 6.9 mA, so it only gets about 0.57 V. SPAN only trims around that, so **you won't
get a much bigger voltage across the drum**. That's fine: 6.3 mV per cm is enough for the ESP32.

**ZERO must not go below 0.50 V on the meter.** Near 0 V the ESP32's ADC is inaccurate (below about 0.15 V),
the firmware flags a fault below 0.05 V, and an empty tank could no longer be told apart from a cut wire.
(With the old firmware the ESP32 also read about 0.2 V low, which made a low ZERO even worse.)

Tank 1 setting (17 Nov 2026): J1 caps removed (0–3.3 V), VCC from the expansion board's 5 V,
ZERO 0.600 V dry, SPAN at its maximum = 1.352 V at the bottom of the full drum (8.4 mV per cm).
ZERO: right (clockwise) = voltage up.

| Point (meter) | Target | Limit |
|---|---|---|
| Empty (sensor out of water) | **Leave it at 0.80 V.** Lowering ZERO doesn't add resolution. | **Never below 0.50 V** |
| Full drum (0.90 m) | **As high as SPAN allows** | **Never above 3.0 V** |

**In short: the only adjustment worth trying is SPAN up.** Turn ZERO only if SPAN pushes the empty reading
above about 1.0 V, and then only back down toward 0.80 V.

## C3. Which way to turn: left or right?

Look at the brass screw on top of the blue pot **from above**:

| Turn | Same as |
|---|---|
| **Right** = clockwise ↻ | tightening a screw |
| **Left** = counter-clockwise ↺ | loosening a screw |

The HW-685 documentation doesn't say which way raises the output. On most boards **right raises it**, but
test yours with the meter on VOUT:

1. Turn the knob **2 full turns to the right**. Wait 3 seconds.
2. Read the meter:
   - Went **up** → on your board, right = up.
   - Went **down** → on your board, left = up.
   - **No change** → keep turning, 2 turns at a time. These pots need **15–25 turns** end to end. If it
     clicks and still nothing changes, it's at its end: turn the other way.
3. Write it down:

| Knob | Right (clockwise) makes V… |
|---|---|
| ZERO | ☐ up ☐ down |
| SPAN | ☐ up ☐ down |

## C4. Safety before turning

- **Unplug the VOUT wire from GPIO 35** while turning. Keep the meter on VOUT. Then a wrong turn can't reach the
  ESP32. (You will plug it back in for Part D.)
- Turn **2 turns at a time**, then read.
- A soft **click** with no change = end of travel. Don't force it.
- While you work the dashboard may show a **water level sensor fault** and the pump stays off. That's normal.

## C5. Step 1: ZERO (check only)

1. Meter on VOUT, dial V⎓.
2. Lift the sensor **out of the water**, tip at its normal height.
3. Read the meter. About **0.80 V** → leave ZERO alone and go to Step 2.
4. Only if it isn't between 0.50 and 1.00 V: turn **ZERO** until it reads about **0.80 V**.
5. Wait 5 seconds. It should stay within ±0.01 V.

## C6. Step 2: SPAN

1. Put the sensor back in its usual place and tie the cable.
2. Measure the water depth `h` and write it down.
3. Turn **SPAN** in the direction that **raises** the voltage, 2 turns at a time, watching the meter.
4. Stop when the pot clicks at its end, or at **3.0 V**, whichever comes first. (On 0–3.3 V the end comes first.)
5. Turn it back **1 turn**, so it doesn't sit at the end stop.
6. Write down the reading.

## C7. Step 3: Check ZERO again

Turning SPAN often moves ZERO a little.

1. Lift the sensor out again and read the meter.
2. Above 1.00 V or below 0.50 V? Adjust **ZERO only** (leave SPAN) back to about 0.80 V.
3. Put the sensor back and read again. Repeat until both readings stay put.

## C8. Lift test again

Repeat test B4 (lift 20 cm). Expected drop now: `20 × (V_at_h − V_empty) / (h × 100)` volts, using the meter
readings from C6 and C7.
It should drop and come back to the same value.

---

# Part D: Calibrating the firmware

The meter was only for turning the knobs. **The Admin Panel needs the ESP32's own readings.**

1. **Plug VOUT back into GPIO 35.**
2. Serial Monitor open (115200 baud). You see a line every second, like:
   ```
   [LevelCal] V=0.600 V | height=… m | Vmin=… Vmax=… tankHeight=0.90 m
   ```
3. **Vmin:** sensor out of water → wait **10 s** (the firmware filter needs that long) → write down `V=`.
4. **Voltage at depth h:** sensor back in place → wait **10 s** → write down `V=`.
5. **Vmax:** if the drum is full (h = 0.90 m), Vmax is that voltage. Otherwise:
   ```
   Vmax = Vmin + (V_at_h − Vmin) × 0.90 / h
   ```
   Example: Vmin = 0.600 V, at h = 0.45 m V = 0.885 V → Vmax = 0.600 + 0.285 × 2 = **1.170 V**
6. **Admin Panel → Calibration → Tank 1:** Vmin, Vmax, Tank height **0.90**. Save.
7. Within a few seconds the Serial Monitor shows the new `Vmin=` and `Vmax=`, and `height=` should match `h`.
8. When finished (after Part E), set `LEVEL_VOLTAGE_PRINT` back to `0` and upload the firmware again.

---

# Part E: Final check and record sheet

## E1. Depth check

Check at least 3 depths (for example while the pump fills or drains the drum). At each one, measure the depth
with the tape measure and compare.

```
expected % = depth (cm) / 90 × 100
```

| Measured depth (cm) | Expected % | Meter V | Serial `V=` | Serial `height=` (m) | Dashboard % | Error (cm) |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

Good result: error within about **±1–2 cm**. The dashboard rounds down and only moves in 2 % steps, so it can
be 1–2 % off from the expected value.

## E2. Record sheet

| Item | Before (Part B) | After (Part C/D) |
|---|---|---|
| Date / tested by | | |
| Supply voltage, VCC–GND (B1) | | |
| J1 / J2 (B2) | | off / off |
| ZERO knob: right makes V… (C3) | | |
| SPAN knob: right makes V… (C3) | | |
| Meter V, sensor out of water | 0.803 V | |
| Meter V, full drum 0.90 m | 1.368 V | |
| Meter V at depth h = ____ m | | |
| Serial `V=` out of water (**Vmin**) | 0.60 V | |
| Serial `V=` at full 0.90 m (**Vmax**, measured or calculated) | 1.17 V | |
| mV per cm = (Vmax − Vmin) × 1000 / 90 | 6.3 | |
| Lift test, 20 cm drop (B4 / C8) | | |
| Sensor current out of water / at h (B5, optional) | | |
| Meter vs Serial difference (B6) | 0.20 V (empty and full) | |
| Noise over 1 min, lowest–highest (B7) | 1.164–1.169 V | |

If the thesis or `docs/Methodology.md` lists calibration voltages, update them with the new values.

---

# Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Meter shows 12–24 V on "VOUT" | Red probe on VCC | Move it to VOUT |
| Meter shows minus | Probes swapped | Swap them |
| Meter shows 0.00 everywhere | Module not powered, or meter in the wrong jack/mode | Test B1; red lead in VΩ, dial on V⎓ |
| Meter fuse blown / shows nothing in mA | Measured voltage with the lead in the mA/10A jack | Replace the meter fuse; always move the lead back to VΩ |
| Voltage doesn't change when turning | Not enough turns, knob at its end, or wrong knob | Keep turning; try the other way; check the ZERO/SPAN label |
| Voltage doesn't change when the sensor is lifted | Sensor, cable or vent tube problem | Check wiring; vent tube not pinched or wet; test B5 |
| Current is 0 mA in test B5 | Loop not complete or no supply | Check the meter is in series and the supply is on |
| Reading wanders more than ±0.015 V in still water | Loose ground or noisy supply | Join all GNDs, add 100 nF from GPIO 35 to GND, keep sensor wires away from the pump wires |
| ZERO moves after SPAN | Normal on these modules | Repeat C7 |
| Meter reads about 0.2 V higher than the ESP32 | Old firmware still on the ESP32 (raw ADC without factory calibration) | Upload the current firmware |
| Meter and ESP32 differ by more than 0.03 V with the new firmware | Bad wire or ground between module and ESP32 | Check the VOUT–GPIO 35 wire and the common GND |
| Voltage stuck at one value at any depth, HW-685 LED off | HW-685 VCC too low; output clips | Power VCC from 5 V and remove both J1 caps (0–3.3 V range) |
| Dashboard shows a level sensor fault while adjusting | Reading swung 25 % in 30 s | Normal; clears about 30 s after it is steady |

---

# Optional: bigger voltage spread (needs extra parts)

The 0–10 V range (J1 on, J2 off) gives about 3 times more volts per cm. But at 20 mA (sensor fault or short)
VOUT would reach about 10 V, which **destroys GPIO 35**. Only use it with a clamp between VOUT and GPIO 35:

- a series resistor (about 4.7 kΩ) from VOUT to GPIO 35, and
- a 3.3 V Zener diode (or a Schottky diode to the 3.3 V pin) from GPIO 35 to GND,

then set ZERO to about 0.80 V (never below 0.50 V on the meter) and SPAN so a full drum reads at most 2.4 V. This is a hardware change that the
thesis would also need to describe. For a 0.90 m drum the 0–3.3 V range is accurate enough.

---

## Sources

- [Particle community: calibrating an HW-685 current-to-voltage converter](https://community.particle.io/t/calibrating-a-current-to-voltage-converter/70845)
- [Makerlab Electronics: current-to-voltage module 0/4–20 mA to 0–3.3/5/10 V](https://www.makerlab-electronics.com/product/current-to-voltage-module-0-4-20ma-to-0-3-3v-5v-10v-voltage-transmitter-converter-signal-conversion/)
- [Universal Solder: 4–20 mA to voltage converter](https://universal-solder.ca/4-20ma-to-voltage-converter-current-loop)
