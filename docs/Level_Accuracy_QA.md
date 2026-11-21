# Water Level Accuracy: Q&A for the Defense

Prepared 2026-11-21 from the level accuracy test of **21 November 2026** on the Tank 1 drum model (0.90 m), reported in
the thesis as Table 4.4 and section 4.2.1.3. Numbers below match that table.

**Keep in mind:** the 200 L, 0.90 m drum is only the **test model**. The system is meant for the MSU Motor Pool
reservoir tanks, which are about **5 m tall**. The level sensor is rated 0 to 5 m, so it was chosen for the real
tanks, not for the drum (Q11, Q16, Q18).

**One-sentence summary to open with:**
> "On 21 November 2026 we compared the dashboard with a steel tape at nine depths from 10 to 90 cm. The mean
> percentage error was 4.4 %, within our ±5 % target, and the average difference was 2.6 percentage points, about
> 2.4 cm on a 0.90 m drum."

---

## The results at a glance

| Tape depth | True level (% of 0.90 m) | Dashboard | Deviation (points) | Percentage error | ≤ ±5 %? |
|---|---|---|---|---|---|
| 10 cm | 11.1 | 11 | 0.1 | 1.0 % | Passed |
| 20 cm | 22.2 | 21 | 1.2 | 5.5 % | Not met |
| 30 cm | 33.3 | 35 | 1.7 | 5.0 % | Passed |
| 40 cm | 44.4 | 45 | 0.6 | 1.3 % | Passed |
| 50 cm | 55.6 | 59 | 3.4 | 6.2 % | Not met |
| 60 cm | 66.7 | 71 | 4.3 | 6.5 % | Not met |
| 70 cm | 77.8 | 83 | 5.2 | 6.7 % | Not met |
| 80 cm | 88.9 | 95 | 6.1 | 6.9 % | Not met |
| 90 cm | 100.0 | 99 | 1.0 | 1.0 % | Passed |
| **Mean** | | | **2.6** | **4.4 %** | **Passed** |

Other figures you may be asked for: RMSE 3.3 points; largest error 6.1 points (5.5 cm) at 80 cm; R² = 0.994
(the readings follow the true level closely, almost in a straight line).

---

## A. The method

**Q1. How did you test the level accuracy?**
We filled the Tank 1 drum model in steps and, at each 10 cm mark from 10 to 90 cm, measured the water depth with a
steel tape from the floor of the drum and read the level percentage on the dashboard. The tape depth was converted
to a percentage of the 0.90 m drum height (for example 50 cm ÷ 90 cm = 55.6 %) and compared with the dashboard.

**Q2. How did you compute the error?**
Percentage error = |dashboard − tape level| ÷ tape level × 100. For 50 cm: |59 − 55.6| ÷ 55.6 × 100 = 6.2 %. The mean
of the nine percentage errors is 4.4 %. We also report the absolute deviation in percentage points (mean 2.6).

**Q3. Why is there no reading at 0 cm?**
Before the test we lifted the sensor out of the water and confirmed the dashboard read 0 %, so the empty point was
checked. During the test some water was left in the drum (it read 5 %), so a true 0 cm reading was not possible.
The test starts at 10 cm.

**Q4. Why only nine points and one reading per level?**
Nine levels cover the whole drum in equal 10 cm steps. One reading per level is a limitation of our test; repeating
it two or three times and averaging would make the result stronger, and we recommend it. *(If you repeat the test
before the defense, replace this answer with the mean of the trials.)*

**Q5. Why did you choose ±5 % as the target?**
The level is used for alerts at 15 % (low) and 95 % (overflow), not for billing or exact volume. An error of a few
percent does not change when these alerts fire in practice, and ±5 % is achievable with low-cost sensors on an
ESP32. The target was set in Chapter 3 (Table 3.7) before testing.

## B. The result

**Q6. Is 4.4 % good enough?**
Yes for its purpose. It meets the ±5 % target we set, and in real terms the average difference is about 2.4 cm on a
0.90 m drum. For monitoring and low/overflow alerts this is sufficient.

**Q7. The mean passes, but five of nine levels failed individually. Isn't that a problem?**
The target was defined for the mean error, and the mean meets it. We do not hide the individual failures; Table 4.4
shows them. Four of the five (50 to 80 cm) come from one consistent pattern, the sensor over-reading in the middle
of the range (Q10), not from random noise. The fifth, 20 cm, is explained in Q8.

**Q8. Why did 20 cm fail when it was only 1.2 points off?**
Percentage error divides by the true level. At low levels the true level is small, so a small difference becomes a
large percentage: 1.2 ÷ 22.2 = 5.5 %. The same 1.2 points at 80 cm would be only 1.3 %. That is why we also report the
deviation in percentage points.

**Q9. What was the worst case?**
At 80 cm the dashboard showed 95 % against a true 88.9 %: 6.1 points, or 5.5 cm too high. Note that 95 % is also the
overflow threshold, so at that depth an overflow warning would come about 5 cm early. Early is the safe direction for
an overflow warning.

