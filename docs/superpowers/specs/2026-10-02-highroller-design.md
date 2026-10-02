# HighRoller: design

2026-10-02 · Draft for review

## Goal

HighRoller is a web app that runs a LowRider v4 CNC router from a phone or a desktop browser. It talks to the FluidNC firmware on a V1 Engineering Jackpot controller board. Compared with the stock FluidNC WebUI, it should be:

- more intuitive and more fun to use;
- equipped with guided calibration wizards and shortcuts for common tasks.

Ideas held back from 1.0 are listed in [TODO.md](../../../TODO.md).

## Platform

- **Stack:** Svelte 5 and Vite, written in plain JavaScript with no UI library.
- **Build output:** one compressed file, `index.html.gz`, made with `vite-plugin-singlefile` and then `gzip -9`. Target size is under 100 KB.
- **Hosting:** the file is served from the Jackpot's flash storage (LocalFS). The page and the websocket then come from the same plain-`http` address, so the browser never blocks the connection the way it would for an `https` page.
- **Development:** run the Vite dev server on the laptop over `http`. Point it at the board, or at the fake server, with `VITE_FLUIDNC_HOST`. Phones on the same network can open the dev server too.
- **Installing alongside the stock WebUI:** first install HighRoller as a second page, for example `highroller.html.gz`. Rename it to `index.html.gz` once it's trusted.
- **Recovery:** if the page breaks, remove it over USB serial with `$LocalFS/Delete=/index.html.gz`. FluidNC's built-in fallback upload page then appears.
- **No service worker and no screen wake lock.** Browsers only allow these on `https` pages. A phone screen may therefore sleep during a job, so the app is built to reconnect (see Connection).

## Code layout

```
src/
  lib/fluidnc.js     protocol: websocket, command queue, status parsing, HTTP files
  lib/gcode.js       G-code → segments, trail matching, time estimate
  lib/calib.js       squaring, tilt and steps/mm math; pull-off rules
  lib/yaml-edit.js   edits to config.yaml text
  lib/*.test.js      node --test
  App.svelte, components (Jog, Job, Preview, Overrides, Wizards, Console, Files, Settings)
dev/fake-fluidnc.js  fake machine for development
```

Only `fluidnc.js` knows the protocol. Everything in `lib/` is plain functions that can be tested without a browser.

## Talking to FluidNC

Details below were checked against FluidNC's source code, versions 3.9.9 and 4.1.1.

**Websocket**
- Address depends on the firmware version, so the app tries the 4.x address first and then the 3.x one:
  - FluidNC 4.x: `ws://<host>/`, on port 80.
  - FluidNC 3.x: `ws://<host>:81/`, with subprotocol `arduino`.
- Incoming binary frames carry the console output. They're decoded with `TextDecoder` and buffered into whole lines, which end in `\r\n`.
- Incoming text frames are control messages (`currentID:`, `CURRENT_ID:`, `ACTIVE_ID:`, `PING`). The app ignores them.
- Commands and real-time bytes are sent as websocket text frames. FluidNC treats anything it receives on the websocket exactly like serial input.

**Commands**
- One line is sent at a time. The next line goes out only after FluidNC replies `ok` or `error:N`.
- `send(line)` returns a promise that settles with that reply.

**Real-time bytes** are single bytes FluidNC acts on immediately. They skip the queue:

| Byte | Action |
|---|---|
| `?` | Status report |
| `!` | Feed hold |
| `~` | Resume |
| `0x18` | Soft reset |
| `0x85` | Cancel jog |
| Override bytes | Change feed, spindle or rapid % |

Bytes of `0x80` and above are sent as one-character strings. The browser encodes them as UTF-8, and FluidNC decodes UTF-8 before acting on them.

