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
- While an SD job runs, FluidNC reads lines only from the file: the app's own queries wait for idle; real-time bytes still work.

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
- Fields parsed: `State` (including `Hold:0`/`Hold:1`), `SD` (`<percent>,<path>` while FluidNC is reading the file; the field disappears once the whole file has been read, while the last moves are still cutting, so the app keeps following a running job until the state returns to Idle), `MPos` or `WPos` (depending on FluidNC's `$10` setting), `WCO`, `FS`, `Ov`, `Pn`, `A`.
- `WCO` (work offset) and `Ov` (overrides) only appear in some reports, so their last values are cached. `A` (spindle and coolant state) only appears alongside `Ov`.
- Work position: WPos = MPos − WCO. If the report gives WPos instead, MPos = WPos + WCO.

**Waiting and probing**
- To wait until motion has finished, the app sends `G4 P0`. Its `ok` only arrives once all earlier moves are complete.
- The probe command is `G38.2`. The result comes back as `[PRB:x,y,z:1]`. If the probe never makes contact, FluidNC raises an alarm.

**HTTP**
- SD card: list, upload (with a progress bar), download, delete.
- Flash: read and upload, used for the config file, `highroller.json` and app updates.
- **One file API for both versions.** FluidNC 3.x and 4.x both serve the same endpoints, so the app uses one implementation (checked in source; 4.x adds WebDAV alongside but keeps these):
  - list: `GET /upload?path=/`, which returns JSON (`files: [{name, size}]`, with size −1 for a folder);
  - delete: `GET /upload?path=/&action=delete&filename=<name>`;
  - upload: a multipart `POST /upload`, where the field `/<name>S` holds the size and comes before the file;
  - download: `GET /sd/<name>`.
- **Downloads while the machine moves.** On 4.x, WebDAV answers `/sd/<name>`, so downloads work during a job. On 3.x they are refused while the machine moves.
- **Dev server.** It proxies `/upload`, `/sd/`, `/files` and the flash files the app reads (`/<name>.yaml`, `.json`, `.bak`) to the board or the fake, so the app's relative URLs work the same in development as on the board.
- **This machine runs FluidNC 3.9.9:** websocket on port 81, and downloads are refused while moving.
- FluidNC serves a flash file over HTTP at `/<name>` while the machine is idle (or in alarm) and refuses during motion. So the app reads the config file and `highroller.json` that way while idle, on every connection (after a reconnect mid-job the old copy is kept until the job is over), and keeps them in memory. The text is the file's exact bytes. `$LocalFS/Show` is not used for them: FluidNC broadcasts `[MSG:…]`, `[PRB:…]` and `ALARM:` lines to every client, and they land among its lines; it also truncates lines over 254 characters and drops blank ones.
- The current job's G-code is cached in the browser (IndexedDB), so a page reload during a cut doesn't have to download the file again.

**Active config file:** found with `$Config/Filename`. It is normally `config.yaml`.

## Screens

**Always visible**
- Connection badge, with the controller's Wi-Fi signal strength next to it (from `$System/Stats`, polled every 15 s; hidden in access-point mode).
- Machine state.
- Large STOP button.
- An alarm banner when needed, with the reason in plain language and Home / Unlock buttons.

**Layouts**
- **Phone:** bottom tabs: Jog · Job · Tools · More.
- **Desktop (1000 px and wider):** one dashboard. Position readout, jog pad and zeroing sit on the left, the preview in the centre, and job controls and overrides on the right. Tools and More open as panels.
- **Desktop keyboard:** arrow keys jog X and Y, PgUp and PgDn jog Z, and `[` and `]` change the step size.

**Jog tab**
- Large position readout in work coordinates, with machine coordinates shown smaller.
- XY pad and a Z rocker.
- Step sizes 0.1 / 1 / 10 / 100 mm. A tap moves one step with `$J=G91 …`.
- Press and hold for continuous jogging; a press shorter than 300 ms counts as a tap.
- While held, the app sends short jog moves of 0.1 s of travel each, keeping about 0.25 s of motion queued in FluidNC. On release it sends a jog cancel.
- FluidNC quietly caps jog speed at each axis's maximum rate. So the app reads `$/axes/<axis>/max_rate_mm_per_min` on connect and caps jog speeds at those values. It also never lets the distance it has sent get more than 0.6 s of travel ahead of the position FluidNC reports.
- Every time the websocket connects, the app sends a jog cancel, so a jog left over from before a dropped link never continues.
- If the connection drops, the machine therefore stops within a fraction of a second instead of running to the end of travel.
- Zeroing buttons:
  - Probe Z0 with the touch plate (its hint is a tooltip; the button turns green once the plate has touched, and a press before that shows the hint in a fixed note line so nothing shifts).
  - Zero X/Y here.
  - Zero Z here.
  - Go to XY0 (first raising to work Z 10 if the bit is lower, not to the top of travel).
  - Home all, Home X, Home Y, Home Z: smaller buttons, enabled in Idle or Alarm.
  - Double-click a coordinate to type a destination for that axis (work or machine).
  - Raise Z (to the top of travel).

**Job tab:** list of files on the SD card, upload, preview, Run / Pause / Resume / Stop, progress, elapsed and remaining time, and overrides.

**Tools tab:** the Calibrate routine, the Flatness map, the Surfacing pass, the Outputs wizard, and the settings form.

**More tab**
- **Console:** send raw commands and see the output.
- **Files:** list, upload, download and delete files on both the SD card and the flash.
- **Settings.**

## Jobs

- **Running from the SD card:** jobs run with `$SD/Run=<path>`. The browser can disconnect and the job keeps going.
- **Pause and resume:** Pause sends `!`, Resume sends `~`.
- **Stop:**
  1. Send `!` to hold.
  2. Wait 150 ms for a fresh status report, then wait for the state to show `Hold:0`, meaning motion has stopped. Give up waiting after 2 s (slowing from a full-speed rapid takes about 0.75 s on the stock LowRider).
  3. Send `0x18` to reset. Resetting after the hold keeps the machine's position, so no re-home is needed.
  4. Offer the Raise Z button.

  STOP is software. A physical e-stop is still recommended.
- **STOP during a job aborts the job** (hold, then reset). A feed hold alone would leave the router spinning. The Job tab has separate Pause and Resume buttons.
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
3. FluidNC reads the file ahead of the actual motion, so walk forward from the last segment to the first one the tool is on, bounded by the planner depth.
4. Every segment up to that one is done. Done segments with Z < 0 are drawn red.
5. The trail never moves backwards.

Because the trail only needs the file and the current progress, it rebuilds itself after a reconnect. A job started from somewhere else is picked up too: the app fetches the file named in `SD:`.

## Overrides

- **Feed:** slider, 10–200%.
- **Spindle:** slider, 10–200%. Hidden when the spindle is a simple on/off relay. Until step 4 reads the config, it is shown for every spindle.
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
  3. Three slow touches at 25 mm/min, backing off 1 mm between them. The result is the middle (median) value, and the touch position (`[PRB:x,y,z:1]`, machine coordinates). If the three readings differ by more than 0.05 mm, the point is rejected and has to be redone: a wizard lifts 5 mm and shows that point's step again with the reason, as often as it fails (STOP still ends it). The same goes for a probe refused before anything moved.
  4. If the probe never makes contact, FluidNC raises an alarm (the bit went the whole 20 mm down into whatever was there and may have lost steps). The wizard stops and says why. So does a probe that starts with the plate already touching (ALARM:4).
- **Travel height:** at a wizard's first point, the user jogs the bit to about 5–10 mm above the plate. Moves to later points happen at the first touch height + 10 mm.

### Applying config changes

Every wizard uses the same steps:

1. Read the active config file fresh when the wizard starts (`$Config/Filename`, then `GET /<name>` over HTTP while the machine is idle). The text is the file's exact bytes, blank lines and long lines included.
2. Edit the YAML text in place with `yaml-edit.js`, either by setting a value at a key path or by replacing a whole top-level block. The user's comments and layout survive.
3. Just before writing, read the file again. If it differs from the text the change was computed from (another device changed it), refuse. Also refuse unless the edited text has the same number of lines and every line that isn't blank or a comment is still a `key:` line.
4. If `<name>.bak` isn't on the flash yet (`GET /files`), upload the unchanged original as `<name>.bak` (multipart `POST /files`, the flash upload FluidNC's own WebUI uses). An existing `.bak` is kept, so it holds the config from before the first change.
5. Upload the edited file. If that fails, say that `<name>.bak` holds the original and not to restart the controller.
6. Restart FluidNC with `$Bye`, reconnect, and home. If homing is refused (a config FluidNC rejects leaves it in an alarm), say to restore `<name>.bak` with the stock WebUI.

