/** zh: CP932 にない漢字（簡体字など）、ru: キリル文字、en: 段落ごと英語 */
export type Kind = 'zh' | 'ru' | 'en'

/** 直す単位（文か行）と PLaMo の出力 */
export type Fix = { from: string; to: string; kind: Kind }

/**
 * 単位ごとの訳。鍵は種類と文面なので、同じ文が別の応答に出ても訳し直さない（セッションの間のキャッシュ）。
 * pending: 訳している、done: 訳し終えた（`to` が null なら PLaMo が使える答えを返さなかった）、
 * down: PLaMo に繋がらなかった（繋がるようになったらまた訳す）
 */
export type UnitFix = { status: 'pending' | 'done' | 'down'; to: string | null }

/** fix: 差し込む、off: 何もしない */
export type Mode = 'fix' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'mixed-language-gloss': { units: StateFamily<UnitFix>; mode: Mode }
  }
}