## C. Why the error happens

**Q10. Why do the readings run high between 50 and 80 cm?**
Both calibration ends agree with the tape: 0 % with the sensor out of the water and 99 % at 90 cm. So the empty and
full voltages (Vmin and Vmax) are correct. The error in between means the voltage the ESP32 measures does not rise in
a perfectly straight line with depth. The ESP32's built-in analog-to-digital converter (ADC) is known to be slightly
non-linear. Our firmware computes the level with a straight line between the two calibration points (two-point
calibration), so a curve in between cannot be corrected.

**Q11. Why is the ADC curve so noticeable on your system?**
Because the test drum is much shorter than the tank the sensor was chosen for. The submersible sensor is rated 0 to
5 m (4 to 20 mA) to match the 5 m reservoir tanks. The 0.90 m drum uses only about 18 % of that range (4 to about
6.9 mA), so the whole drum spans only about 0.7 V at the ESP32 input (calibrated empty about 0.5 V, full about 1.2 V).
One percent of the drum is only about 7 mV, so an ADC error of a few tens of millivolts becomes several percent.
On a 5 m tank the sensor uses its whole range (Q16).

**Q12. Does the firmware add any error?**
Yes, up to about 2 points, by design. (1) The level percentage is stored as a whole number with the decimal part
dropped (88.9 becomes 88). (2) The dashboard level changes only when the level moves by 2 % or more (the deadband),
which stops small ripples from flooding the database and the history. Both trade a little accuracy for stable
readings and fewer uploads.

**Q13. Could the water have been moving when you read it?**
The firmware already smooths the reading: each sample averages 16 ADC conversions, then a median of 5 and a moving
average of 10 samples remove spikes and ripples. Reading too soon after pouring can still show a value that has not
settled. We recommend waiting about 30 seconds at each level in a repeated test.

**Q14. Is the drum shape a factor?**
No. The system measures height, and the percentage is height ÷ 0.90 m. The drum's shape would matter only for
volume in litres, not for this test.

## D. Improvements and scope

**Q15. How would you make it more accurate?**
Three options, from cheapest:
1. **Multi-point calibration:** add a mid-point (for example at 45 cm) so the firmware uses two straight lines
   instead of one. This targets the 50 to 80 cm over-reading directly.
2. **External ADC:** a 16-bit ADS1115 module reads voltage more linearly and finely than the ESP32's built-in ADC.
3. **A sensor with a range matched to the tank** (for example 0 to 1 m for the drum), so the drum uses the whole
   4 to 20 mA range.

**Q16. Will the accuracy be the same on the real 5 m reservoir tanks?**
We expect the **percentage** error to be smaller, but it must be confirmed by a test after installation. On a 5 m tank
the sensor uses its full 4 to 20 mA range, and the HW-685 can be set to spread it over about 0.5 to 3.0 V, about
2.5 V instead of 0.7 V. One percent of the tank is then about 25 mV instead of 7 mV, so the same ADC error is about
a third as large in percent. In centimetres it is not smaller: 1 % of a 5 m tank is 5 cm, so a 1 to 2 % error is
5 to 10 cm. For low and overflow alerts on a 5 m tank this is still adequate.

Nothing in the firmware has to change: the calibration (Vmin, Vmax, tank height 5.00 m, which is the firmware
default) is set per tank in the Admin Panel. Two cautions for installation: keep the full-tank voltage at or below
about 2.5 to 3.0 V, because the ESP32's ADC is least linear near its top; and since the sensor tops out at 5 m, a tank
filled above 5 m from the sensor would read 100 % and no higher.

**Q17. Why not compare with a commercial level meter instead of a tape?**
A steel tape measuring depth from the drum floor is a direct, simple reference with millimetre marks, and it is the
method the MPWSD already uses manually. A certified level meter was not available and is not needed to check an
error of a few centimetres.

---

**Q18. If the real tanks are 5 m tall, why did you test on a 0.90 m drum?**
A 5 m reservoir could not be emptied, filled in steps and measured with a tape for a pilot test, and the controller
could not be installed on the Motor Pool tanks during development. The 200 L drum is a scaled model of Reservoir Tank
No. 1: it tests the same sensor, ESP32, firmware, cloud and dashboard. Because the drum uses only a small part of the
sensor's range, it is a harder test of percentage accuracy than the real tank would be (Q11, Q16).

## Things to avoid saying

- Do not say the sensor is "accurate to ±5 % at every level". It is the **mean** that meets ±5 %.
- Do not blame the tape or the water for the 50 to 80 cm error; the pattern is consistent, which points to the
  ADC/sensor curve (Q10).
- Do not claim the 4.4 % for the real 5 m reservoir; it was measured on the 0.90 m drum model only. Say you
  **expect** a smaller percentage error there and that it needs an on-site test (Q16).
