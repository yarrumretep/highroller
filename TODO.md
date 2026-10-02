# HighRoller: deferred past 1.0

- **Bit library**: store each bit's type (flat end mill, ball end, V-bit with its angle), diameter and flute length.
  - Draw the preview trail at the bit's real cut width instead of a thin line.
  - For a V-bit, work out the cut width from how far below Z0 it is: `2 · depth · tan(angle/2)`.
- **3D preview** (three.js or similar). 1.0 uses a top-down 2D view to save flash space.
- **Stream G-code from the browser.** 1.0 runs every job from the SD card.
- **Z steps/mm calibration.** The Z axis is leadscrew-driven, so its steps/mm follows directly from the screw's pitch.
- **Wi-Fi and firmware-update screens.** Until then, use the console or FluidNC's web installer.
- **Fun layer**: sounds, a "Jackpot!" animation when a job finishes, job history and stats (hours cut, meters traveled).
