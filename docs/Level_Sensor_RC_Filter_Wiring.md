# Level Sensor: Adding an RC Filter and Pull-Down to GPIO 35

Step-by-step guide for the team members who will solder an RC low-pass filter and a pull-down resistor onto the
**water level sensor input (GPIO 35)** of the **Tank 1** ESP32. No code changes are needed.

```
Hydrostatic level sensor ──4–20 mA──► HW-685 ──OUT──► R1 1 kΩ ──► Node A ──► ESP32 GPIO 35
                                                                    │
                                                          C1 100 nF + R2 100 kΩ to GND
```

> **Status:** built on Tank 1 on 20 Nov 2026. After the first unplug test the firmware's lower level-voltage limit
> was raised to 0.30 V (section 1.1). Unplug test with that firmware (20 Nov 2026, 1:44 PM): steady 0.142 V while
> unplugged, level sensor fault logged after about 9 s, recovered about 31 s after reconnecting, no restarts.
> A 0.28 V reading right after a power-on was also flagged, which the old limit would have missed.
> Recalibrated the same day after a ZERO/SPAN adjustment: Vmin 0.399 V (sensor out of water), Vmax 0.983 V
> (full drum, water about 1 inch below the rim = 100 %), tank height 0.90 m. Empty is only 0.10 V above the
> 0.30 V fault limit; raise ZERO toward 0.50 V if an empty drum ever shows a false level sensor fault.
> The thesis is **not** updated yet (see "For the paper").

**Only the level sensor line changes.** Do not touch:

| Leave alone | Why |
|---|---|
| **GPIO 32** | Drives the **pump relay**. It is *not* the level input. |
| GPIO 18, 19, 23, 5, 4, 14 | W5500 Ethernet module (SCK, MISO, MOSI, CS, INT, RST) |
| **GPIO 34** | pH sensor |
| Existing power wiring (ESP32, HW-685 VCC, relay, pump) | Not part of this change (except the optional decoupling capacitors in step 7) |

---

## 1. What it does and why

| Part | Job |
|---|---|
| **R1** 1 kΩ, in series | Limits the current into GPIO 35 if the HW-685 output ever goes too high or a wire touches something it shouldn't. Together with C1 it forms the low-pass filter. |
| **C1** 100 nF (104), Node A to GND | Smooths fast spikes on the line (pump motor and relay switching, radio pickup) and gives the ESP32's ADC a steady charge to sample from. |
| **R2** 100 kΩ, Node A to GND | **Pull-down.** If the HW-685 OUT wire comes loose, GPIO 35 is pulled to about 0 V instead of floating. |

Benefits:

- **Steadier readings.** Spikes from the pump motor and the relay are filtered before the ADC samples them.
- **Fewer false low-level, overflow and night-watch alerts** caused by those spikes.
- **A disconnected OUT wire becomes a clear, steady 0 V** instead of a floating pin that wanders around.
  Without R2 the firmware only catches a floating pin through its "unstable reading" check (25 % swing in 30 s).
  With R2 it is caught by the **low-voltage limit** (0.30 V) instead: see section 1.1, and do the unplug
  test in section 6.7 after uploading the firmware.
- **R1 protects the pin** (current limit).
- **No noticeable delay.** Time constant τ = R1 × C1 = 1 kΩ × 100 nF = **0.1 ms** (cut-off about 1.6 kHz).
  The firmware samples every 20 ms, so the filter settles more than 100 times faster than the firmware reads.

What it does **not** do: it does not remove slow drift or 60 Hz mains hum (well below 1.6 kHz). The firmware's
averaging (16 samples), median filter (5 samples), spike filter and 2 % deadband still handle those.

### 1.1 Does the firmware flag an unplugged sensor? (checked in the code and on Tank 1)

`processLevelSensor()` in `backend/firmware/esp32_firmware.ino` treats a level reading as invalid when **any**
of these is true, and raises a **level sensor fault** after it stays invalid for **10 s**
(`SENSOR_FAULT_TIMEOUT = 10000`):

