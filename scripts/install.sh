#!/bin/bash
# ═══════════════════════════════════════
#  install.sh — AutoDev Teams 설치
# ═══════════════════════════════════════
set -euo pipefail

INSTALL_DIR="$HOME/.autodev"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "AutoDev Teams 설치 중..."

# 1. 디렉토리 생성
mkdir -p \
  "$INSTALL_DIR/lib" \
  "$INSTALL_DIR/agents" \
  "$INSTALL_DIR/prompts" \
  "$INSTALL_DIR/teams" \
  "$INSTALL_DIR/logs"

# 2. 파일 복사
cp "$SCRIPT_DIR/autodev.sh"          "$INSTALL_DIR/autodev.sh"
cp "$SCRIPT_DIR/lib/"*.sh            "$INSTALL_DIR/lib/"
cp "$SCRIPT_DIR/prompts/"*.md        "$INSTALL_DIR/prompts/"

# 3. 실행 권한
chmod +x \
  "$INSTALL_DIR/autodev.sh" \
  "$INSTALL_DIR/lib/"*.sh

# 4. PATH 등록
SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
fi

if [ -n "$SHELL_RC" ]; then
  if ! grep -q 'autodev' "$SHELL_RC" 2>/dev/null; then
    {
      echo ""
      echo '# AutoDev Teams'
      echo "export PATH=\"\$HOME/.autodev:\$PATH\""
      echo "alias autodev='$INSTALL_DIR/autodev.sh'"
    } >> "$SHELL_RC"
    echo "✓ PATH 등록 완료: $SHELL_RC"
  fi
fi

# 5. 의존성 확인
echo ""
echo "의존성 확인:"
for dep in jq claude flock; do
  if command -v "$dep" &>/dev/null; then
    echo "  ✓ $dep"
  else
    echo "  ✗ $dep — 설치 필요: brew install $dep"
  fi
done

echo ""
echo "설치 완료!"
echo ""
echo "사용법:"
echo "  source $SHELL_RC          # PATH 즉시 적용"
echo "  autodev '아이디어 설명'    # 실행"
echo ""
echo "예시:"
echo "  autodev 'AI 일기 앱, 감정 분석, 다크모드'"
