# First session on the real LowRider

Router unplugged (spindle off) for everything up to the air-cut; a hand near the e-stop throughout. Use one browser at a time for the first calibration pass.

## Before you start

1. **Back up the config.** Download `config.yaml` with the stock WebUI and keep it on the laptop. Note whether every axis has `homing/positive_direction` set, and whether `must_home` and `soft_limits` are on (the stock LowRider config leaves both off: nothing refuses a machine-coordinate move before homing, so home first; the app only notes which axes it has not seen homed since it connected).
2. **Have ready:** a V-bit, four strips of masking tape, the touch plate and its clip, calipers or a tape measure, the measured plate thickness (V1's is 0.5 mm) and tape thickness (about 0.1 mm).
3. **Install.** `npm run build`, upload `dist/index.html.gz` with the stock WebUI's file manager as `highroller.html.gz`, open `http://fluidnc.local/highroller.html`. (Or run `VITE_FLUIDNC_HOST=192.168.40.174 npm run dev` and open the laptop's address on the phone.)

## Connection and reading the board

4. **Connect.** Pass: "Connected", the Wi-Fi bars, work coordinates within about a second (no `–.---`), the Tools tab's Start button enabled (the config was read), no "Config not read" in the console.
5. **Settings.** Set the plate and tape thickness on the Tools tab; leave the span at 0 (the X travel) or type the measured distance between the Y rails. Reload the page: the values come back from the board.

## Jogging, STOP, homing, probing

