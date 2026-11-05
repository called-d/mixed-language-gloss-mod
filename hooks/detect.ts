// 応答のブロックから直す単位を見つけ、PLaMo の出力と原文を比べて差し込み方を決める。$ を使わない純粋な関数だけ
import type { Kind } from '../types'
import { JA_KANJI } from './cp932-kanji'

export type Unit = { from: string; kind: Kind; isClosed: boolean }

const CJK = /[㐀-䶿一-鿿豈-﫿]/
const CYR = /[Ѐ-ӿ]/
const JA = /[぀-ヿ㐀-䶿一-鿿]/
const FENCE = /^\s*(```|~~~)/
/** 行頭の箇条書き・番号・見出しの印 */
const MARKER = /^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+)?/

/** 設定の startCommand を引数の列に分ける。空白で区切り、"…" で囲んだ部分は 1 つの引数にする */
export function splitCommand(s: string): string[] {
  return [...s.matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2] ?? '')
}

export function isForeignHanzi(c: string): boolean {
  return CJK.test(c) && !JA_KANJI.has(c)
}

/** 紛れた字か（中国語の字・キリル文字） */
export function isForeignChar(c: string): boolean {
  return CYR.test(c) || isForeignHanzi(c)
}

/** 引用（「」『』“”""）・インラインコード・リンク先・URL を空白で潰す。長さ（UTF-16）は保つ */
export function maskQuoted(s: string): string {
  return s.replace(/`[^`]*`|「[^」]*」|『[^』]*』|“[^”]*”|"[^"\n]*"|\]\([^)]*\)|https?:\/\/\S+/g, m =>
    ' '.repeat(m.length),
  )
}

export type Line = { raw: string; marker: string; body: string; isCode: boolean }

/** ブロックを行に分ける。コードブロックの中・表・引用・字下げしたコードは isCode */
export function splitLines(block: string): Line[] {
  let inCode = false
  return block.split('\n').map(raw => {
    if (FENCE.test(raw)) {
      inCode = !inCode
      return { raw, marker: '', body: raw, isCode: true }
    }
    const t = raw.trim()
    if (inCode || t.startsWith('|') || t.startsWith('>') || /^( {4}|\t)/.test(raw)) {
      return { raw, marker: '', body: raw, isCode: true }
    }
    const marker = raw.match(MARKER)?.[0] ?? ''
    return { raw, marker, body: raw.slice(marker.length), isCode: false }
  })
}

/** 行ごと英語の地の文か（日本語の字が無く、小文字の英単語が 3 つ続き、英単語が 5 つ以上） */
export function isEnglishProse(body: string): boolean {
  const m = maskQuoted(body)
  if (JA.test(m) || CYR.test(m)) return false
  const words = m.match(/[A-Za-z][A-Za-z'’-]+/g) ?? []
  return words.length >= 5 && /\b[a-z]+ [a-z]+ [a-z]+\b/.test(m)
}

/**
 * ブロックから直す単位を拾う。`isClosed` は改行で終わった行のものか。
 * 最後の行は書きかけかもしれないので、呼び出し側が文面の落ち着くのを待ってから訳す
 */
export function findUnits(block: string): Unit[] {
  const units: Unit[] = []
  const seen = new Set<string>()
  const lines = splitLines(block)
  lines.forEach((line, n) => {
    if (line.isCode || !line.body.trim()) return
    const isClosed = n < lines.length - 1
    const add = (from: string, kind: Kind) => {
      if (from && !seen.has(from)) {
        seen.add(from)
        units.push({ from, kind, isClosed })
      }
    }
    if (isEnglishProse(line.body)) {
      add(line.body.trim(), 'en')
      return
    }
    const masked = maskQuoted(line.body)
    for (const s of line.body.matchAll(/[^。！？]+[。！？]*/g)) {
      const part = masked.slice(s.index, s.index + s[0].length)
      const kind: Kind | null = CYR.test(part) ? 'ru' : Array.from(part).some(isForeignHanzi) ? 'zh' : null
      if (kind) add(s[0].trim(), kind)
    }
  })
  return units
}

export type Piece = { text: string; insert?: string }

/**
 * 原文 `from` と PLaMo の出力 `to` を字で比べ、紛れた字を含む変更箇所だけ、原文の後ろに訳を差し込む形に並べる。
 * 紛れた字を含まない変更（PLaMo の言い換え）は原文のまま。差し込む箇所が文の 6 割を超えるなら、文の後ろに文ごと差し込む
 */
export function weave(from: string, to: string): Piece[] {
  const a = Array.from(from)
  const b = Array.from(to)
  // LCS の表（文単位なので長さは数百字まで）
  const n = a.length
  const m = b.length
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  const at = (i: number, j: number) => dp[i * w + j] ?? 0
  const ch = (s: string[], k: number) => s[k] ?? ''
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = ch(a, i) === ch(b, j) ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  // 一致と変更の列。変更は [原文の字, 出力の字]
  type Op = { eq: string } | { del: string; ins: string }
  const ops: Op[] = []
  const pushChange = (del: string, ins: string) => {
    const last = ops[ops.length - 1]
    if (last && 'del' in last) {
      last.del += del
      last.ins += ins
    } else ops.push({ del, ins })
  }
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && ch(a, i) === ch(b, j)) {
      const last = ops[ops.length - 1]
      if (last && 'eq' in last) last.eq += ch(a, i)
      else ops.push({ eq: ch(a, i) })
      i++
      j++
    } else if (j < m && (i >= n || at(i, j + 1) >= at(i + 1, j))) {
      pushChange('', ch(b, j++))
    } else {
      pushChange(ch(a, i++), '')
    }
  }
  // 1 字だけの一致に挟まれた変更はつなげる（「确认」→「確認」が 1 字ずつに割れないように）
  const merged: Op[] = []
  for (const op of ops) {
    const prev = merged[merged.length - 1]
    const prev2 = merged[merged.length - 2]
    if ('del' in op && prev && 'eq' in prev && Array.from(prev.eq).length === 1 && prev2 && 'del' in prev2) {
      merged.pop()
      prev2.del += prev.eq + op.del
      prev2.ins += prev.eq + op.ins
    } else merged.push(op)
  }
  const pieces: Piece[] = []
  let inserted = 0
  for (const op of merged) {
    if ('eq' in op) pieces.push({ text: op.eq })
    else if (Array.from(op.del).some(isForeignChar) && op.ins.trim()) {
      // 「 всегда 」の後ろの空白は訳の後ろへ回す（差し込んだ訳と空白が二重にならないように）
      const tail = op.del.match(/\s*$/)?.[0] ?? ''
      pieces.push({ text: op.del.slice(0, op.del.length - tail.length), insert: op.ins.trim() })
      if (tail) pieces.push({ text: tail })
      inserted += Array.from(op.del).length
    } else pieces.push({ text: op.del })
  }
  if (inserted === 0) return [{ text: from }]
  if (inserted > a.length * 0.6) return [{ text: from, insert: to }]
  return pieces
}