| Check | Code | Low-side limit |
|---|---|---|
| Voltage | `electricalValid = (V > LEVEL_MIN_VALID_VOLTAGE && V < 3.25)` | **0.30 V** (`LEVEL_MIN_VALID_VOLTAGE`): at or below this the reading is a fault. Was 0.05 V until 20 Nov 2026 |
| Height | `physicalValid = (height >= -0.5 && height <= tankHeight + 0.5)` | height below **−0.5 m** is a fault |
| Stability | `levelSignalUnstable()` | swing of 25 % or more within 30 s |

A voltage between 0.30 V and Vmin only reads as **0 %** (the level is clamped); it is not a fault. That is why
ZERO must never be set below 0.50 V on the meter (`docs/Level_Sensor_Zero_Span_Calibration.md` C2).

The height check gives a second, calibration-dependent limit:

```
height = (V − Vmin) × tankHeight / (Vmax − Vmin)
height check trips below:  V_trip = Vmin − 0.5 × (Vmax − Vmin) / tankHeight
```

**Why the limit was raised to 0.30 V (unplug test on Tank 1, 20 Nov 2026).** With R2 fitted, the meter showed
0 V at GPIO 35 with HW-685 OUT disconnected, but the ESP32 reported a steady **0.142 V**: its ADC cannot measure
below about 0.1–0.15 V. The old 0.05 V limit therefore never fired. The fault was raised 10 s after unplugging,
but only by the height check (Vmin 0.497 V, Vmax 1.114 V, 0.90 m → height −0.518 m against −0.5 m), a margin of
12 mV. A slightly lower Vmin after a recalibration would have shown a steady 0 % with **no fault**, and the pump
would then start automatically. With the 0.30 V limit, the 0.142 V reading is caught by the voltage check,
whatever the calibration.

**Upload the current firmware** (with `LEVEL_MIN_VALID_VOLTAGE`) before relying on the pull-down, then repeat the
unplug test (6.7): the fault log should now say "Out-of-bounds readings. Voltage: 0.14V".

---

## 2. Parts

| Ref | Part | Value / marking | Colour code | Notes |
|---|---|---|---|---|
| **R1** | Resistor, 1/4 W, metal film 1 % | **1 kΩ** | 5-band: **brown, black, black, brown, brown** | 4-band 5 % version: brown, black, red, gold |
| **R2** | Resistor, 1/4 W, metal film 1 % | **100 kΩ** | 5-band: **brown, black, black, orange, brown** | 4-band 5 % version: brown, black, yellow, gold |
| **C1** | Ceramic capacitor | **104** = 100 nF | — | No polarity. Rated 16 V or more (50 V is typical) |
| C2 (optional) | Ceramic capacitor | **104** = 100 nF | — | Supply decoupling at HW-685 VCC–GND. Rated **50 V** if VCC is 12–24 V |
| C3 (optional) | Ceramic capacitor | **103** = 10 nF | — | Same place as C2, in parallel |
| — | Hook-up wire, heat-shrink tube, solder | | | Heat-shrink sized for the resistor bodies and the joints |

How to read the 5-band code: hold the resistor so the **brown tolerance band** (often a little apart from the
others) is on the **right**. Bands 1–3 are digits, band 4 is the multiplier:

| Resistor | Digits | Multiplier | Value |
|---|---|---|---|
| R1 | brown 1, black 0, black 0 | brown × 10 | 100 × 10 = **1 kΩ** |
| R2 | brown 1, black 0, black 0 | orange × 1 000 | 100 × 1 000 = **100 kΩ** |

The two look almost the same; only band 4 differs (**brown** = 1 kΩ, **orange** = 100 kΩ). **Always confirm with
the meter (test 5.1)** before soldering.

Tools: soldering iron, solder, wire stripper, side cutter, heat gun or lighter for heat-shrink, digital
multimeter, tape measure, laptop or phone with an admin account for the web app.

---

## 3. Wiring

### 3.1 Wiring diagram

