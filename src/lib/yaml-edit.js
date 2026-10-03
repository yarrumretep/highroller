// Read or change one scalar in FluidNC's config.yaml without disturbing anything else.
// ponytail: block mappings of scalars only (all FluidNC uses); no lists, flow style or multi-line scalars.

// Finds the line index of `path` by walking indentation: a child is the next key line with deeper indent.
function findLine(lines, path) {
  const keys = path.split('/')
  let depth = -1 // indent of the parent we are inside; -1 = top level
  let i = 0
  for (const key of keys) {
    let found = -1
    for (; i < lines.length; i++) {
      const line = lines[i]
      const m = /^(\s*)([^\s#][^:]*):(.*)$/.exec(line)
      if (!m) continue // blank or comment
      const indent = m[1].length
      if (indent <= depth) return -1 // left the parent block without finding the key
      if (m[2] === key && (depth < 0 ? indent === 0 : indent > depth)) { found = i; break }
    }
    if (found < 0) return -1
    depth = /^(\s*)/.exec(lines[found])[1].length
    i = found + 1
  }
  return i - 1
}

const scalar = line => /:(.*)$/.exec(line)[1].replace(/\s+#.*$/, '').trim()

export function getValue(text, path) {
  const lines = text.split('\n')
  const i = findLine(lines, path)
  return i < 0 ? undefined : scalar(lines[i])
}

export function setValue(text, path, value) {
  const lines = text.split('\n')
  const i = findLine(lines, path)
  if (i < 0) throw new Error(`${path} not found in config`)
  const m = /^([^:]*:)(\s*)([^#]*?)(\s*#.*)?$/.exec(lines[i])
  lines[i] = `${m[1]}${m[2] || ' '}${value}${m[4] ?? ''}`
  return lines.join('\n')
}
