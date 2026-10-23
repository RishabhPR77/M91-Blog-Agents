// npm run admin:hash — turns the admin password into ADMIN_PASSWORD_HASH. The password is typed here (hidden), never
// stored or printed; only the hash is printed, for you to put in .env and in Embarko's environment settings.
import { createInterface } from 'node:readline'
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/util/adminhash.js'

function ask(question) {
  return new Promise((resolve) => {
    const tty = process.stdin.isTTY
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(tty) })
    if (tty) {
      // Hide what is typed: the prompt is written once, then the echo is switched off.
      rl._writeToOutput = (s) => { if (s === question) process.stdout.write(s) }
    }
    rl.question(question, (answer) => {
      rl.close()
      if (tty) process.stdout.write('\n')
      resolve(answer)
    })
  })
}

const first = await ask('Admin password (hidden): ')
if (first.length < MIN_PASSWORD_LENGTH) {
  console.error(`The password must have at least ${MIN_PASSWORD_LENGTH} characters.`)
  process.exit(1)
}
const second = await ask('Type it again: ')
if (first !== second) {
  console.error('The two passwords differ. Nothing was made.')
  process.exit(1)
}
const hash = await hashPassword(first)
console.log('\nPut this line in .env and in Embarko\'s environment settings (the password itself is not stored anywhere):\n')
console.log(`ADMIN_PASSWORD_HASH=${hash}`)
console.log('\nAlso set ADMIN_USERNAME to the admin ID you want.')
