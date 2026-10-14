import { expect, test } from 'claude-code/testing'
import { bashPatterns, countPatterns, OTHER } from './bashPattern'

test('a pattern is the command and its subcommand', () => {
  expect(bashPatterns('git status')).toEqual(['git status'])
  expect(bashPatterns('bun run check')).toEqual(['bun run'])
  expect(bashPatterns('claude plugin test mods/x')).toEqual(['claude plugin'])
})

test('a second word that is not a subcommand is left out', () => {
  expect(bashPatterns('rg -n foo src')).toEqual(['rg'])
  expect(bashPatterns('sed -n 1,20p a.ts')).toEqual(['sed'])
  expect(bashPatterns('ls')).toEqual(['ls'])
  expect(bashPatterns('cat README.md')).toEqual(['cat'])
})

test('each command of a list or a pipe is a pattern; cd is not', () => {
  expect(bashPatterns('cd /x && bun run check > .tmp/a.log 2>&1; rg "fail" .tmp/a.log')).toEqual([
    'bun run',
    'rg',
  ])
  expect(bashPatterns('git log --oneline | head -3 || true')).toEqual(['git log', 'head', 'true'])
})

test('a separator inside quotes does not split', () => {
  expect(bashPatterns(`rg "a|b && c" src; echo 'x; y'`)).toEqual(['rg', 'echo'])
})

test('a heredoc body is not a command', () => {
  expect(bashPatterns("cat > a.ts <<'EOF'\ngit push\nrm -rf x\nEOF\nbun test")).toEqual(['cat'])
  expect(bashPatterns('python3 - <<EOF\nprint(1)\nEOF')).toEqual(['python3'])
})

test('a substitution is not counted', () => {
  expect(bashPatterns('echo $(git rev-parse HEAD)')).toEqual(['echo'])
  expect(bashPatterns('H=$(git rev-parse --short HEAD) && git log')).toEqual(['git log'])
})

test('assignments, wrappers and paths are left out', () => {
  expect(bashPatterns('FOO=1 BAR=2 bun test')).toEqual(['bun test'])
  expect(bashPatterns('rtk git status')).toEqual(['git status'])
  expect(bashPatterns('rtk proxy git diff')).toEqual(['git diff'])
  expect(bashPatterns('sudo env A=1 timeout 5 npx tsc --noEmit')).toEqual(['tsc'])
  expect(bashPatterns('/usr/bin/git fetch')).toEqual(['git fetch'])
  expect(bashPatterns('"$D" plugin test x')).toEqual([])
})

test('a command with a character that is not printable ASCII has no pattern', () => {
  expect(bashPatterns('gi​t status')).toEqual([])
  expect(bashPatterns('')).toEqual([])
  expect(bashPatterns('cd /x')).toEqual([])
})

test('countPatterns adds each pattern, and past the limit a new one goes to other', () => {
  expect(countPatterns({ git: 1 }, ['git', 'rg'], 100)).toEqual({ git: 2, rg: 1 })
  expect(countPatterns({ a: 1, b: 1 }, ['a', 'c'], 2)).toEqual({ a: 2, b: 1, [OTHER]: 1 })
  expect(countPatterns({ a: 1, [OTHER]: 1 }, ['c'], 2)).toEqual({ a: 1, [OTHER]: 2 })
})