```
   HW-685 module                                                     ESP32
  ┌─────────────┐                                                  ┌───────────┐
  │             │      existing wire       R1 1 kΩ      Node A     │           │
  │      OUT  ●─┼──────────────────────────[ ▬▬▬▬ ]──────●──────────┼─● GPIO 35 │  (level input)
  │             │                                       │          │           │
  │             │                                  ┌────┴────┐     │           │
  │             │                                  │         │     │           │
  │             │                              C1 ═╪═      ┌─┴─┐   │           │
  │             │                            100 nF│       │R2 │   │           │
  │             │                              (104)       │100│   │           │
  │             │                                  │       │ kΩ│   │           │
  │             │                                  │       └─┬─┘   │           │
  │             │      existing ground wire        │         │     │           │
  │      GND  ●─┼──────────────────────────────────●─────────●─────┼─● GND     │
  │             │                                                  │           │
  │      VCC  ●─┼── existing supply (unchanged)                    │  GPIO 32 ─┼── pump relay: DO NOT USE
  │             │                                                  │  GPIO 34 ─┼── pH sensor: leave alone
  │  4–20 mA in │◄── level sensor (unchanged)                      │           │
  └─────────────┘                                                  └───────────┘
                                         └──── keep R1, C1, R2 within ~5 cm of GPIO 35 ────┘
```

Optional supply decoupling, soldered right at the HW-685 terminals:

```
  HW-685 VCC ●───┬────────┬───
                 │        │
             C2 ═╪═   C3 ═╪═
            104  │   103  │
            100nF│   10nF │
                 │        │
  HW-685 GND ●───┴────────┴───
```

### 3.2 Connection table

| # | From | To | How |
|---|---|---|---|
| 1 | HW-685 **OUT** | R1, leg 1 | Existing OUT wire, cut near the ESP32 end and soldered to R1 |
| 2 | R1, leg 2 | **Node A** | Solder joint |
| 3 | **Node A** | C1, leg 1 | Solder joint (either leg, C1 has no polarity) |
| 4 | **Node A** | R2, leg 1 | Solder joint (either leg) |
| 5 | **Node A** | ESP32 **GPIO 35** | Short wire. **Connected last**, after the tests in 5.4 |
| 6 | C1, leg 2 | Common ground wire | Solder to the ground wire that runs HW-685 GND → ESP32 GND, near the ESP32 end |
| 7 | R2, leg 2 | Common ground wire | Same point as C1 leg 2 |
| 8 | HW-685 GND | ESP32 GND | **Existing** wire, unchanged. This is the one common ground |
| 9 (opt.) | C2 104 and C3 103 | HW-685 VCC ↔ HW-685 GND | Both in parallel, legs as short as possible |

Placement: put **R1, C1 and R2 together near the GPIO 35 end** (within about 5 cm), with the C1 and R2 ground
legs as short as possible. A filter at the far end of a long wire filters less, because the wire between it and
the pin picks up noise again.

---

## 4. Installation, step by step

> Work with **everything powered off** until step 4.11. Leave Node A **disconnected** from GPIO 35 until it
> has been measured (step 4.12).

**4.1 Prepare for maintenance.** In the web app: Admin Panel → **Tank Maintenance** → turn on **Tank 1** (or
"Maintenance Mode (all tanks)"). This pauses Tank 1's alerts and holds its pump off.

**4.2 Power everything off.**
- Unplug the ESP32's power (USB cable and/or adapter).
- Unplug the HW-685 / sensor supply.
- Unplug the pump and relay supply.
- Wait 1 minute for capacitors to discharge.

**4.3 Photograph the existing wiring** and label the wires before changing anything: HW-685 OUT, HW-685 GND,
HW-685 VCC, GPIO 35, GPIO 34, GPIO 32.

**4.4 Test every part** (multimeter, section 5.1). Set aside any that are out of range.

**4.5 Find the level wire.** Trace the wire from the HW-685 **OUT** terminal to **GPIO 35** (labelled D35 or
IO35 on the board). Confirm it is GPIO 35, **not GPIO 32** (relay) and **not GPIO 34** (pH).

