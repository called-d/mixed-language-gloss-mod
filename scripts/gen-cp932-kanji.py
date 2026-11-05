"""hooks/cp932-kanji.ts を作り直す。

日本語の漢字として扱う字の集合 = CP932（Windows-31J）で表せる漢字（CJK 統合漢字・拡張 A・互換漢字）
+ CP932 にないが日本語で使う字（ALLOW）。これに入らない CJK の字を「紛れた中国語の字」とみなす。
JIS X 0213 を丸ごと使わないのは、你・呢・吧・晚 のような中国語の字が 700 字以上入るため。

  python scripts/gen-cp932-kanji.py
"""
from pathlib import Path

RANGES = [(0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF)]
# 常用漢字（2010）の CP932 にない 4 字と、表外漢字字体表の印刷標準字体のうちよく見るもの
ALLOW = "剝頰塡摑蠟噓屛俱"


def encodable(ch: str) -> bool:
    try:
        ch.encode("cp932")
        return True
    except UnicodeEncodeError:
        return False


chars = [chr(o) for a, b in RANGES for o in range(a, b + 1) if encodable(chr(o))]
chars += [c for c in ALLOW if c not in chars]
out = Path(__file__).resolve().parent.parent / "hooks" / "cp932-kanji.ts"
out.write_text(
    "// scripts/gen-cp932-kanji.py が作るファイル。手で直さない\n"
    "// CP932 で表せる漢字（CJK 統合漢字・拡張 A・互換漢字）と、CP932 にないが日本語で使う字\n"
    f"export const JA_KANJI = new Set(Array.from('{''.join(chars)}'))\n",
    encoding="utf-8",
)
print(f"{len(chars)} chars -> {out}")
