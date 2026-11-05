import { expect, test } from 'claude-code/testing'

import { findUnits, splitCommand, weave } from '../hooks/detect'
import { readStyle } from '../hooks/style'

test('紛れた字を含む文と、行ごと英語の行を拾う', async () => {
  const block = [
    '変更を确认してから push します。この設定は всегда 有効です。',
    '',
    '- `git merge` は fast-forward できる場合、マージコミットを作りません。',
    '- 「你」「呢」は中国語の字で、`实` もそうです。',
    '',
    '| 字 | 例 |',
    '|---|---|',
    '| 确认 | 晚 |',
    '',
    '```',
    'print("这是代码")',
    '```',
    '',
    'The server is still running in the background and uses memory.',
  ].join('\n')
  expect(findUnits(block)).toEqual([
    { from: '変更を确认してから push します。', kind: 'zh', isClosed: true },
    { from: 'この設定は всегда 有効です。', kind: 'ru', isClosed: true },
    // 最後の行は改行で終わっていないので、書きかけかもしれない
    { from: 'The server is still running in the background and uses memory.', kind: 'en', isClosed: false },
  ])
  expect(findUnits(`${block}\n`).at(-1)?.isClosed).toBe(true)
})

test('変わった語の後ろにだけ訳を差し込む', async () => {
  expect(weave('変更を确认してから push します。', '変更を確認してから push します。')).toEqual([
    { text: '変更を' },
    { text: '确认', insert: '確認' },
    { text: 'してから push します。' },
  ])
  // 紛れた字を含まない言い換え（今晚の「今」以外）は差し込まない
  expect(weave('今晚は検索した結果を記録します。', '今晩は検索した結果を記録します。')).toEqual([
    { text: '今' },
    { text: '晚', insert: '晩' },
    { text: 'は検索した結果を記録します。' },
  ])
  // キリル文字の後ろの空白は訳の後ろへ回す
  expect(weave('可能性が высокая です。', '可能性が高いです。')).toEqual([
    { text: '可能性が' },
    { text: ' высокая', insert: '高い' },
    { text: ' ' },
    { text: 'です。' },
  ])
})

test('文の大半が変わったら文ごと差し込む', async () => {
  const from = '我们已经检查了这个目录。'
  const to = '私たちはすでにこのディレクトリを確認しました。'
  expect(weave(from, to)).toEqual([{ text: from, insert: to }])
})

test('startCommand を引数に分ける', async () => {
  expect(splitCommand('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -File "C:\\a b\\start.ps1"')).toEqual([
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    '-NoProfile',
    '-File',
    'C:\\a b\\start.ps1',
  ])
  expect(splitCommand('')).toEqual([])
})

test('塗り方の設定を読む', async () => {
  const d = readStyle({})
  expect(d.strategy).toBe('per-kind')
  expect([d.colorOf('zh', 0, 1), d.colorOf('ru', 0, 1), d.colorOf('en', 0, 1)]).toEqual(['#8a5a12', '#2e6e62', '#4f5d6b'])
  const s = readStyle({ style: 'per-char', palette: '#111111, #222222 ,bad!,#333333,#444444', accentColor: '#12' })
  expect(s.palette).toEqual(['#111111', '#222222', '#333333', '#444444'])
  // 中国語の字は 1 番目、キリル文字は 2 番目から巡る
  expect([0, 1, 2, 3, 4].map(i => s.colorOf('zh', i, 5))).toEqual(['#111111', '#222222', '#333333', '#444444', '#111111'])
  expect(s.colorOf('ru', 0, 5)).toBe('#222222')
  expect(s.accent).toBe('')
  expect(readStyle({ style: 'rainbow' }).strategy).toBe('per-kind')
})

test('gradient は kind の色から始めて palette を一巡する', async () => {
  const s = readStyle({ style: 'gradient', palette: '#000000,#ffffff' })
  expect(s.strategy).toBe('gradient')
  expect([0, 1, 2, 3, 4].map(i => s.colorOf('zh', i, 5))).toEqual(['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff'])
  // キリル文字は 2 番目の色から始まる
  expect(s.colorOf('ru', 0, 3)).toBe('#ffffff')
  expect(s.colorOf('ru', 2, 3)).toBe('#000000')
  expect(s.colorOf('zh', 0, 1)).toBe('#000000')
  // 色の名前は混ぜずに近い方を使う
  expect(readStyle({ style: 'gradient', palette: 'red,#00ff00' }).colorOf('zh', 1, 4)).toBe('red')
})

test('見出しの文字色', async () => {
  expect(readStyle({}).labelColorOf(0)).toBe('')
  expect(readStyle({ labelColor: '#123456' }).labelColorOf(3)).toBe('#123456')
  const s = readStyle({ labelColor: 'palette', palette: '#000000,#ffffff' })
  expect([0, 1, 2].map(i => s.labelColorOf(i))).toEqual(['#000000', '#ffffff', '#000000'])
})

test('per-kind は字の位置によらず種類の色', async () => {
  const s = readStyle({ palette: '#000000,#ffffff' })
  expect([0, 1, 2].map(i => s.colorOf('ru', i, 3))).toEqual(['#ffffff', '#ffffff', '#ffffff'])
})