A restart only takes a few seconds and every wizard re-homes anyway, so there is no separate path for changing settings live.

### Calibrate (one routine)

One pass measures Z tilt, squareness and X/Y steps per mm from four V-bit dots on tape, and applies everything with a single config write, restart and home. (Amended 2026-10-03: this replaces the separate squaring and Z-tilt wizards; the corner probes give the tilt for free.)

**Corners.** A = (X-min, Y-min), B = (X-max, Y-min), C = (X-max, Y-max), D = (X-min, Y-max), each `margin` mm (default 50) inside the travel. The travel comes from the config: `max_travel_mm`, `homing/mpos_mm` and `homing/positive_direction` per axis (FluidNC's default for a missing `positive_direction` is true).

**The pass.**
1. **Setup:** fit a V-bit, router off; four pieces of masking tape, the touch plate and clip, calipers or a tape measure. The app reads the config fresh, homes and moves to corner A at the top of Z; the user jogs the bit down to a few millimetres above where the plate will sit (a Z-only jog pad is shown inside the dialog: an X/Y move there would shift dot A away from the corner).
2. **Each corner, A → B → C → D:** stick tape under the bit, put the plate on it, clip on, tap the plate to the bit (which arms the Probe button), probe (the shared routine above), lift the plate (Continue stays disabled while the probe input is still closed), then the dot: `M5`, lift 2 mm, push down to touch − plate thickness − tape thickness − dot depth (a setting, 0.3 mm by default: a V-bit's mark is only as wide as it is deep) at 100 mm/min, retract to the travel height (first touch + 10 mm, never above the top of Z). Later corners are reached at that height.
3. **Measure:** diagonals AC and BD for squareness; optionally sides AB and DC (X) and AD and BC (Y) for steps per mm. Measured between dot centres. An entry more than 1 % or 10 mm (whichever is smaller) away from the length between the probed dots is asked again, with the expected length.
4. **Compute** (corner positions are where the probe touched, from `[PRB:x,y,z:1]`; the review mentions a corner more than 0.5 mm from where it was sent):
   - Tilt = the average of (zB − zA)/(xB − xA) and (zC − zD)/(xC − xD) from the probe heights (machine Z). Positive means the X-max side is lower. δz = tilt × span.
   - Skew θ = ((AC² − BD²) − (AC₀² − BD₀²))/(4·W·H), where AC₀ and BD₀ are the diagonals of the probed positions (equal for a true rectangle) and W, H the mean probed side lengths; δy = θ × span. Positive means the X-max side sits further along +Y.
   - steps/mm = current × commanded ÷ the mean of the two measured sides, only when both sides of an axis were entered; "commanded" is the mean of the two probed side lengths.
   - Pull-off: `delta` is how much too far from its switch the X-max side sits. With Z homing to the top, lower means farther, so delta = +δz; with Y homing to Y-min, further +Y means farther, so delta = +δy. The opposite homing direction flips the sign. The X-max motor pulls off delta/2 less and the other delta/2 more, so the origin doesn't move. No pull-off goes below 1 mm: if one would, both are raised so the lower one is exactly 1 mm. A pass that would change any pull-off by more than 3 mm is refused, with the numbers it computed and a request to check the measurements; if they are right, the machine needs squaring by hand (or correcting in steps) first.
5. **Review and apply:** every change as old → new with a checkbox (an axis's two pull-offs share one), plus the tilt and skew in mm across the gantry. Apply follows "Applying config changes" above. The motor-side swap and the last-pass tilt or skew are saved only for an axis whose change was applied.
6. **Check:** fresh tape on the same spots and run again; the second pass shows what error remains.

**Which motor is on which side.** A setting per axis (Y and Z), not shown in the UI: it defaults to the LowRider layout (motor0 at X-min). If a pass leaves more than 1.2× the previous pass's error in the same direction, the app swaps that setting and says so in the review.

**Caveat shown in the routine:** tilt is measured against the surface the tape sits on. If this machine already surfaced the spoilboard, that surface follows the old tilt and the reading comes out near zero; for a true reading put the tape on something the machine didn't cut, such as a straight bar laid across.

### Flatness map

A wizard in the same dialog, under the same rules, that maps the table with the touch plate. (Added 2026-10-04.)

1. **Grid:** columns × rows, 2 to 5 each (default 3 × 3), spread evenly over the travel less the margin (the calibration corners' `margin`), corners included. A margin that leaves no area is refused before the grid is asked.
2. **Setup:** fit the bit you will surface with (the zero below is for the bit that probed), router off, the touch plate and clip. The app reads the config fresh, homes and moves to the first point at the top of Z; the user jogs Z only to a few millimetres above where the plate will sit.
3. **Each point,** row by row from Y-min with every other row reversed (a serpentine): plate under the bit, tap to arm, probe (the shared routine), lift 5 mm; then the user picks the plate up (Continue stays disabled while the probe input is closed) and the bit moves to the next point at the travel height (first touch + 10 mm, never above the top of Z). A redo lifts and probes the same point again; a miss ends the run. After the last point the bit goes to the top of Z.
4. **Result:** the heights as a grid seen from above, relative to the highest point (marked). A least-squares plane z = a·x + b·y + c gives the tilt: mm of rise across the probed X and Y spans. Peak to valley, raw and with the plane removed. Up to 0.15 mm raw is "flat enough"; above that the verdict is to surface, cutting pv + 0.1 mm (rounded up to 0.05 mm) from the highest point.
5. **Zero at the highest point,** sent only on the user's press: `G10 L2 P1 X<area X-min> Y<area Y-min> Z<highest touch − plate thickness>`. Machine coordinates become the G54 offset: work X0 Y0 at the probed area's corner, Z0 on the table at its highest point. The same button is on the Tools card after the dialog has closed, while the machine is Idle and homed since this connection. The last map is kept until the page reloads. It keeps the config text it ran with: once the config differs (a calibration changed steps/mm or pull-offs), the zero and the surfacing card are refused with "The config changed since the map: probe again"; a calibration that applies its changes also drops the map.

### Surfacing pass

A Tools card that writes a surfacing file, uploads it to the SD card's root and opens it in the Job panel; running it is still the user's Run.

- **Inputs:** cutter diameter (25.4 mm), stepover (40 %), depth (the map's recommended depth when it has one, else 0.5 mm), depth per pass (0.5 mm), feed (2500 mm/min), plunge feed (300 mm/min), safe height (5 mm).
- **Area:** the whole reachable table: the travel inset by the cutter's radius + 1 mm on every side, so a row's overshoot of one radius stays inside the travel. It follows the cutter diameter, not the calibration margin or the probed area (amended 2026-10-04).
- **Zero:** the file is in work coordinates, X0 Y0 at the area's corner and Z0 at the table's highest point. **Create and open** first sends `G10 L2 P1 X<area X-min> Y<area Y-min>` (machine coordinates, no Z), so the Job preview shows the file where it will cut; it is refused, with the reason, unless the machine is Idle with X and Y homed, and when that line is not ok. Z0 is set beforehand: Zero at the highest point after a flatness map (its X and Y are then replaced by Create's), or Probe Z0 on the table's highest spot.
- **The file:** `G21 G90 G94 G54`, up to the safe height, to the raster start, then `M0`: the router is switched on by hand and the job holds until Resume. Then passes of the depth per pass down to the depth (the last exactly at it), each a serpentine raster of rows across X that overhang the area by the cutter's radius at both ends, a stepover apart with the last row on the area's far edge, moving between rows at cutting depth. At the end, up to the safe height and back to the start. Named `surface-<W>x<H>-<depth>mm.gcode`.
- **Refused** while a job runs, before the config is known, while the last map is stale, and when the cutter leaves no area. A failed SD listing stops Create before the upload.

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
- gantry span (between the two Y motors; 0, the default, means the X travel from the config);
- touch-plate thickness (default 0.5 mm, V1 Engineering's plate);
- tape thickness;
- corner margin inside the travel;
- which motor is on the X-max side, for Y and for Z (stored, not shown; the swap rule maintains it);
- jog step size and speeds;
- the last pass's tilt and skew, for the motor-side swap rule.

Settings are read from the board once the config has been read (both need the machine idle), and again on every connection. The first read after the page loads lets a change made before the board answered win; after a reconnect the board's copy wins outright, so a change made while disconnected is lost. A read that fails for any reason but a missing file writes nothing. Changes are written back, debounced, but only while the machine is Idle or Alarm with no job running (FluidNC handles uploads on the task that feeds the planner); otherwise the write waits until it is idle. localStorage keeps a copy for the moments before the board has answered.

## Connection

- **Dropped connection:** the app reconnects automatically, waiting a little longer after each failed attempt. A banner reads "Reconnecting, the machine is still running".
- **On connect or reconnect:**
  1. Read the machine state, the config file and then `highroller.json` (the board's copy wins after a reconnect). Which axes are homed is unknown again: FluidNC prints `[MSG:Homed:<axes>]` once per homing cycle (the stock LowRider homes Z, then XY), and each line marks its axes; an alarm that loses the position (1, 3, 6, 8, 9, 13) clears them. Moves in machine coordinates need their axes homed: tap-to-go X and Y, Raise Z Z, a typed destination its own axis.
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
1. **The board's firmware version:** FluidNC 3.9.9 (from the user). The file endpoints above work on both 3.x and 4.x.
2. **Spare output pins on the Jackpot.** Take them from V1 Engineering's pinout, then check the user's `config.yaml`.
3. **A smoke test on the real machine:** connect, read position, jog, STOP.

## Build order

Each step is usable on its own:

1. Protocol, position readout, jogging, console. Plus the fake server and the hardware checks above.
2. Files, Job tab, preview and tracking, overrides.
3. Probe routine, zeroing helpers, settings on the board, config editing, and the Calibrate routine.
4. Outputs. Then switch over to `index.html.gz`.
