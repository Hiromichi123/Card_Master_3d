#!/usr/bin/env bash
#
# 把 dist/ 打包成单个 Windows exe（带图标）。
#
# 用法（在仓库任意位置都行，Git Bash 里跑）：
#     bash packaging/build.sh
#
# 产物：packaging/CardMaster3D.exe
#
# 前置：
#   1. 先在仓库根目录跑过 npm run build，且 dist/ 是最新的；
#   2. 图标用 packaging/icon/icon.ico（改图标见 packaging/icon/make-ico.mjs）；
#   3. 想要 exe 带图标，需要 rsrc（见下面第 2 步）。

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
pack="$root/packaging"

if [ ! -f "$root/dist/index.html" ]; then
  echo "找不到 $root/dist/index.html" >&2
  echo "请先在仓库根目录跑： npm run build" >&2
  exit 1
fi

echo "==> 1/4 同步 dist/ → packaging/dist/"
rm -rf "$pack/dist"
cp -r "$root/dist" "$pack/dist"

# 不把 sourcemap 发出去：白多 11 MB，而且会把 TypeScript 源码暴露给接收方。
# 仓库里的 dist/ 不受影响，这里只删副本。
removed=$(find "$pack/dist" -name '*.map' -type f | wc -l | tr -d ' ')
find "$pack/dist" -name '*.map' -type f -delete
echo "    剔除 sourcemap： $removed 个"

echo "==> 2/4 生成 Windows 图标资源 (.syso)"
# rsrc 把 .ico 转成 Go 能吃的 COFF 对象。装它：
#     GOPROXY=https://goproxy.cn,direct go install github.com/akavel/rsrc@latest
rsrc_bin="$(command -v rsrc 2>/dev/null || echo "$(go env GOPATH)/bin/rsrc")"
if [ -x "$rsrc_bin" ] || command -v "$rsrc_bin" >/dev/null 2>&1; then
  "$rsrc_bin" -ico "$pack/icon/icon.ico" -arch amd64 -o "$pack/rsrc_windows_amd64.syso"
  echo "    已嵌入 icon.ico"
else
  rm -f "$pack/rsrc_windows_amd64.syso"
  echo "    [警告] 没找到 rsrc，这次的 exe 将是默认空白图标。"
  echo "           装上即可：GOPROXY=https://goproxy.cn,direct go install github.com/akavel/rsrc@latest"
fi

echo "==> 3/4 编译 Windows 单文件 exe"
cd "$pack"
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o "$pack/CardMaster3D.exe" .

echo "==> 4/4 完成"
size=$(stat -c%s "$pack/CardMaster3D.exe")
awk -v b="$size" 'BEGIN{printf "    %s  (%.1f MB)\n", "packaging/CardMaster3D.exe", b/1048576}'
echo
echo "发给别人：直接发 packaging/CardMaster3D.exe 这一个文件。"
echo "如果对方平台不收 .exe（网盘/微信常拦），先压成 zip："
echo "    cd packaging && powershell -NoProfile -Command \"Compress-Archive -Path CardMaster3D.exe -DestinationPath CardMaster3D.zip -Force\""
echo "    （用相对路径，PowerShell 不认 Git Bash 的 /d/... 形式）"
