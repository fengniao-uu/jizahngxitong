#!/bin/bash
# Cloudflare Workers Git 集成构建脚本
# 用于在 Git 集成部署时安装 Python 依赖并打包

set -e

echo "=== 安装 uv ==="
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

echo "=== 安装 workers-py ==="
uv pip install --system workers-py

echo "=== 运行 pywrangler build ==="
uv run pywrangler deploy --dry-run || true

echo "=== 构建完成 ==="
