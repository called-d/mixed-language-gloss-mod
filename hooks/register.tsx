// Claude の日本語の応答に紛れた中国語の字・キリル文字・英語の段落を PLaMo 3 Translate（llama-server）で日本語にし、
// 原文の後ろに訳を差し込んで描く。描画だけを変え、記録（ctrl+o）とモデルの文脈は元のまま。
// PLaMo が応答しなければ、設定の startCommand があればそれで起動する。/mixed-gloss off で止める
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Fix, Kind, Mode } from '../types'
import { findUnits, splitCommand, splitLines, weave, type Unit } from './detect'
import { readStyle, type Style } from './style'

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8090'
const COMMAND = 'mixed-gloss'
/** 改行で終わっていない最後の行は、文面がこの時間変わらなかったら訳す（書きかけを訳さないように） */
const SETTLE_MS = 1500

const modeRef = { plugin: 'mixed-language-gloss', key: 'mode' } as const
const unitsRef = { plugin: 'mixed-language-gloss', key: 'units' } as const

/** 文面の指紋（FNV-1a 32bit と長さ） */
function fingerprint(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${h.toString(16)}-${s.length}`
}

/** PLaMo 3 Translate の入力（PFML3）。日本語の文は ja → ja として渡すと、紛れた語だけを直して返す */
function pfml3(text: string, src: 'ja' | 'en'): string {
  return (
    '<|plamo:tag|>dataset<|plamo:msg|>translation' +
    `<|plamo:tag|>input<|plamo:key|>lang<|plamo:val|>${src}<|plamo:msg|>${text}` +
    '<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>'
  )
}

/** 単位の鍵。種類と文面で決まるので、同じ文が別の応答に出ても訳し直さない */
const unitId = (u: Unit) => fingerprint(`${u.kind}\n${u.from}`)

type Job = { id: string; unit: Unit }
// 訳待ちの列（入れた順に訳す）と、列に入れたか訳している鍵
const queue: Job[] = []
const queued = new Set<string>()
// メッセージ（requestId）ごとの、改行で終わっていない最後の行の単位。文面が SETTLE_MS 変わらなかったら列に移す
const openLines = new Map<string, { text: string; jobs: Job[]; seenAt: number }>()
const run = { busy: false, downUntil: 0 }

function enqueue(job: Job) {
  if (queued.has(job.id)) return
  queued.add(job.id)
  queue.push(job)
}
// 設定（userConfig）。register が読み込みのたびに入れる
const cfg: { endpoint: string; start: string[]; style: Style } = {
  endpoint: DEFAULT_ENDPOINT,
  start: [],
  style: readStyle({}),
}

async function ensureServer($: EngineInterface): Promise<boolean> {
  const now = await $.clock.now()
  if (now < run.downUntil) return false
  try {
    if ((await $.http.fetch(`${cfg.endpoint}/health`)).ok) return true
  } catch {
    // 動いていない
  }
  run.downUntil = now + 5 * 60_000
  if (cfg.start.length === 0) {
    $.ui.toast(`mixed-language-gloss: PLaMo（${cfg.endpoint}）に繋がりません。5 分後にまた試します`)
    return false
  }
  $.ui.status('mixed-language-gloss: PLaMo を起動しています')
  const r = await $.process.run(cfg.start, { timeoutMs: 120_000 }).catch(() => null)
  $.ui.status(undefined)
  if (r?.exitCode === 0) {
    run.downUntil = 0
    return true
  }
  $.ui.toast('mixed-language-gloss: startCommand で PLaMo を起動できませんでした。5 分後にまた試します')
  return false
}

async function translate($: EngineInterface, u: Unit): Promise<string | null> {
  const src = u.kind === 'en' ? 'en' : 'ja'
  try {
    const r = await $.http.fetch(`${cfg.endpoint}/v1/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: pfml3(u.from, src),
        temperature: 0,
        max_tokens: 1024,
        stop: ['<|plamo:tag|>', '<|plamo:bos|>'],
      }),
    })
    if (!r.ok) return null
    const out = String(JSON.parse(r.text)?.choices?.[0]?.text ?? '').trim()
    // 空・元のまま・長さが極端に違う出力は使わない
    const ratio = out.length / Math.max(1, u.from.length)
    const [lo, hi] = src === 'en' ? [0.1, 2] : [0.4, 2.5]
    if (!out || out === u.from || ratio < lo || ratio > hi) return null
    return out
  } catch {
    return null
  }
}

