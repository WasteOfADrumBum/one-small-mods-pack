// The files a shell command writes, read from the command itself: redirects,
// tee, in-place sed/perl, cp/mv/install destinations, dd of=, curl -o and
// wget -O. A best-effort reading (a script the command runs can write
// anything), so each mod also compares the working tree before and after.
// Shared by the guardrail mods; each plugin carries its own copy.

export type BashWrite = {
  path: string
  /** How the command writes it: new text (`redirect`, `tee`, `in-place`, `download`) or a copy (`copy`). */
  via: 'redirect' | 'tee' | 'in-place' | 'copy' | 'download'
}

/** Splits a command into words, honoring quotes and backslashes; operators are their own words. */
export function shellWords(command: string): string[] {
  const words: string[] = []
  let word = ''
  let hasWord = false
  let quote: '"' | "'" | undefined
  const push = () => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote !== undefined) {
      if (c === quote) quote = undefined
      else if (c === '\\' && quote === '"' && i + 1 < command.length) word += command[++i]
      else word += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      hasWord = true
    } else if (c === '\\' && i + 1 < command.length) {
      word += command[++i]
      hasWord = true
    } else if (/\s/.test(c)) {
      push()
      if (c === '\n') words.push(';')
    } else if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      push()
      const pair = c + (command[i + 1] ?? '')
      if (pair === '&&' || pair === '||' || pair === '>|') {
        words.push(pair)
        i++
      } else if (c === '&' && command[i + 1] === '>') {
        words.push('&>')
        i++
      } else words.push(c)
    } else if (c === '>' || c === '<') {
      // A leading fd number (2>) belongs to the operator, not the word before it.
      const fd = /^\d$/.test(word) ? word : ''
      if (fd === '') push()
      else {
        word = ''
        hasWord = false
      }
      let op = fd + c
      while (command[i + 1] === '>' || command[i + 1] === '&' || (c === '<' && command[i + 1] === '<')) op += command[++i]
      words.push(op)
    } else {
      word += c
      hasWord = true
    }
  }
  push()
  return words
}

const SEPARATORS = new Set([';', '&&', '||', '|', '&', '(', ')'])
const NOT_A_FILE = /^(\/dev\/|&\d|-$)/

const isRedirect = (word: string) => /^(\d|&)?>{1,2}\|?$/.test(word)

/** The files the command writes, by how it writes them. */
export function bashWrites(command: string): BashWrite[] {
  // A heredoc's body is data, not shell: keep its opening line, drop the body.
  const shell = command.replace(/(<<-?\s*(['"]?)([\w-]+)\2[^\n]*)\n[\s\S]*?\n\s*\3\s*(?=\n|$)/g, '$1')
  const words = shellWords(shell)
  const writes: BashWrite[] = []
  const add = (path: string | undefined, via: BashWrite['via']) => {
    if (path !== undefined && path !== '' && !NOT_A_FILE.test(path) && !SEPARATORS.has(path) && !isRedirect(path)) writes.push({ path, via })
  }

  // Redirects anywhere in the command
  words.forEach((word, i) => {
    if (isRedirect(word)) add(words[i + 1], 'redirect')
  })

  // Each simple command: its program and arguments, redirects left out
  const segments: string[][] = [[]]
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    if (SEPARATORS.has(word)) segments.push([])
    else if (isRedirect(word) || /^\d?<{1,3}$/.test(word)) i++
    else segments.at(-1)!.push(word)
  }

  for (const segment of segments) {
    // Skip env assignments and wrappers: FOO=1 sudo sed -i ...
    let start = 0
    while (start < segment.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[start]!) || ['sudo', 'command', 'env', 'xargs', 'time', 'nohup'].includes(segment[start]!))) start++
    const [program = '', ...args] = segment.slice(start)
    const name = program.split('/').at(-1) ?? program
    const operands = args.filter(a => !a.startsWith('-'))

    if (name === 'tee') {
      for (const file of operands) add(file, 'tee')
    } else if (name === 'sed' || name === 'gsed') {
      if (args.some(a => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) {
        // The first operand is the script, unless one was given with -e/-f.
        const hasScriptOption = args.some(a => a === '-e' || a === '-f' || a.startsWith('--expression') || a.startsWith('--file'))
        const scriptArgs = new Set<string>()
        args.forEach((a, i) => {
          if ((a === '-e' || a === '-f') && args[i + 1] !== undefined) scriptArgs.add(args[i + 1]!)
        })
        // macOS spells no backup suffix as a separate '' after -i
        const files = operands.filter(a => a !== '' && !scriptArgs.has(a))
        for (const file of hasScriptOption ? files : files.slice(1)) add(file, 'in-place')
      }
    } else if (name === 'perl') {
      if (args.some(a => /^-[a-zA-Z]*i/.test(a))) {
        const scriptArgs = new Set<string>()
        args.forEach((a, i) => {
          if (/^-[a-zA-Z]*e$/.test(a) && args[i + 1] !== undefined) scriptArgs.add(args[i + 1]!)
        })
        for (const file of operands.filter(a => !scriptArgs.has(a))) add(file, 'in-place')
      }
    } else if (name === 'cp' || name === 'mv' || name === 'install' || name === 'rsync') {
      const target = args.findIndex(a => a === '-t' || a === '--target-directory')
      add(target >= 0 ? args[target + 1] : operands.at(-1), 'copy')
    } else if (name === 'dd') {
      for (const a of args) if (a.startsWith('of=')) add(a.slice(3), 'redirect')
    } else if (name === 'curl' || name === 'wget') {
      args.forEach((a, i) => {
        if ((name === 'curl' && (a === '-o' || a === '--output')) || (name === 'wget' && (a === '-O' || a === '--output-document'))) {
          add(args[i + 1], 'download')
        }
      })
    }
  }

  const seen = new Set<string>()
  return writes.filter(w => {
    const key = `${w.via}:${w.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Parses `git status --porcelain -z`: the paths with changes or untracked, relative to the repository root. */
export function porcelainPaths(output: string): string[] {
  const entries = output.split('\0')
  const paths: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.length < 4) continue
    const status = entry.slice(0, 2)
    paths.push(entry.slice(3))
    // A rename or copy is followed by its old path, which is gone.
    if (status.includes('R') || status.includes('C')) i++
  }
  return paths
}

/** The files whose change time moved between two snapshots, or that only the second has. */
export function changedFiles(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...after].filter(([path, mtime]) => before.get(path) !== mtime).map(([path]) => path)
}
