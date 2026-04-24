#!/usr/bin/env bash
set -euo pipefail

# vSync 플러그인 배포 스크립트
# 사용법: GITHUB_TOKEN=... ./scripts/deploy.sh <version> [--force]
# 예시:   GITHUB_TOKEN=xxx ./scripts/deploy.sh 0.2.0

BRANCH="plugin-only"
REMOTE="vsync-plugin"
AUTHOR_NAME="yu-seungwoo"
AUTHOR_EMAIL="mail@vector.ai.kr"
PLUGIN_DIR="packages/plugin"

VERSION="${1:-}"
FORCE="${2:-}"

if [ -z "$VERSION" ]; then
    echo "사용법: $0 <version> [--force]"
    echo "예시:   GITHUB_TOKEN=xxx $0 0.2.0"
    exit 1
fi

if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "에러: 버전은 X.Y.Z 형식이어야 합니다"
    exit 1
fi

TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$TOKEN" ]; then
    echo "에러: GITHUB_TOKEN 환경변수가 필요합니다"
    exit 1
fi

AUTH_URL="https://${TOKEN}@github.com/yu-seungwoo-777/vSync-Obsidian.git"

echo "=== vSync 플러그인 배포 v${VERSION} ==="

# 미커밋 변경사항 확인
if [ -n "$(git status --porcelain "$PLUGIN_DIR")" ]; then
    echo "에러: $PLUGIN_DIR 에 미커밋 변경사항이 있습니다"
    exit 1
fi

# 리모트 확인
if ! git remote get-url "$REMOTE" &>/dev/null; then
    echo "리모트 추가: $REMOTE"
    git remote add "$REMOTE" "$AUTH_URL"
fi

# plugin-only 브랜치 확인 (post-commit hook이 자동 생성)
if ! git rev-parse --verify "$BRANCH" &>/dev/null; then
    echo "에러: $BRANCH 브랜치가 없습니다. packages/plugin/ 파일을 커밋하세요."
    exit 1
fi

echo "[1/3] 독립 저장소에 푸시..."
if [ "$FORCE" = "--force" ]; then
    git push "$AUTH_URL" "$BRANCH:main" --force
else
    git push "$AUTH_URL" "$BRANCH:main"
fi

echo "[2/3] 태그 생성 v${VERSION}..."
git tag -d "$VERSION" 2>/dev/null || true
git push "$AUTH_URL" ":refs/tags/$VERSION" 2>/dev/null || true

GIT_COMMITTER_NAME="$AUTHOR_NAME" \
GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
git tag -a "$VERSION" "$BRANCH" -m "v${VERSION}"

echo "[3/3] 태그 푸시 v${VERSION}..."
git push "$AUTH_URL" "$VERSION"

echo ""
echo "=== 배포 완료 ==="
echo "CI: https://github.com/yu-seungwoo-777/vSync-Obsidian/actions"
echo "다음 단계: Draft Release에서 What's Changed 확인 후 Publish"