**4.6 Disconnect the level wire at GPIO 35.** Pull it off the GPIO 35 pin (or out of the expansion-board
terminal). Leave it disconnected for now.

**4.7 Fit R1.** About 5 cm from the GPIO 35 end, cut the OUT wire. Strip 5 mm on both cut ends.
- Slide a piece of heat-shrink over the wire first.
- Solder the **HW-685 side** of the wire to **R1 leg 1**.
- Solder the short **GPIO 35 side** of the wire to **R1 leg 2**. This leg and that wire are **Node A**.
- Trim R1's legs to about 5–8 mm.

**4.8 Fit C1 and R2 at Node A.**
- Bend one leg of **C1** and one leg of **R2** and solder both to Node A (the R1 leg 2 joint).
- Bend the other legs of C1 and R2 together.

**4.9 Connect C1 and R2 to ground.**
- Strip about 5 mm of insulation from the middle of the **common ground wire** (HW-685 GND → ESP32 GND), near the
  ESP32, without cutting it. Or add a short extra wire from that wire to a free ESP32 **GND** pin.
- Solder the free legs of C1 and R2 there. Keep these ground legs as short as possible.

**4.10 Insulate.** Shrink heat-shrink over R1, over Node A, and over the ground joint. Make sure no bare metal of
Node A can touch the ground joint, a 3.3 V or 5 V pin, or any other pin.

**4.10a (Optional) decoupling.** Solder C2 (104) and C3 (103) across the HW-685 **VCC** and **GND** terminals,
legs short.

**4.11 Power-off tests.** Do sections 5.2 and 5.3. Fix any failure before powering on.

**4.12 First power-up, Node A still disconnected.** Power on the HW-685 and the ESP32 (leave the pump supply
off). Do section 5.4 and 5.5. Node A must read below 3.3 V.

**4.13 Connect Node A to GPIO 35.** **Power everything off again.** Plug the Node A wire onto **GPIO 35**.
Check again that it is GPIO 35 and not GPIO 32.

**4.14 Power on and verify.** Power on the HW-685 and the ESP32. Do sections 5.6 and 6.7 (unplug test).

**4.15 Recalibrate** (section 6).

**4.16 Finish.** Plug the pump supply back in. Turn Tank 1 maintenance **off**. Fill in the record sheet
(section 9).

---

## 5. Multimeter tests

Meter setup (as in `docs/Level_Sensor_Zero_Span_Calibration.md` Part A): **black lead in COM, red lead in VΩ**.
Never measure with the red lead in the 10 A / mA jack.

### 5.1 Each part, before soldering

Hold the part by its body or lay it on the table. Don't touch both legs with your fingers (your body adds
resistance in parallel).

