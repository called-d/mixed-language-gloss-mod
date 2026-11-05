# PLaMo 3 Translate の llama-server が応答しなければ、見えないウィンドウで起動して、応答するまで待つ（Windows・PowerShell 7）。
# mixed-language-gloss の設定 startCommand から呼ぶ例:
#   "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -File "C:\path\to\mixed-language-gloss\scripts\start-plamo.ps1" -LlamaServer "C:\llama.cpp\llama-server.exe" -ModelDir "C:\models\plamo-3-translate"
# 止めるとき:
#   Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object CommandLine -like '*plamo-3-translate*' | ForEach-Object { Stop-Process -Id $_.ProcessId }
param(
    [Parameter(Mandatory)] [string] $LlamaServer,
    # plamo-3-translate-<Size>-<Quant>.gguf と、モデルに同梱の chat_template.jinja を置いたフォルダ
    [Parameter(Mandatory)] [string] $ModelDir,
    [string] $Size = '2b',
    [string] $Quant = 'Q4_K_M',
    [int] $Port = 8090,
    [int] $Context = 16384,
    # 全層を GPU に載せる（CUDA 版の llama-server で。2B で VRAM 約 2.3GB）
    [switch] $Gpu,
    [string] $Log = (Join-Path $env:TEMP 'plamo-server.log')
)
$ErrorActionPreference = 'Stop'

function Test-Plamo {
    try { (Invoke-WebRequest "http://127.0.0.1:$Port/health" -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

if (Test-Plamo) { exit 0 }

$model = Join-Path $ModelDir "plamo-3-translate-$Size-$Quant.gguf"
$template = Join-Path $ModelDir 'chat_template.jinja'
foreach ($f in $LlamaServer, $model, $template) { if (-not (Test-Path $f)) { Write-Error "見つからない: $f"; exit 1 } }

# 起動中（モデルの読み込み中は /health が 503）なら、もう一つは起動しない
$running = Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object CommandLine -like "*--port $Port*"
if (-not $running) {
    $serverArgs = @(
        "`"$LlamaServer`"", '-m', "`"$model`"", '-c', $Context, '--host', '127.0.0.1', '--port', $Port,
        '--alias', "plamo-3-translate-$Size",
        # GGUF に埋め込まれたテンプレートは対訳の履歴を扱わないので、同梱のものを使う
        '--chat-template-file', "`"$template`"", '--no-prefill-assistant'
    )
    if ($Gpu) { $serverArgs += @('-ngl', '99') }
    # Win32_Process.Create で起動する。Start-Process で出力をファイルに向けるとハンドルが受け継がれ、
    # 呼び出し元（mixed-language-gloss の startCommand）がサーバーの終了まで待ち続ける。ログは cmd がファイルに書く
    $cmd = "cmd.exe /d /c `"$($serverArgs -join ' ') > `"$Log`" 2>&1`""
    $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
    $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = $cmd
        CurrentDirectory = $ModelDir
        ProcessStartupInformation = $startup
    }
    if ($r.ReturnValue -ne 0) { Write-Error "llama-server を起動できない（Win32_Process.Create: $($r.ReturnValue)）"; exit 1 }
}
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Plamo) { exit 0 }
}
Write-Error "PLaMo が 127.0.0.1:$Port で応答しない。$Log を見る"
exit 1