async function drain($: EngineInterface) {
  run.busy = true
  try {
    const now = await $.clock.now()
    for (const [key, open] of openLines) {
      if (now - open.seenAt < SETTLE_MS) continue
      openLines.delete(key)
      open.jobs.forEach(enqueue)
    }
    for (let job = queue.shift(); job; job = queue.shift()) {
      const ref = { ...unitsRef, id: job.id }
      await $.state.set(ref, { status: 'pending', to: null })
      if (!(await ensureServer($))) {
        // 繋がらなかったものはキャッシュせず、繋がるようになってから描画のときにまた列に入れる
        queued.delete(job.id)
        await $.state.set(ref, { status: 'down', to: null })
        continue
      }
      await $.state.set(ref, { status: 'done', to: await translate($, job.unit) })
    }
  } finally {
    run.busy = false
  }
}

export const register: Register = (on, options) => {
  const endpoint = typeof options.endpoint === 'string' ? options.endpoint.trim().replace(/\/+$/, '') : ''
  cfg.endpoint = endpoint || DEFAULT_ENDPOINT
  cfg.start = typeof options.startCommand === 'string' ? splitCommand(options.startCommand) : []
  cfg.style = readStyle(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: '応答に紛れた中国語の字・キリル文字・英語の段落に PLaMo 3 Translate の訳を差し込む（on / off）',
      argumentHint: 'on|off',
    })
    $.clock.every(500, () => {
      if (!run.busy && (queue.length > 0 || openLines.size > 0)) void drain($)
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    const { value: current = 'fix' } = await $.state.get(modeRef)
    const mode: Mode = arg === 'off' ? 'off' : arg === 'on' ? 'fix' : current === 'fix' ? 'off' : 'fix'
    await $.state.set(modeRef, mode)
    return {
      text: mode === 'fix' ? '訳を差し込みます' : '止めました（原文のまま表示します）',
    }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const { value: mode = 'fix' } = await $.state.get(modeRef)
    if (mode === 'off') return next(e)
    const text = e.props.text
    const found = findUnits(text)
    if (found.length === 0) return next(e)

    // 単位ごとにキャッシュを見る。まだ訳していないものは、改行で終わった行なら列に入れ、最後の行なら落ち着くのを待つ
    const now = await $.clock.now()
    const applied: Fix[] = []
    const open: Job[] = []
    let waitingCount = 0
    let isDown = false
    for (const unit of found) {
      const id = unitId(unit)
      const { value } = await $.state.get({ ...unitsRef, id })
      if (value?.status === 'done') {
        if (value.to !== null) applied.push({ from: unit.from, kind: unit.kind, to: value.to })
        continue
      }
      waitingCount++
      if (value?.status === 'down') {
        isDown = true
        if (now < run.downUntil) continue
      }
      // 読み込み直しの前に訳しかけていたもの（pending のまま列にないもの）も入れ直す
      if (value?.status === 'pending' && queued.has(id)) continue
      if (unit.isClosed) enqueue({ id, unit })
      else open.push({ id, unit })
    }
    if (open.length === 0) openLines.delete(e.requestId)
    else if (openLines.get(e.requestId)?.text !== text) openLines.set(e.requestId, { text, jobs: open, seenAt: now })

    const { Box, Text, Markdown } = $.ui.resolve(e)
    const style = cfg.style
    const footer = (note: string) => {
      if (!style.label) return null
      let k = 0
      const label = Array.from(style.label).map(c => {
        const color = c.trim() ? style.labelColorOf(k++) : ''
        return color ? <Text color={color}>{c}</Text> : c
      })
      return (
        <Text dimColor>
          {'  '}
          {label}
          {`: ${note}`}
        </Text>
      )
    }
    const waitingNote = isDown ? 'PLaMo に繋がりません' : '確かめています…'
    if (applied.length === 0) {
      const note = waitingCount > 0 ? waitingNote : '直せませんでした'
      return (
        <Box flexDirection="column">
          {await next(e)}
          {footer(note)}
        </Box>
      )
    }

    // 行内の Markdown（`code`・**太字**・[リンク](…)）だけを Text で描く。accentColor が無ければ記号を残す
    const inline = (s: string) =>
      s.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/).map(t =>
        t.startsWith('`') && t.endsWith('`') && t.length > 1 ? (
          style.accent ? <Text color={style.accent}>{t.slice(1, -1)}</Text> : t
        ) : t.startsWith('**') && t.endsWith('**') && t.length > 3 ? (
          <Text weight="bold">{t.slice(2, -2)}</Text>
        ) : t.startsWith('[') ? (
          <Text color={style.accent || undefined}>{t.slice(1, t.indexOf(']'))}</Text>
        ) : (
          t
        ),
      )
    const insert = (s: string, kind: Kind): RenderChildren => {
      const body = s.trim()
      switch (style.strategy) {
        case 'text':
          return <Text color={style.colorOf(kind, 0, 1)}>{`〔${body}〕`}</Text>
        default: {
          // 背景を塗る塗り方は、1 字ずつ style.colorOf に色を聞く
          const chars = Array.from(body)
          return (
            <Text>
              {chars.map((c, i) => (
                <Text backgroundColor={style.colorOf(kind, i, chars.length)} color={style.textColor}>
                  {c}
                </Text>
              ))}
            </Text>
          )
        }
      }
    }

    // 直した行は Text で描き、それ以外の行はまとめて Markdown に渡す
    const rows: RenderChildren[] = []
    let md: string[] = []
    const flush = () => {
      const body = md.join('\n')
      if (body.trim()) {
        if (/^\s*\n/.test(body) && rows.length) rows.push(<Text> </Text>)
        rows.push(<Markdown text={body.trim()} />)
        if (/\n\s*$/.test(body)) rows.push(<Text> </Text>)
      } else if (md.length && rows.length) rows.push(<Text> </Text>)
      md = []
    }
    let count = 0
    for (const line of splitLines(text)) {
      const fixes = line.isCode
        ? []
        : applied.filter(f => (f.kind === 'en' ? line.body.trim() === f.from : line.body.includes(f.from)))
      if (fixes.length === 0) {
        md.push(line.raw)
        continue
      }
      flush()
      const en = fixes.find(f => f.kind === 'en')
      if (en) {
        count++
        rows.push(
          <Text>
            {line.marker}
            {inline(line.body)}
          </Text>,
        )
        rows.push(
          <Text>
            {' '.repeat(line.marker.length)}
            {insert(en.to, 'en')}
          </Text>,
        )
        continue
      }
      // 文ごとに、原文の後ろへ訳を差し込む
      let rest = line.body
      const parts: RenderChildren[] = [line.marker]
      for (const f of fixes) {
        const at = rest.indexOf(f.from)
        if (at < 0) continue
        parts.push(inline(rest.slice(0, at)))
        for (const p of weave(f.from, f.to)) {
          parts.push(inline(p.text))
          if (p.insert !== undefined) {
            parts.push(insert(p.insert, f.kind))
            count++
          }
        }
        rest = rest.slice(at + f.from.length)
      }
      parts.push(inline(rest))
      rows.push(<Text>{parts}</Text>)
    }
    flush()

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box width={2} flexShrink={0}>
            <Text color={style.accent || undefined}>{e.props.isFirstOfReply ? '●' : ' '}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            {rows}
          </Box>
        </Box>
        {footer(
          waitingCount > 0
            ? `${count} か所に訳を差し込みました。残り ${waitingCount} 件は${waitingNote}`
            : `${count} か所に訳を差し込みました（/${COMMAND} off で止める）`,
        )}
      </Box>
    )
  })
}
