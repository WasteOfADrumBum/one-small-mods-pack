import { describe, expect, test } from 'claude-code/testing'

import { bashWrites, changedFiles, porcelainPaths, shellWords } from '../hooks/bash-writes'

const paths = (command: string) => bashWrites(command).map(w => `${w.via}:${w.path}`)

describe('bashWrites', () => {
  test('reads redirects, tee and heredocs', () => {
    expect(paths('echo hi > a.css')).toEqual(['redirect:a.css'])
    expect(paths('printf "x" >>src/b.tsx 2>/dev/null')).toEqual(['redirect:src/b.tsx'])
    expect(paths("cat <<'EOF' > c.vue\n<template/>\nEOF")).toEqual(['redirect:c.vue'])
    expect(paths('build | tee -a out.html log.txt')).toEqual(['tee:out.html', 'tee:log.txt'])
  })

  test('reads in-place edits by sed and perl', () => {
    expect(paths("sed -i 's/#fff/#000/' a.css b.css")).toEqual(['in-place:a.css', 'in-place:b.css'])
    expect(paths("sed -i '' -e 's/a/b/' x.scss")).toEqual(['in-place:x.scss'])
    expect(paths("perl -pi -e 's/a/b/' y.jsx")).toEqual(['in-place:y.jsx'])
    expect(paths("sed 's/a/b/' z.css")).toEqual([])
  })

  test('reads copies, dd and downloads', () => {
    expect(paths('cp -r src/a.css dist/a.css && mv x.tsx y.tsx')).toEqual(['copy:dist/a.css', 'copy:y.tsx'])
    expect(paths('dd if=/dev/zero of=img.html bs=1 count=0')).toEqual(['redirect:img.html'])
    expect(paths('curl -sL -o theme.css https://example.com/t.css; wget -O page.html https://e.com')).toEqual([
      'download:theme.css',
      'download:page.html',
    ])
  })

  test('ignores reads, stderr to /dev/null and quoted text', () => {
    expect(paths('cat a.css | grep color 2>&1')).toEqual([])
    expect(paths('echo "a > b.css"')).toEqual([])
    expect(shellWords('a "b c" d\\ e')).toEqual(['a', 'b c', 'd e'])
  })
})

describe('change detection', () => {
  test('reads git porcelain output, renames included', () => {
    expect(porcelainPaths(' M src/a.css\0?? new.tsx\0R  b.css\0old.css\0')).toEqual(['src/a.css', 'new.tsx', 'b.css'])
  })

  test('finds files changed or added between snapshots', () => {
    const before = new Map([['a', '1:10'], ['b', '1:10']])
    const after = new Map([['a', '1:10'], ['b', '2:12'], ['c', '3:1']])
    expect(changedFiles(before, after)).toEqual(['b', 'c'])
  })
})
