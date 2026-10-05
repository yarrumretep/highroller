// Parses FluidNC status reports, e.g.
// <Idle|MPos:1.000,2.000,3.000|FS:0,0|WCO:0.000,0.000,0.000|Ov:100,100,100|A:SF|Pn:P|SD:12.50,/sd/job.nc>
// WCO and Ov (with A) only come now and then, so they carry over from the previous report;
// until the first one they are null (unknown), and so is the position that needs WCO.

export const EMPTY = {
  state: 'Unknown',
  sub: null,
  mpos: null,
  wpos: null,
  wco: null,
  feed: 0,
  spindle: 0,
  ov: null,
  acc: '',
  pins: '',
  sd: null,
}

const nums = s => s.split(',').map(Number)

export function parseStatus(line, prev = EMPTY) {
  const fields = line.slice(1, line.lastIndexOf('>')).split('|')
  const [state, sub] = fields[0].split(':')
  const s = { ...prev, state, sub: sub === undefined ? null : Number(sub), pins: '', sd: null }
  let pos = null
  let isWork = false
  for (const f of fields.slice(1)) {
    const i = f.indexOf(':')
    const key = f.slice(0, i)
    const val = f.slice(i + 1)
    if (key === 'MPos') pos = nums(val)
    else if (key === 'WPos') { pos = nums(val); isWork = true }
    else if (key === 'WCO') s.wco = nums(val)
    else if (key === 'FS') [s.feed, s.spindle] = nums(val)
    else if (key === 'Ov') { s.ov = nums(val); s.acc = '' } // A: only ever follows Ov
    else if (key === 'A') s.acc = val
    else if (key === 'Pn') s.pins = val
    else if (key === 'SD') {
      // "12.50,/sd/job.nc" while reading the file; " <name>: Sent" at its very end (names may hold commas)
      if (/: Sent$/.test(val)) s.sd = { percent: 100, file: val.replace(/: Sent$/, '').trim() }
      else {
        const c = val.indexOf(',')
        s.sd = { percent: Number(val.slice(0, c)), file: val.slice(c + 1) }
      }
    }
  }
  if (pos && !s.wco) {
    // No work offset seen yet: only the kind of position this report gave is known
    s.mpos = isWork ? null : pos
    s.wpos = isWork ? pos : null
  } else if (pos) {
    const wco = pos.map((_, k) => s.wco[k] ?? 0)
    s.mpos = isWork ? pos.map((v, k) => v + wco[k]) : pos
    s.wpos = isWork ? pos : pos.map((v, k) => v - wco[k])
  }
  return s
}

// Wi-Fi signal as the controller sees it. Only the JSON form of the stats carries it on 3.9.9
// ($System/Stats=json=yes answers in [MSG:JSON:…] chunks of up to 100 characters, split anywhere,
// holding {"id":"Signal","value":"78%"} as a station and nothing of the kind as an access point).
// The plain "Signal: 78%" line is kept for firmware that prints one.
export function wifiPercent(lines) {
  // Chunks arrive wrapped as [MSG:JSON:…] or bare, depending on the channel: unwrap what is wrapped and join the rest as is.
  const json = lines.map(l => /^\[MSG:JSON:(.*)\]$/.exec(l)?.[1] ?? l).join('')
  const m = /"id"\s*:\s*"Signal"\s*,\s*"value"\s*:\s*"(\d+)%"/.exec(json) || lines.map(l => /^Signal:\s*(\d+)%/.exec(l)).find(Boolean)
  return m ? Number(m[1]) : null
}

// The firmware's own name and version from the same stats ({"id":"FW version","value":"FluidNC v3.9.9 (…)"}), or null.
export function fwVersion(lines) {
  const json = lines.map(l => /^\[MSG:JSON:(.*)\]$/.exec(l)?.[1] ?? l).join('')
  const m = /"id"\s*:\s*"FW version"\s*,\s*"value"\s*:\s*"([^"]+)"/.exec(json) || lines.map(l => /^FW version:\s*(.+)$/.exec(l)).find(Boolean)
  return m ? m[1].trim() : null
}

// Plain-language reasons for FluidNC ALARM:n codes (names from FluidNC Protocol.cpp).
export const ALARMS = {
  1: 'A limit switch was hit while moving. Position may be off, so home again.',
  2: 'That move would go past the edge of the machine (soft limit).',
  3: 'Reset while moving. Position may be off, so home again.',
  4: 'The probe was already touching when probing started. Check the plate is clear of the bit.',
  5: 'The probe never touched. Is the plate under the bit and the clip attached?',
  6: 'Homing was interrupted by a reset.',
  7: 'Homing stopped because the safety door opened.',
  8: 'Homing could not back off the switch. Check the switch, or raise pulloff_mm.',
  9: 'Homing could not find the switch. Check the switch and its wiring.',
  10: 'Spindle control error.',
  11: 'An input (e-stop, limit or control pin) was on at startup.',
  12: 'Homing hit an ambiguous switch.',
  13: 'Hard stop.',
  14: 'Not homed yet. Home the machine, or unlock if you know where it is.',
  15: 'The controller is still starting up.',
  16: 'The I/O expander reset.',
  17: 'G-code error.',
  18: 'The probe ran into a limit switch.',
}