| Part | Dial | Expected | Reject if |
|---|---|---|---|
| R1 1 kΩ | Ω, 2 kΩ range (or auto) | **0.99–1.01 kΩ** | Outside that range, or reads about 100 kΩ (that's R2) |
| R2 100 kΩ | Ω, 200 kΩ range (or auto) | **99–101 kΩ** | Outside that range, or reads about 1 kΩ (that's R1) |
| C1 104 | Capacitance (–\|(–, nF), if the meter has it | **about 80–120 nF** | 0, OL, or far outside. Short the legs together first to discharge it |
| C1 104 (no capacitance range) | Continuity / Ω | No beep, reading climbs toward OL | Steady beep or 0 Ω = shorted capacitor |

(5 % resistors: R1 0.95–1.05 kΩ and R2 95–105 kΩ are also fine.)

### 5.2 Continuity, power off (no shorts)

Dial: **continuity** (🔊 / diode symbol). Touch the probes together first: it must beep.

| Probe 1 | Probe 2 | Must | If it beeps steadily |
|---|---|---|---|
| ESP32 **3.3 V** pin | ESP32 **GND** | **Not beep** | Short on the 3.3 V supply: find the solder bridge or stray strand |
| ESP32 **5 V** / VIN pin | ESP32 **GND** | **Not beep** | Short on the 5 V supply |
| **Node A** | ESP32 **3.3 V** | **Not beep** | Node A touching 3.3 V: re-insulate |
| **Node A** | ESP32 **5 V** / VIN | **Not beep** | Node A touching 5 V: re-insulate. **Never power on like this** |
| **Node A** | GND | **Not beep** (R2 is 100 kΩ) | C1 shorted or a solder bridge to the ground joint |

A short chirp that stops at once is normal: the board's capacitors (or C1) charging from the meter. Only a
**steady** beep means a short.

### 5.3 Resistance, power off

Dial: **Ω**, auto or 200 kΩ range.

| Probe 1 | Probe 2 | Expected | Wrong reading → |
|---|---|---|---|
| **Node A** | GND | **about 100 kΩ** (never 0 Ω). May creep up for a second while C1 charges | 0 Ω: short to ground. About 1 kΩ: R1 and R2 swapped. OL: R2 not connected to ground |
| **HW-685 OUT** terminal | **Node A** | **about 1 kΩ** | OL: R1 joint broken. About 100 kΩ: R1 and R2 swapped |

If Node A–GND reads well below 90 kΩ, the unpowered HW-685 output may be adding a path through R1. Unscrew the
wire at HW-685 OUT and measure again: it must then read 99–101 kΩ.

### 5.4 First power-up, Node A **not** on GPIO 35

HW-685 and ESP32 powered, pump supply off, Node A wire hanging free (insulated tip).
Dial: **DC volts (V⎓)**, 20 V range on a manual meter. Black probe on **GND**, red probe on **Node A**.

| Sensor | Expected at Node A | Tank 1 reference (17 Nov 2026, before R1/R2) |
|---|---|---|
| Lifted out of the water (empty) | **about 0.5–0.6 V** | 0.600 V |
| On the floor of the full drum (0.90 m) | **about 1.2–1.35 V** | 1.352 V |
| Anything | **Never above 3.3 V** | |

Node A should be about **1 % below** HW-685 OUT (R1 and R2 form a 1 : 100 divider: 100 / 101 = 0.99).

**If Node A reads above 3.3 V: stop.** Power off. Do **not** connect GPIO 35. Check the HW-685 range jumpers
(J1/J2 both off = 0–3.3 V) and the ZERO/SPAN settings in `docs/Level_Sensor_Zero_Span_Calibration.md`.

If Node A reads 0 V with the sensor in water: see Troubleshooting.

### 5.5 Supply check at the HW-685

Dial: **V⎓**, 20 V range (200 V range if the module is fed more than 20 V). Black probe on HW-685 **GND**, red on
HW-685 **VCC**.

| Reading | Meaning |
|---|---|
| The supply your board is wired for, steady (Tank 1: about **5 V** from the expansion board; 12–24 V if fed from an adapter) | Good |
| Noticeably lower than that, or jumping | Weak or loose supply: fix before going on |
| 0 V | No supply: check the wiring |

If you fitted C2/C3, this reading should be at least as steady as before.

### 5.6 After connecting GPIO 35: meter vs live readings

1. Admin Panel → **Calibration** → **Tank 1** → **Live sensor readings** → **Start (10 min)**.
2. Meter on **V⎓**: black on ESP32 **GND**, red on the **GPIO 35** pin.
3. Sensor still. Wait 10 s (firmware filter). Compare the meter with the **level voltage** in the live panel.

| Result | Meaning |
|---|---|
| Within **about 0.05 V**, and the live value stays steady (changes by less than about 0.01 V) | Good |
| Differs by more than 0.05 V | Check that Node A is on GPIO 35 (not 34 or 32), the common ground, and that the current firmware (with `analogReadMilliVolts()`) is uploaded |
| Live value jumps around | Loose joint or long ground leg on C1/R2: see Troubleshooting |

### 5.7 Unplug test (see 6.7)

Done after calibration starts; described in section 6.7 because it needs the dashboard.

---

## 6. Recalibration

R1 and R2 lower the voltage at GPIO 35 by about **1 %** (for example 0.600 V → 0.594 V, 1.352 V → 1.339 V). With
the old Vmin/Vmax the level would read up to about **2 % low** near full, so recalibrate.

**6.1** Tank 1 maintenance is **on** (step 4.1). The pump is held off.

**6.2** Admin Panel → **Calibration** → **Tank 1** → **Live sensor readings** → **Start (10 min)**
(use **+10 min** if you need more time, 30 min max).

**6.3 Vmin (empty).** Lift the sensor **out of the water**, tip at its normal height. Wait **10 s**. Click
**"Use as Vmin (sensor out of water)"**.

**6.4 Vmax (full).** Put the sensor back **on the floor of the full drum** (0.90 m). Wait **10 s**. Click
**"Use as Vmax (sensor on floor, full tank)"**.
If the drum is not full, measure the depth `h` and calculate Vmax as in
`docs/Level_Sensor_Zero_Span_Calibration.md` Part D, step 5: `Vmax = Vmin + (V_at_h − Vmin) × 0.90 / h`.

**6.5** "Use as" only fills the form. Check the tank height is **0.90** and click **Save**.

**6.6 Tape check.** Measure the water depth with a tape measure. Expected level % = depth (cm) / 90 × 100.
The dashboard should agree within about 1–2 % (it moves in 2 % steps).

**6.7 Unplug test** (still in maintenance, so the pump stays off and alerts are paused; the dashboard still shows
sensor faults).
1. With the live readings running and the meter on GPIO 35, unscrew the wire at the **HW-685 OUT** terminal (or
   switch off the HW-685's supply).
2. Expected:
   - Meter at GPIO 35 falls to **about 0 V** (R2 pulls it down).
   - Live level voltage falls to about **0.14 V** (the ESP32's ADC floor; see 1.1). **Write it down.**
   - Within about **10–15 s** the Tank 1 card shows **"Water level sensor fault"**.
3. Reconnect OUT. The fault clears by itself. Because the jump from 0 % back to the real level counts as a big
   swing, this can take **about 30–45 s** (the 30 s stability window, then 3 s of steady readings).

**If no fault appears after 30 s and the card shows a steady 0 %: stop.** Leave Tank 1 in maintenance (or the
pump off) and check that the firmware with the 0.30 V limit (`LEVEL_MIN_VALID_VOLTAGE`, section 1.1) is
uploaded. Do not put Tank 1 back in normal service until the fault appears, because the pump would start
automatically at 0 %.

**6.8** Turn Tank 1 maintenance **off**.

---

## 7. Do not

- **Do not put more than 3.3 V on any GPIO.** Never connect 5 V (or the HW-685 VCC) to GPIO 35 or any other GPIO.
  Always measure Node A (5.4) before connecting it.
- **Do not swap OUT and GND** on the HW-685. OUT goes to R1; GND goes to the common ground.
- **Do not use a separate ground** for C1 and R2. They go to the same ground wire that joins HW-685 GND and
  ESP32 GND (one common ground). A separate ground makes the filter useless and the reading wrong.
- **Never solder while anything is powered.** Unplug the ESP32, the HW-685 supply and the pump first.
- **Never use GPIO 32.** It drives the pump relay. Connecting the level line there can switch the pump.
- Do not touch the W5500 pins (18, 19, 23, 5, 4, 14) or the pH input (GPIO 34).
- Do not use an electrolytic capacitor for C1 (it has polarity and is too slow for spikes). Use the 104 ceramic.
- Do not swap R1 and R2. 100 kΩ in series with 1 kΩ to ground would pull the reading almost to 0 V.

---

## 8. Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Node A reads **0 V** with power on and the sensor in water | R1 joint broken, HW-685 unpowered, or Node A shorted to ground | Power off; test 5.3 (OUT–Node A about 1 kΩ, Node A–GND about 100 kΩ); test 5.5 |
| Node A reads **about 0.01–0.05 V** with the sensor in water | R1 and R2 swapped (100 kΩ in series, 1 kΩ to ground) | Power off, check colour bands and 5.3, swap them |
| Node A reads **above 3.3 V** | HW-685 range jumper set to 5 V or 10 V, or ZERO/SPAN too high | Stop. Do not connect GPIO 35. Follow `docs/Level_Sensor_Zero_Span_Calibration.md` (B2, Part C) |
| Node A–GND **beeps** steadily (power off) | C1 shorted, solder bridge, or bare Node A touching the ground joint | Re-solder, re-insulate; test C1 alone (5.1) |
| Pump relay **clicks** when Node A is connected or the level changes | Level line is on **GPIO 32** | Power off immediately and move it to GPIO 35 |
| pH reading changed after the work | Level line on **GPIO 34**, or the pH wire was disturbed | Power off, check that GPIO 34 has only the pH wire |
| Ethernet stopped working | A W5500 wire was moved | Compare with the photos from 4.3; pins 18, 19, 23, 5, 4, 14 |
| Meter and live reading differ by **more than 0.05 V** | Poor ground, wrong pin, or old firmware | Check the common ground and the pin; upload current firmware |
| Reading still **noisy** | C1/R2 ground legs long, or filter far from the ESP32; sensor wires bundled with pump wires | Move the filter close to GPIO 35, shorten ground legs, route sensor wires away from pump and relay wires |
| Level reads **1–2 % low** | Normal 1 % divider from R1/R2 | Recalibrate (section 6) |
| **"Water level sensor fault"** right after connecting or reconnecting | The jump looks like a 25 % swing within 30 s | Normal; clears about 30–45 s after the reading is steady |
| Unplug test: **no fault**, steady 0 % | Old firmware (0.05 V limit) still on the ESP32 (section 1.1) | Keep Tank 1 in maintenance; upload the firmware with `LEVEL_MIN_VALID_VOLTAGE` = 0.30 V |
| Fault does not clear after reconnecting OUT (over 1 min) | OUT wire not tight, or HW-685 supply still off | Tighten the terminal; test 5.4 at Node A; test 5.5 |
| HW-685 VCC reading jumps | Loose supply wire or weak adapter | Fix the supply; optional C2/C3 help with fast noise only |

---

## 9. Record sheet

| Item | Value |
|---|---|
| Date / done by | |
| R1 measured (kΩ) | |
| R2 measured (kΩ) | |
| C1 measured (nF, if possible) | |
| Node A–GND, power off (kΩ) | |
| HW-685 OUT–Node A, power off (kΩ) | |
| Node A, sensor out of water (V) | |
| Node A, full drum (V) | |
| HW-685 VCC (V) | |
| GPIO 35 meter vs live reading, empty / full (V) | |
| Live reading noise over 1 min, lowest–highest (V) | |
| New Vmin / Vmax saved (V) | |
| Tape depth vs dashboard % | |
| Unplug test: GPIO 35 meter (V) / live voltage (V) / fault shown after (s) | |
| Fault cleared after reconnecting (s) | |
| Optional C2/C3 fitted? | |

---

## 10. For the paper (only after the hardware has been built and tested)

Not applied yet. Once the tests above pass:

- **3.5.2 Hardware Requirements:** add R1 (1 kΩ), R2 (100 kΩ) and C1 (100 nF ceramic), and C2/C3 if fitted.
- **Circuit diagram:** add R1 in series between HW-685 OUT and GPIO 35, and C1 and R2 from GPIO 35 to GND.
- Describe it as **an RC low-pass filter (1 kΩ, 100 nF, τ = 0.1 ms, cut-off about 1.6 kHz) with a 100 kΩ
  pull-down on the level sensor input**, which suppresses switching noise and pulls a disconnected sensor line
  to 0 V so the firmware flags it as a level sensor fault.
- Update the level sensor's electrical bounds from 0.05–3.25 V to **0.30–3.25 V** (the pH sensor stays at
  0.05–3.25 V), with the reason: the ESP32 ADC reads about 0.14 V for 0 V (unplug test, 20 Nov 2026).
- Add an entry to `thesis-review/paper-changes-2026-11-19.md` (local only, git-ignored) at that time.
