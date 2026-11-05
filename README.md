# mixed-language-gloss

Claude Code の mod。Claude の日本語の応答に紛れた別の言語（中国語の字・キリル文字・段落ごとの英語）を見つけ、[PLaMo 3 Translate](https://huggingface.co/pfnet) で日本語にした訳を、原文の後ろに差し込んで表示します。

```
変更を确认確認してから push します。        ← 「确认」の後ろに「確認」を背景色付きで差し込む
この設定は всегда常に 有効です。
The server is still running in the background.
  サーバーはバックグラウンドで動き続けています。   ← 英語の行の下に訳の行を差し込む
```

- 変わるのは表示だけです。記録（ctrl+o）と、モデルが次のターンで読む文脈は元のままです。
- 原文は消しません。訳は原文の後ろに足します。
- 翻訳はローカルの llama-server で動かします。応答の文が外部のサービスに送られることはありません。

## 必要なもの

- function hooks の mod を読み込める Claude Code
- [llama.cpp](https://github.com/ggml-org/llama.cpp) の `llama-server`
- PLaMo 3 Translate の GGUF（`plamo-3-translate-2b-Q4_K_M.gguf` など）と、モデルに同梱の `chat_template.jinja`
  - モデルの利用条件は PLaMo の配布元のライセンスに従ってください。この mod はモデルを含みません

2B の Q4_K_M なら CPU だけで 1 文 1 秒前後で訳せます（Core i9-12900KF で 0.6〜1.6 秒）。

## 入れ方

Claude Code のプロンプトで:

```
/plugin install mixed-language-gloss --marketplace called-d/mixed-language-gloss-mod
```

シェルからなら:

```
claude plugin install mixed-language-gloss --marketplace called-d/mixed-language-gloss-mod
```

## PLaMo を動かす

自分で起動しておく場合:

```
llama-server -m plamo-3-translate-2b-Q4_K_M.gguf -c 16384 --host 127.0.0.1 --port 8090 \
  --chat-template-file chat_template.jinja --no-prefill-assistant
```

必要になったときだけ起動させる場合は、設定の `startCommand` に起動用のスクリプトを書きます。`scripts/` の 2 本は、サーバーを裏で起動して、応答するまで待ってから終わります。

- Windows（PowerShell 7）: `"C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -File "C:\path\to\scripts\start-plamo.ps1" -LlamaServer "C:\llama.cpp\llama-server.exe" -ModelDir "C:\models\plamo-3-translate"`
- Linux・macOS: `/path/to/scripts/start-plamo.sh /usr/local/bin/llama-server /path/to/plamo-3-translate`

`startCommand` に書くコマンドは、サーバーの標準入出力を呼び出し元から切り離してください。切り離さないと、Claude Code がサーバーの終了まで待ち続けます。

## 設定

`/config` の一覧か、`~/.claude/settings.json` の `pluginConfigs` で設定します。

```json
{
  "pluginConfigs": {
    "mixed-language-gloss": {
      "options": {
        "startCommand": "/path/to/scripts/start-plamo.sh /usr/local/bin/llama-server /path/to/plamo-3-translate",
        "style": "per-char",
        "palette": "#8a5a12,#2e6e62,#4f5d6b,#6b4f6b"
      }
    }
  }
}
```

| 項目 | 既定 | 内容 |
|---|---|---|
| `endpoint` | `http://127.0.0.1:8090` | llama-server の URL（`/v1` は付けない） |
| `startCommand` | 空 | エンドポイントが応答しないときに実行するコマンド。空白区切りで、`"…"` で囲むと 1 つの引数。空なら起動しない |
| `style` | `per-kind` | 訳の塗り方。`per-kind`: 種類ごとに 1 色の背景、`per-char`: 1 字ずつ `palette` を巡る背景、`gradient`: 訳の頭から終わりまで `palette` の色をなめらかにつなぐ背景、`text`: 背景なしで文字色と〔〕 |
| `palette` | `#8a5a12,#2e6e62,#4f5d6b` | カンマ区切りの色。`per-kind` と `text` では 1・2・3 番目が中国語の字・キリル文字・英語の色。`per-char` と `gradient` ではその番目から順に巡る。`gradient` で混ぜるのは `#rrggbb` の色だけ |
| `textColor` | `#ffffff` | 背景を塗るときの文字色 |
| `accentColor` | 空 | 差し込んだブロックの先頭の ● とインラインコードの色。空なら端末の既定の色 |
| `label` | `PLaMo 3 Translate` | 応答の下に添える行の見出し。空なら添えない |
| `labelColor` | 空 | 見出しの文字色。空なら薄い色、`palette` なら 1 字ずつ `palette` の色を順に巡る（空白は数えない）、色を書けばその色 |

`/mixed-gloss off` で止め、`/mixed-gloss on` でまた差し込みます。

## 何を拾うか

- **中国語の字**: CP932 で表せない漢字。ただし 剝・頰・塡 など、CP932 になくても日本語で使う字は除きます。JIS X 0213 を基準にしないのは、你・呢・吧・晚 のような中国語の字が 700 字以上含まれるためです
- **キリル文字**
- **段落ごとの英語**: 日本語の字を含まず、英単語が 5 つ以上で、小文字の単語が 3 つ以上続く行

次の部分は見ません。中国語や英語を例として挙げた文を拾わないためです。

- 「」『』“”"" で囲んだ部分、インラインコード、リンク先、URL
- コードブロック、表、引用（`>`）、字下げしたコード

日本語の文に 1 語だけ紛れた英単語（`verify`、`flaky` など）は拾いません。正しく英語のままにしている語と見分けにくく、PLaMo に渡しても半分ほどしか直らなかったためです。

## 差し込み方

紛れた字を含む文は、日本語→日本語の翻訳として PLaMo に渡します。PLaMo は紛れた語を日本語に直し、英語のままでよい語（`fast-forward`、`Register-ScheduledTask` など）は残します。原文と出力を字単位で比べ、紛れた字を含む箇所の後ろにだけ訳を差し込みます。PLaMo が言い換えた箇所（「変えたあと」→「変更した後」など）は差し込みません。文の 6 割を超えて変わったときは、文の後ろに訳文をまるごと差し込みます。

訳すのは、改行で終わった行からです。Claude が応答を書いている途中でも、閉じた行から順に PLaMo に送ります。改行で終わっていない最後の行は書きかけかもしれないので、文面が 1.5 秒変わらなくなってから訳します。訳が届いた箇所から差し込み、残りの件数を下に添えます。

訳は文（英語なら行）ごとに覚えておき、同じ文が別の応答に出てきたら訳し直しません。覚えておくのはセッションの間だけです。PLaMo に繋がらなかった文は覚えず、繋がるようになってから訳します。

## 開発

```
claude plugin validate .
claude plugin test .
python scripts/gen-cp932-kanji.py   # hooks/cp932-kanji.ts を作り直す
```

## ライセンス

MIT または CC0-1.0 の、好きな方を選んで使えます（[LICENSE-MIT](LICENSE-MIT)、[LICENSE-CC0](LICENSE-CC0)）。

このリポジトリは Preferred Networks および Preferred Elements とは関係のない個人のプロジェクトです。PLaMo の名前は、翻訳に使うモデルを示すためにだけ使っています。

## English

A Claude Code mod that finds text in another language mixed into Claude's Japanese replies (stray Chinese characters, Cyrillic, whole English paragraphs) and shows a Japanese translation from a local PLaMo 3 Translate server (llama.cpp) right after the original text. Only the display changes; the transcript and the model's context stay as they were. Licensed under MIT or CC0-1.0, at your option. Not affiliated with Preferred Networks or Preferred Elements.
