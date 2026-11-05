#!/usr/bin/env bash
# PLaMo 3 Translate の llama-server が応答しなければ、裏で起動して、応答するまで待つ（Linux・macOS）。
# mixed-language-gloss の設定 startCommand から呼ぶ例:
#   /path/to/mixed-language-gloss/scripts/start-plamo.sh /usr/local/bin/llama-server /path/to/plamo-3-translate
# 環境変数: PLAMO_SIZE（2b）、PLAMO_QUANT（Q4_K_M）、PLAMO_PORT（8090）、PLAMO_CONTEXT（16384）、
#           PLAMO_GPU=1 で全層を GPU に載せる、PLAMO_LOG（${TMPDIR:-/tmp}/plamo-server.log）
# 止めるとき: pkill -f 'llama-server.*plamo-3-translate'
set -euo pipefail

server=${1:?llama-server のパスを渡す}
model_dir=${2:?plamo-3-translate-*.gguf と chat_template.jinja のあるフォルダを渡す}
size=${PLAMO_SIZE:-2b}
quant=${PLAMO_QUANT:-Q4_K_M}
port=${PLAMO_PORT:-8090}
ctx=${PLAMO_CONTEXT:-16384}
log=${PLAMO_LOG:-${TMPDIR:-/tmp}/plamo-server.log}

up() { curl -fs -m 2 -o /dev/null "http://127.0.0.1:$port/health"; }

up && exit 0

model="$model_dir/plamo-3-translate-$size-$quant.gguf"
template="$model_dir/chat_template.jinja"
for f in "$server" "$model" "$template"; do
  [[ -e "$f" ]] || { echo "見つからない: $f" >&2; exit 1; }
done

if ! pgrep -f "llama-server.*--port $port" >/dev/null; then
  extra=()
  [[ "${PLAMO_GPU:-0}" == 1 ]] && extra=(-ngl 99)
  # 標準入出力をすべて切り離す。呼び出し元（mixed-language-gloss の startCommand）がサーバーの終了を待たないように
  nohup "$server" -m "$model" -c "$ctx" --host 127.0.0.1 --port "$port" \
    --alias "plamo-3-translate-$size" \
    --chat-template-file "$template" --no-prefill-assistant "${extra[@]}" \
    </dev/null >"$log" 2>&1 &
  disown
fi

for _ in $(seq 120); do
  sleep 0.5
  up && exit 0
done
echo "PLaMo が 127.0.0.1:$port で応答しない。$log を見る" >&2
exit 1
