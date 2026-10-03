// An in-app confirmation. `confirm({ title, text, ok })` resolves true when the user presses the OK button.
export const pending = $state({ req: null })

export function confirm({ title, text = '', ok = 'OK', danger = false }) {
  return new Promise(resolve => {
    pending.req = { title, text, ok, danger, resolve }
  })
}

export function settle(answer) {
  const r = pending.req
  pending.req = null
  r?.resolve(answer)
}
