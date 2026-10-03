# HighRoller: deferred past 1.0

- **Bit library**: store each bit's type (flat end mill, ball end, V-bit with its angle), diameter and flute length.
  - Draw the preview trail at the bit's real cut width instead of a thin line.
  - For a V-bit, work out the cut width from how far below Z0 it is: `2 · depth · tan(angle/2)`.
- **3D preview** (three.js or similar). 1.0 uses a top-down 2D view to save flash space.
- **Stream G-code from the browser.** 1.0 runs every job from the SD card.
- **Z steps/mm calibration.** The Z axis is leadscrew-driven, so its steps/mm follows directly from the screw's pitch.
- **Wi-Fi and firmware-update screens.** Until then, use the console or FluidNC's web installer.
- **Move and rename files on the SD card** from the file browser (FluidNC has `action=rename`; moving between folders needs download + upload + delete).
- **Per-key settings writes.** `highroller.json` is written as a whole object, so two devices saving close together can overwrite each other's values (a calibration pass's last-pass numbers included). Write only the keys that changed, merged into a fresh read.
- **AP-mode captive portal.** In access-point mode FluidNC's captive portal may answer 200 (its portal page) for a flash file that doesn't exist, so a missing `highroller.json` or `config.yaml.bak` would look present. Check the body (or a header) before trusting a 200.
- **Fun layer**: sounds, a "Jackpot!" animation when a job finishes, job history and stats (hours cut, meters traveled).
