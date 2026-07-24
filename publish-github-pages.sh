#!/usr/bin/env bash
# 在独立仓库目录执行：创建 GitHub 公开仓库并开启 Pages（main / root）
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$(dirname "$0")"

if ! command -v gh >/dev/null; then
  echo "请先安装 GitHub CLI: https://cli.github.com/"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "即将打开浏览器登录 GitHub…"
  gh auth login --hostname github.com --git-protocol https --web
fi

OWNER=$(gh api user -q .login)
REPO_NAME="${1:-klgzapp-com}"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  :
else
  git init
  git branch -M main
  git add -A
  git commit -m "Add App Code site for www.klgzapp.com"
fi

if gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  echo "仓库已存在: $OWNER/$REPO_NAME"
  if ! git remote get-url origin >/dev/null 2>&1; then
    git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
  fi
  git push -u origin main
else
  gh repo create "$REPO_NAME" \
    --public \
    --description "www.klgzapp.com · App Code (GitHub Pages)" \
    --source=. \
    --remote=origin \
    --push
fi

# Enable Pages from main /
gh api -X PUT "repos/$OWNER/$REPO_NAME/pages" --input - <<'JSON' || \
gh api -X POST "repos/$OWNER/$REPO_NAME/pages" --input - <<'JSON'
{"build_type":"legacy","source":{"branch":"main","path":"/"}}
JSON

echo ""
echo "仓库: https://github.com/$OWNER/$REPO_NAME"
echo "Pages 默认: https://$OWNER.github.io/$REPO_NAME/"
echo "自定义域: CNAME=www.klgzapp.com — 请在 Settings → Pages 核对，DNS 将 www CNAME 到 $OWNER.github.io"
