// Cloudflare Pages Functions - 把 Flask 应用路由到 Pages Function
// 注意：Pages 的 Python 支持需要通过 Workers 绑定实现
// 这里我们使用标准的 Pages Functions 来代理到 Worker

export async function onRequest(context) {
  // 直接透传给 Worker（由 wrangler.toml 中配置的 Python Worker 处理）
  return await context.next();
}
