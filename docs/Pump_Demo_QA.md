# Pump Demo: Q&A for the Defense

Prepared 2026-11-14 for the panel presentation. Every answer below matches the current code (`main` at `29b5b3f`):
the firmware's virtual pump (`backend/firmware/esp32_firmware.ino`) and the Pump Demo Mode switch in the web and
mobile app.

**One-sentence summary to open with:**
> "Our controller already contains complete pump-control logic. Because we have no pump hardware, it drives a
> *virtual pump*: it decides when the pump should run and reports it, but switches nothing. Connecting a relay
> later is the only step left, which is our Chapter 5 recommendation."

---

## Before the demo (checklist)

- [ ] The Tank 1 ESP32 is flashed with the latest `esp32_firmware.ino` (virtual pump; `PUMP_RELAY_ENABLED 0`).
- [ ] Sign in as **Admin**. In Admin Panel → Configuration → System Controls: **Pump Demo Mode = ON**,
      **Maintenance Mode = OFF**, **Pump Control Lock = OFF**.
- [ ] Tank 1's card shows "Online" and "Pump (Demo): OFF".
- [ ] The drum has water above the low threshold (15%), and you can lower and raise it (drain or pour).
- [ ] Optional: a second phone with the Android app signed in as a **Worker**, to show the same pump status live.

## Demo script (about 3 minutes)

1. **Show the switch.** Admin Panel → System Controls → Pump Demo Mode (on). Say: "This is a demonstration
   mode. Nothing physical is switched."
2. **Automatic start.** Lower the water below 15%. Within a few seconds the low-level alert fires and the card shows
   **Pump (Demo): ON**. Open **Logs**: "Pump started automatically … fell to low level threshold (15%)".
3. **Automatic stop.** Raise the water to 95% or more. The pump turns **OFF**. The log says "Overflow shutoff
   protection".
4. **Manual control.** Below 95%, turn the pump on from the dashboard, confirm the dialog, and show it on the
   phone. Turn it off again.
5. **Safety interlock.** Turn on **Maintenance Mode**. The pump stops, the switch is disabled, and alerts are
   suppressed. Turn it off.
6. **Reports.** Open Reports to show the "Pump System (Demo)" card and the "Demo Pump Activity" chart. Optionally
   export a PDF: it has a "Demo Pump Activity" section.
7. **Back to the thesis scope.** Turn **Pump Demo Mode OFF**. Every pump control disappears, and the system is the
   monitoring-only system described in the paper.

> Do **not** show manual toggling while the Pump Control Lock is on (see Q24).

---

## A. The concept

**Q1. Your thesis says the system has no pump control. Why is there a pump on the dashboard?**
The deployed system is monitoring only, as stated in Chapter 1.4. The pump feature you see is a **demo mode** that we
built to show our Chapter 5 recommendation is feasible. It is clearly labelled "Demo", it is controlled by one
admin switch, and with that switch off the system is exactly what the thesis describes.

**Q2. What is a "virtual pump"?**
The ESP32 runs the full pump-control logic. It decides when the pump should start and stop, accepts or refuses
commands, and reports the pump state (`pumpOn`) and logs to the cloud. The only thing it does not do is switch an
output pin, because no relay or pump is connected.

**Q3. So is it just a fake button in the app?**
No. The decisions are made by the **firmware on the ESP32**, using the real sensor readings, not by the app. The app
only sends a request; the controller can refuse it (during maintenance, at overflow, or with a faulty sensor) and
logs why. The automatic start and stop happen even when no one has the app open.

**Q4. Why didn't you buy a pump?**
Controlling the university's pump motors needs industrial relays, magnetic contactors and approval from MPWSD. That
is outside our scope and budget, so we listed it as a recommendation. The virtual pump lets us validate the control
logic safely first.

**Q5. What would it take to control a real pump?**
On the firmware side, one setting: change `PUMP_RELAY_ENABLED` from 0 to 1, which drives a relay module on GPIO 32,
and flash again. On the hardware side, a relay module plus, for real motors, a properly rated contactor installed by
an electrician. The app does not change.

## B. How it works

**Q6. When does the pump start automatically?**
When the water level falls **to or below the low threshold** (15% by default), as long as the pump has been off for
at least **30 seconds** (anti-chatter protection) and the level sensor is healthy.

**Q7. When does it stop automatically?**
When the level reaches the **overflow threshold** (95% by default). It also stops when maintenance mode is turned on,
when the level sensor becomes faulty, or when Pump Demo Mode is turned off.

**Q8. The water level doesn't rise when the pump is ON. Why?**
Because the pump is virtual: nothing is pumping water. In the demo we raise the level by hand to show the automatic
overflow stop. With a real pump connected, the level would rise by itself.

