// 差し込んだ訳の描き方（userConfig の style / palette / textColor / accentColor / label / labelColor）を読む。$ を使わない純粋な関数だけ
import type { Kind } from '../types'

/**
 * per-kind: 種類ごとに 1 色の背景
 * per-char: 1 字ずつ palette の色を順に巡る背景
 * gradient: 訳の頭から終わりまで palette の色を順になめらかにつなぐ背景
 * text: 背景なしで文字色と〔〕
 */
export type Strategy = 'per-kind' | 'per-char' | 'gradient' | 'text'
const STRATEGIES: readonly Strategy[] = ['per-kind', 'per-char', 'gradient', 'text']

export type Style = {
  strategy: Strategy
  /** 色を文字色（前景）に付けるか。false なら背景に付ける（text は常に前景） */
  foreground: boolean
  /** 差し込んだ個数を応答の下の行に書くか */
  showCount: boolean
  palette: readonly string[]
  textColor: string
  /** 先頭の ●・インラインコード・リンクの色。空なら端末の既定の色 */
  accent: string
  /** 応答の下に添える行の見出し。空なら添えない */
  label: string
  /** 見出しの i 字目（空白を数えない）の文字色。空なら薄い色で描く */
  labelColorOf: (i: number) => string
  /**
   * n 字の訳の i 字目の色（strategy に従う）。palette の何番目から始めるかで種類を分ける（中国語の字 0、キリル文字 1、英語 2）
   * - per-kind・text: 種類の色
   * - per-char: 種類の色から 1 字ずつ palette を巡る
   * - gradient: 種類の色から始め、palette を一巡して最後の字で 1 つ手前の色に着く
   */
  colorOf: (kind: Kind, i: number, n: number) => string
}

export const DEFAULTS = {
  style: 'per-kind',
  colorTarget: 'background',
  showCount: 'true',
  palette: '#8a5a12,#2e6e62,#4f5d6b',
  textColor: '#ffffff',
  accentColor: '',
  label: 'PLaMo 3 Translate',
  labelColor: '',
} as const

const KIND_OFFSET: Record<Kind, number> = { zh: 0, ru: 1, en: 2 }
const COLOR = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|[a-zA-Z]+)$/

type Options = Readonly<Record<string, string | number | boolean | readonly string[]>>

function str(options: Options, key: keyof typeof DEFAULTS): string {
  const v = options[key]
  return typeof v === 'string' ? v.trim() : DEFAULTS[key]
}

/** #rgb / #rrggbb を [r, g, b] に。色の名前は null（混ぜられない） */
function rgb(c: string): [number, number, number] | null {
  const h = c.startsWith('#') ? c.slice(1) : ''
  const full = h.length === 3 ? [...h].map(x => x + x).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return [0, 2, 4].map(k => parseInt(full.slice(k, k + 2), 16)) as [number, number, number]
}

function hex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
}

/** a と b を t（0〜1）で混ぜる。どちらかが色の名前なら近い方をそのまま使う */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a)
  const y = rgb(b)
  if (!x || !y) return t < 0.5 ? a : b
  return hex([0, 1, 2].map(k => (x[k] ?? 0) + ((y[k] ?? 0) - (x[k] ?? 0)) * t) as [number, number, number])
}

export function readStyle(options: Options): Style {
  const s = str(options, 'style')
  const strategy = STRATEGIES.find(x => x === s) ?? 'per-kind'
  const raw = typeof options.palette === 'string' || Array.isArray(options.palette) ? options.palette : DEFAULTS.palette
  const list = (typeof raw === 'string' ? raw.split(',') : [...raw]).map(c => String(c).trim()).filter(c => COLOR.test(c))
  const palette = list.length > 0 ? list : DEFAULTS.palette.split(',')
  const textColor = COLOR.test(str(options, 'textColor')) ? str(options, 'textColor') : DEFAULTS.textColor
  const accent = COLOR.test(str(options, 'accentColor')) ? str(options, 'accentColor') : ''
  const at = (k: number) => palette[((k % palette.length) + palette.length) % palette.length] ?? '#808080'
  const labelColor = str(options, 'labelColor')
  const labelColorOf = (i: number) => {
    if (labelColor === 'palette') return at(i)
    return COLOR.test(labelColor) ? labelColor : ''
  }
  const flag = options.showCount
  const showCount = typeof flag === 'boolean' ? flag : str(options, 'showCount') !== 'false'
  return {
    strategy,
    foreground: strategy === 'text' || str(options, 'colorTarget') === 'foreground',
    showCount,
    palette,
    textColor,
    accent,
    label: str(options, 'label'),
    labelColorOf,
    colorOf: (kind, i, n) => {
      const start = KIND_OFFSET[kind]
      switch (strategy) {
        case 'per-char':
          return at(start + i)
        case 'gradient': {
          if (palette.length === 1 || n <= 1) return at(start)
          // palette の色の数より 1 つ少ない区間に分け、最後の字が種類の色の 1 つ手前の色に着く
          const pos = (i / (n - 1)) * (palette.length - 1)
          const k = Math.min(Math.floor(pos), palette.length - 2)
          return mix(at(start + k), at(start + k + 1), pos - k)
        }
        default:
          return at(start)
      }
    },
  }
}
