// Runs the Astro CLI with its anonymous telemetry switched off (no outside call from builds),
// the same way on Windows and Linux: node scripts/astro.mjs <command> [args…]
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url))
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' }
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1))