**Status reports**
- The app turns on auto-reporting with `$RI=100`, which gives 10 reports a second.
- FluidNC only auto-reports while the machine moves or when something changes. So whenever nothing has arrived for 250 ms, the app sends `?`.
- If nothing at all arrives for 3 s, the app treats the link as dead and reconnects. That also covers a phone waking from sleep.
- Fields parsed: `State` (including `Hold:0`/`Hold:1`), `MPos` or `WPos` (depending on FluidNC's `$10` setting), `WCO`, `FS`, `Ov`, `Pn`, `A`, `SD`.
- `WCO` (work offset) and `Ov` (overrides) only appear in some reports, so their last values are cached. `A` (spindle and coolant state) only appears alongside `Ov`.
- Work position: WPos = MPos − WCO. If the report gives WPos instead, MPos = WPos + WCO.

**Waiting and probing**
- To wait until motion has finished, the app sends `G4 P0`. Its `ok` only arrives once all earlier moves are complete.
- The probe command is `G38.2`. The result comes back as `[PRB:x,y,z:1]`. If the probe never makes contact, FluidNC raises an alarm.

**HTTP**
- SD card: list, upload (with a progress bar), download, delete.
- Flash: read and upload, used for the config file, `highroller.json` and app updates.
- Endpoints by version:
  - FluidNC 4.x: WebDAV at `/sd/…` and `/flash/…`, using GET, PUT, DELETE and PROPFIND.
  - FluidNC 3.x: the older `/upload` (SD card) and `/files` (flash) endpoints.

  Which one to build depends on the board's firmware version (see "Verify on hardware").
- FluidNC refuses to serve files from flash while the machine is moving. So the app reads the config file and `highroller.json` while idle and keeps them in memory.
- The current job's G-code is cached in the browser (IndexedDB), so a page reload during a cut doesn't have to download the file again.

**Active config file:** found with `$Config/Filename`. It is normally `config.yaml`.

## Screens

**Always visible**
- Connection badge.
- Machine state.
- Large STOP button.
- An alarm banner when needed, with the reason in plain language and Home / Unlock buttons.

**Layouts**
- **Phone:** bottom tabs: Jog · Job · Tools · More.
- **Desktop (900 px and wider):** one dashboard. Position readout, jog pad and zeroing sit on the left, the preview in the centre, and job controls and overrides on the right. Tools and More open as panels.
- **Desktop keyboard:** arrow keys jog X and Y, PgUp and PgDn jog Z, and `[` and `]` change the step size.

**Jog tab**
- Large position readout in work coordinates, with machine coordinates shown smaller.
- XY pad and a Z rocker.
- Step sizes 0.1 / 1 / 10 / 100 mm. A tap moves one step with `$J=G91 …`.
- Press and hold for continuous jogging; a press shorter than 300 ms counts as a tap.
- While held, the app sends short jog moves of 0.1 s of travel each, keeping about 0.25 s of motion queued in FluidNC. On release it sends a jog cancel.
- If the connection drops, the machine therefore stops within a fraction of a second instead of running to the end of travel.
- Zeroing buttons:
  - Probe Z0 with the touch plate.
  - Zero X/Y here.
  - Zero Z here.
  - Go to XY0.
  - Raise Z (to the top of travel).

**Job tab:** list of files on the SD card, upload, preview, Run / Pause / Resume / Stop, progress, elapsed and remaining time, and overrides.

**Tools tab:** the Square & scale, Z tilt and Outputs wizards.

**More tab**
- **Console:** send raw commands and see the output.
- **Files:** list, upload, download and delete files on both the SD card and the flash.
- **Settings.**

## Jobs

- **Running from the SD card:** jobs run with `$SD/Run=<path>`. The browser can disconnect and the job keeps going.
- **Pause and resume:** Pause sends `!`, Resume sends `~`.
- **Stop:**
  1. Send `!` to hold.
  2. Wait for the state to show `Hold:0`, meaning motion has stopped. Give up waiting after 1 s.
  3. Send `0x18` to reset. Resetting after the hold keeps the machine's position, so no re-home is needed.
  4. Offer the Raise Z button.

  STOP is software. A physical e-stop is still recommended.
- **Remaining time:**
  1. Estimate each remaining segment's time from the G-code: length ÷ feed rate, with rapids at the axes' maximum rate from the config.
  2. Scale that estimate by how fast the job is really going: actual elapsed time ÷ estimated elapsed time so far.

## Preview and tracking

**Reading the G-code** (`gcode.js`)
- Handles: G0/G1/G2/G3, arcs in XY given by I/J or R (split into short straight pieces), G90/G91, G20/G21 and comments.
- Turns the file into segments. Each segment records:
  - start and end points;
  - whether it is a rapid move;
  - the byte position in the file of the line it came from;
  - the cumulative estimated time.
- Segments are stored in typed arrays so files of several megabytes still load quickly.

**Drawing**
- Top-down XY view on a 2D canvas, in work coordinates.
- Three layers:
  - toolpath: rapids faint, cuts grey;
  - trail;
  - dot.
- Fits the view on load. Pinch and drag to zoom and pan on touch; wheel and drag on desktop.

**Dot:** the live work position. Green when Z ≥ 0, red when Z < 0.

**Trail**
1. Multiply the `SD:` percentage by the file size to get a byte position.
2. Find the segment at that byte position with a binary search.
3. FluidNC reads the file ahead of the actual motion, so search backwards from that segment for the one closest to the live position.
4. Every segment up to that one is done. Done segments with Z < 0 are drawn red.
5. The trail never moves backwards.

Because the trail only needs the file and the current progress, it rebuilds itself after a reconnect. A job started from somewhere else is picked up too: the app fetches the file named in `SD:`.

## Overrides

- **Feed:** slider, 10–200%.
- **Spindle:** slider, 10–200%. Hidden when the spindle is a simple on/off relay.
- **Rapid:** buttons for 25 / 50 / 100%.
- **How a slider works:** FluidNC only accepts override changes in steps of ±10% or ±1%. A slider works out the sequence of steps from the current `Ov:` value to the target, sends them, then shows the value FluidNC reports.

## Calibration

### Rules every wizard follows

- **Start:** each wizard begins by homing the machine, and only runs when the machine is Idle.
- **Moves:** every planned move is listed before it runs.
- **Config changes:** each one shows the old and new values and waits for confirmation.
- **STOP:** available at every step.
- **Probing:** the touch plate is probed the same way everywhere (the Z0 helper and the wizards):
  1. The bit parks above the spot. The user places the plate, attaches the clip, then touches the plate to the bit and holds it for about a second. The Probe button only becomes available after the status report shows the probe circuit (`Pn:P`) close and open again. This prevents the crash where the clip is off and the bit drives into the plate.
  2. Fast search with `G38.2` at 300 mm/min, going at most 20 mm below the start, then back off 1 mm.
  3. Three slow touches at 25 mm/min, backing off 1 mm between them. The result is the middle (median) value. If the three readings differ by more than 0.05 mm, the point is rejected and has to be redone.
  4. If the probe never makes contact, FluidNC raises an alarm. The wizard stops and says why.
- **Travel height:** at a wizard's first point, the user jogs the bit to about 5–10 mm above the plate. Moves to later points happen at the first touch height + 10 mm.

### Applying config changes

Every wizard uses the same steps:

1. Download the active config file.
2. On the first change in a session, upload the unchanged original as `<name>.bak`.
3. Edit the YAML text in place with `yaml-edit.js`, either by setting a value at a key path or by replacing a whole top-level block. The user's comments and layout survive.
4. Upload the edited file.
5. Restart FluidNC with `$Bye`, reconnect, and home.

A restart only takes a few seconds and every wizard re-homes anyway, so there is no separate path for changing settings live.

### Square & scale (dots on tape)

One run measures both squareness and X/Y steps/mm.

**Making the dots**
1. Four corners of a W × H rectangle in machine coordinates. By default it is as large as the travel allows, minus 50 mm at each edge.
   - A: X-min, Y-min
   - B: X-max, Y-min
   - C: X-max, Y-max
   - D: X-min, Y-max
2. The user fits a V-bit. At each corner the wizard asks them to stick a piece of tape under the bit.
3. At each corner:
   1. Probe with the plate sitting on the tape. The tape's top surface = touch height − plate thickness.
   2. The user removes the plate.
   3. Make sure the spindle is off: the wizard sends `M5`, or asks the user to switch off a router that's turned on by hand.
   4. Push the V-bit down to (tape surface − tape thickness), then lift. This leaves a dot in the tape.

**Measuring:** the user measures whichever of these they want and enters them.
- **Diagonals AC and BD → squaring.**
  - Skew angle: θ = (AC² − BD²) / (4·W·H).
  - Correction: Δ = θ · S, where S is the gantry span, a setting.
  - Applied as ±Δ/2 to the `pulloff_mm` of the two Y motors.
- **Sides AB and DC (for X) and AD and BC (for Y) → steps/mm.**
  - New steps/mm = current steps/mm × commanded distance ÷ the average of the two measured sides.
  - Skew doesn't change side lengths, so both calibrations come from one set of dots.

**Repeating:** put fresh tape on the same spots and run it again to check.

**Tape thickness:** a setting, 0.1 mm by default. Increase it if the dots are hard to see.

### Z tilt

1. At the current Y, probe near X-min, which gives a touch height z₁ at position x₁. Then probe near X-max, which gives z₂ at x₂. The wizard prompts the user to move the plate between the two.
2. Correction: Δ = (z₂ − z₁) / (x₂ − x₁) · S. Applied as ±Δ/2 to the `pulloff_mm` of the two Z motors.
3. Restart, home, and probe both points again. Show what error is left. Repeat until |z₂ − z₁| is 0.05 mm or less; the tolerance is a setting.

Notes:
- The plate's thickness doesn't matter here, because only the difference between the two touches is used.
- Probe a flat surface that this machine did not surface. A spoilboard the machine surfaced itself already follows the gantry's tilt, so it reads close to zero. Calibrate Z tilt before surfacing, and resurface after any change.

### Pull-off rules (both squaring and Z tilt)

- **Which motor is on which side:** whether motor0 or motor1 is on the left is a setting, one per axis. If an adjustment makes the next measurement worse, the app concludes the setting is backwards, flips it, and works from the new measurement.
- **Minimum pull-off:** a pull-off never goes below 1 mm. If an adjustment would push one below that, both motors are raised so the lower one sits at exactly 1 mm.

### Outputs

**Roles**
- **Spindle relay**, switched by M3 / M5: the `output_pin` of a `Relay:` spindle.
- **Dust collector**, one of:
  - *follows the spindle*: the Relay spindle's `enable_pin`, so it switches with M3 / M5 in the firmware and keeps working if the app is disconnected;
  - *its own switch*: `coolant: flood_pin`, switched with M8 / M9.

**Steps**
1. Pick a pin from the Jackpot's spare outputs.
2. Apply it through the config change steps above.
3. Test it with On and Off buttons.
4. If it's wrong, Revert restores the backup.

FluidNC can't switch a pin until it's in the config, so testing happens after applying, not before.

Z steps/mm isn't calibrated: the LowRider's Z is driven by a leadscrew, so its steps/mm follows directly from the screw's pitch.

## Settings

Settings are stored on the board in `highroller.json` (on the flash), so the phone and the desktop share them:
- gantry span S;
- touch-plate thickness;
- tape thickness;
- which motor is on which side, for Y and for Z;
- jog step sizes and speeds;
- Z-tilt tolerance.

## Connection

- **Dropped connection:** the app reconnects automatically, waiting a little longer after each failed attempt. A banner reads "Reconnecting, the machine is still running".
- **On connect or reconnect:**
  1. Read the machine state, `highroller.json` and the config file.
  2. If `SD:` shows a job running, load that file and rebuild the preview and trail.

## Testing

- **Logic:** plain JavaScript modules tested with `node --test`, with no test framework. Covers:
  - the status parser;
  - the G-code reader;
  - trail matching;
  - override step sequences;
  - the YAML edits;
  - the squaring, tilt and steps/mm math, including the pull-off rules.
- **Fake machine:** `dev/fake-fluidnc.js` runs on Node with the `ws` package, as a development-only dependency. It starts with:
  - status reports;
  - jogging and G0/G1 moves;
  - probing against a fixed surface;
  - overrides.

  It grows only as features need it.
- **On the machine:** each wizard runs against the fake first, then on the real machine with a hand near the e-stop.

## Verify on hardware

Settled by reading FluidNC's source (versions 3.9.9 and 4.1.1):
- **Websocket:** address by version, commands sent over the websocket, and how frames are split. See "Talking to FluidNC".
- **Status fields:** `$RI` (report interval) exists in both versions. `Pn:` and `SD:` appear in status reports.
- **Second page:** any file on flash is served by its name, and the compressed `.gz` copy is used automatically. So `/highroller.html` serves `highroller.html.gz`.
- **Dust collector wiring:** an on/off spindle's `enable_pin` follows M3/M5.

Still open:
1. **The board's firmware version.** Run `$Build/Info` to find it. This decides which file endpoints the app uses.
2. **Spare output pins on the Jackpot.** Take them from V1 Engineering's pinout, then check the user's `config.yaml`.
3. **A smoke test on the real machine:** connect, read position, jog, STOP.

## Build order

Each step is usable on its own:

1. Protocol, position readout, jogging, console. Plus the fake server and the hardware checks above.
2. Files, Job tab, preview and tracking, overrides.
3. Probe routine and the zeroing helpers.
4. Config editing, Square & scale, Z tilt.
5. Outputs. Then switch over to `index.html.gz`.
