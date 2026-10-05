const isDebug = typeof process !== 'undefined' && process.env?.MARVIN_DEBUG === 'true';

/** Trace renderer resolution when `MARVIN_DEBUG=true`. */
export function debug(...args: unknown[]): void {
  if (isDebug) console.debug('[Marvin renderers]', ...args);
}