6. **Jog** each axis with taps and holds; STOP during a held jog. Pass: the machine stops at once and the position is kept.
7. **Home all**, then Home Z alone. Pass: after Home all the console shows `[MSG:Homed:Z]` then `[MSG:Homed:XY]` (one line per homing cycle; the app unlocks each axis's machine-coordinate moves from these); the tool dot sits at the corner of the dashed outline, and the outline matches the table with a tape measure.
8. **Arming.** With the clip on, tap the plate to the bit: Probe Z0 turns green. Jog any axis: it turns grey again (arming expires when the machine leaves Idle). With the clip off a tap does nothing.
9. **Probe Z0 on scrap.** Pass: the three slow touches agree within 0.05 mm (watch the console), work Z reads the plate thickness at contact and 5 mm more after the lift, and `G0 Z0` afterwards gives a paper-drag fit on the stock.
10. **Probe miss.** No plate, bit well above anything, arm with a tap, Probe. Pass: the bit drops 20 mm, "No contact" is shown, the machine returns to Idle on its own.
11. **STOP during the fast search.** Pass: no further motion; Idle or Alarm without a re-home.
12. **Helpers.** Go to XY0 raises to work Z 10 only when lower; Raise Z goes to the top without hitting the switch; double-tap a coordinate on the phone, type a negative work value that is inside the travel: it goes; one outside: the note line says so.
13. **Tap-to-go** (after homing, bit raised). Pass: the console shows exactly the confirmed `G53 G0`, the position matches a tape measure, a tap outside the outline does nothing.

## A job

14. **Air-cut a small file** with the spindle unplugged. Pass: Run asks first; percentage and time left fall smoothly; Pause then Resume works; STOP mid-job holds then resets and keeps the position; progress reaches 100 % after the SD field disappears; file actions are disabled while it runs.

## Calibration

15. **Pass 1.** Tools → Start calibration. Read each "These lines run next" block before Continue; they must match what the console then shows.
    - Corner A: jog **Z only** (the pad offers only Z) to a few mm above where the plate will sit.
    - Each corner: tape, plate, clip, tap to arm, Probe, the bit lifts, slide the plate out, Continue for the dot (through the tape and the "dot depth" below it, 0.3 mm by default on the Tools tab: that is what makes the V-bit mark visible). The rapid between corners is at the travel height (first touch + 10 mm): watch that it clears the tape and plate.
    - Measure the dot centres. A measurement more than 1 % or 10 mm off the commanded length is re-asked.
    - Review: expect tilt and skew of a few mm at most, pull-offs within about ±3 mm of 4.000, steps/mm change under 1 %. Untick anything doubtful.
    - Apply: the board writes `config.yaml.bak` first, then the config, restarts, reconnects and homes. Pass: "Applied"; homing sounds normal (no racking); the stock WebUI shows both files, and `config.yaml` differs from your backup only in the ticked values.
16. **Pass 2** with fresh tape on the same spots. Pass: the remaining error is smaller; `config.yaml.bak` is unchanged. If the review says it swapped a motor side, note it: the machine's layout or sign differs from the assumption, and the next pass should improve.
17. **Abort paths.** Cancel at a waiting step; STOP during a corner move. Pass: "Stopped" and nothing else moves.
18. **Recovery drill.** Once, restore `config.yaml` from `config.yaml.bak` with the stock WebUI, so the way back is known.
19. **Level the gantry only.** Tools → Level the gantry only: corner A with the plate (no tape), lift, pick the plate up, Continue; the same at corner B. Pass: the review lists just the Z pull-offs, the tilt matches the last full pass, and the done view shows tilt without a skew. Apply, home, run it again: the tilt should be near zero.

## Flatness map and surfacing (after calibration)

20. **Flatness map.** Tools → Probe the table, 3 × 3 to start. At each point: tape is not needed, just the plate on the table under the bit, clip on, tap to arm, Probe; the bit lifts, pick the plate up, Continue. Pass: the result table shows heights of 0 or below with the highest cell marked, the tilt matches what the calibration left (near zero after a good pass), and the verdict says "Flat enough" or gives a depth. Press **Zero Z at the highest point**: the Z readout changes by the plate thickness plus the lift.
21. **Surfacing pass.** Check the cutter diameter (25.4 for the 1" bit), leave stepover 40 % and depth per pass 0.5, and the depth from the map. **Create and open** sets work X0 Y0 at the cut's corner (the readout shows negative X and Y while the bit is at home), uploads the file and opens it. Pass: the preview fills the dashed outline. Run: the job holds at the first corner with the router off; switch the router on, press Resume, and watch the first row. STOP is hold then reset, as always. Expect about two hours for a full table at 2500 mm/min with a 1" bit.

## Soft limits and a corrected steps-per-mm

With `soft_limits: true`, an axis's travel starts exactly at its `homing/mpos_mm`. Homing sets the position in whole motor steps, so once steps-per-mm is no longer a round number (after a steps/mm correction), a non-zero `mpos_mm` such as 3 lands a fraction of a step outside the travel (3 mm × 50.05 = 150.15 steps → 150 steps → 2.997 mm) and the first move after homing raises ALARM:2 "Soft limit". Fix: set `mpos_mm: 0.000` for that axis (and add 3 to `max_travel_mm` to keep the same far end), then home again. Zero times any steps-per-mm is exact.

## Stopping at the switches

An over-jog runs into a switch and chatters against it (the stepper skipping), bending the switch arm and with it the home position. Two settings stop that; both are set live with `$/…` and kept with `$CD=config.yaml` (FluidNC 3.9.9, checked in its source):

- `soft_limits: true` on an axis clamps every jog to the travel: a hold-to-run jog stops at the travel's edge with no alarm and no contact (`Cartesian::constrain_jog`), and a G0/G1 past it is refused with ALARM:2 before it starts. It needs a homed machine and a right `max_travel_mm`, and the `mpos_mm` note above applies to every axis whose steps-per-mm is no longer a round number.
- `hard_limits: true` on a motor (it sits under `motor0`/`motor1`, beside the switch pin, not on the axis) makes any closure of that switch outside homing an immediate stop: ALARM:1, steppers off, position forgotten. Recover with STOP (a reset), Unlock, a jog away from the switch (FluidNC allows a nudge of up to the pull-off off an active switch), then Home. The catch: noise on a switch wire trips a false ALARM:1 mid-job, so try it on jogs for a while before trusting it under a cut.

```
$/axes/z/soft_limits=true
$/axes/z/motor0/hard_limits=true
$/axes/z/motor1/hard_limits=true
$CD=config.yaml
$H
```

(Y also has two motors; X has one. `$/axes/z/motor0/hard_limits` alone, without `=`, shows the current value.)