**Q9. Where are the thresholds set?**
In Admin Panel → Configuration (Low-Level and Overflow thresholds). The ESP32 reads them from the cloud every second,
so changes apply without re-flashing.

**Q10. How fast does a dashboard command reach the ESP32?**
The ESP32 checks for commands about **every 1 second**, so the pump state changes within a second or two. Every open
dashboard and phone updates live through Firebase.

**Q11. What happens if the internet goes down?**
The automatic start and stop logic runs **on the ESP32 itself**, so it keeps working without the cloud. Dashboard
commands cannot reach the controller until it reconnects. If the controller stops reporting, the app marks it
"Controller Offline" and disables its pump switch.

**Q12. What happens after a power failure?**
The ESP32 restarts with the virtual pump **OFF** and reads the current settings again. One detail: if the pump was ON
in the database when the power went out, the controller may read that as an ON command after it restarts, and turn
the virtual pump back on, but only if all the safety checks pass (demo mode on, no maintenance, level below overflow,
sensor healthy). It also runs the automatic rules again, so it stops at overflow as usual.

## C. Safety and access

**Q13. Could this accidentally switch a real pump?**
No. With `PUMP_RELAY_ENABLED 0` the firmware never configures or writes GPIO 32, so even if something were wired to
that pin, nothing would switch.

**Q14. Who can control the demo pump?**
- **Admin:** any tank.
- **Worker:** only the tank assigned to them, and only when the Pump Control Lock is off.
- **Viewer:** can see the pump status but cannot control it.

Every change asks for confirmation and is logged with the user's name.

**Q15. Can the pump run during maintenance?**
No. Maintenance Mode stops the pump, refuses all pump commands, disables the switch, and suppresses alerts.

**Q16. Can someone turn the pump ON when the tank is full?**
No. The controller refuses a manual ON command when the level is at or above the overflow threshold, and logs
"Manual pump ON command refused …".

**Q17. What if the level sensor fails?**
The controller never starts the pump on a faulty reading. It stops the pump if it was running, and the failure is
logged as CRITICAL.

**Q18. What does Pump Demo Mode OFF do to the controller?**
The ESP32 reads the setting from the cloud. If the virtual pump is running, it stops it and logs "Reason: Pump demo
mode turned off". After that it refuses every pump command, and the app hides every pump control.

## D. Records and reports

**Q19. Is pump activity recorded?**
Yes. The firmware logs every automatic start and stop and every accepted or refused command in System Logs. The app
also logs who pressed the switch (PUMP_ON / PUMP_OFF). Each history sample stores the pump state.

**Q20. What do the Reports show?**
With demo mode on: the current demo pump state, daily "Demo Pump Activity" (number of starts per day) and "Demo
Pump Cycles" for the selected range. These are also included in Excel and PDF exports, labelled as the virtual
pump. With demo mode off, all pump parts are left out of the screens and exports.

**Q21. Does the mobile app show the same thing?**
Yes. The Android app loads the same hosted web app, so the switch, the pump status and Reports are identical, and
both update live.

## E. Scope and honesty

**Q22. Is the pump feature part of your evaluation results in Chapter 4?**
No. Chapter 4 evaluated the monitoring system (accuracy, latency, reliability, usability). The demo pump was not
part of the tests or the survey.

**Q23. Why keep a feature that is out of scope?**
It shows the system is ready for the recommended next step, and it can be hidden with one switch. That keeps the
deployed system honest to the thesis scope.

**Q24. (If asked about the Pump Control Lock) The Admin Panel says admins can still toggle the pump when the lock is on. Is that true?**
Be honest: in the current firmware the lock refuses **every** manual pump command, including an admin's (it logs
"Manual pump toggle refused: Pump control lock is enabled"). The app lets the admin press the switch, but the
controller refuses it. The safe behavior is that nobody can override the lock. Aligning the label (or letting admins
override) is a small follow-up.

**Q25. What are the limitations of the demo?**
- No water actually moves (Q8).
- The 30-second anti-chatter delay means the pump will not restart immediately after it stops.
- The automatic start uses "level ≤ 15%", while the low-level **alert** uses "level < 15%". At exactly 15% the
  virtual pump can start before the alert appears.
- See Q24 for the Pump Control Lock.

**Q26. How would this scale to all MPWSD pump stations?**
Each tank's ESP32 already runs the same pump logic (Tanks 1–4 share one firmware). Scaling means adding relay
hardware per site and, beyond four tanks, extending the software's tank limit. Both are listed in the Chapter 5
recommendations.
