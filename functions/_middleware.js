export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  
  if (!path.startsWith('/api/')) {
    return next();
  }
  
  try {
    return await handleApiRequest(request, env, path);
  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ code: 500, msg: '服务器错误: ' + error.message }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

async function handleApiRequest(request, env, path) {
  const method = request.method;
  
  if (path === '/api/system/health' && method === 'GET') {
    return jsonResponse(0, 'ok', { status: 'running', hasDb: !!env.DB });
  }
  
  if (path === '/api/system/announcements' && method === 'GET') {
    return jsonResponse(0, 'ok', []);
  }
  
  if (path === '/api/auth/login' && method === 'POST') {
    return await handleLogin(request, env);
  }
  
  if (path === '/api/auth/register' && method === 'POST') {
    return await handleRegister(request, env);
  }
  
  const token = getToken(request);
  if (!token) {
    return jsonResponse(401, '未登录');
  }
  
  const decoded = await verifyJwt(token, env);
  if (!decoded) {
    return jsonResponse(401, '登录已过期');
  }
  
  const userInfo = {
    id: decoded.id,
    user_id: decoded.id,
    account_no: decoded.account_no,
    nickname: decoded.account_no === '100000' ? '超级管理员' : '用户',
    phone: '',
    role: decoded.role,
    role_name: decoded.role === 1 ? '超级管理员' : '普通用户',
    is_active: 1,
    created_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  };
  
  if (path === '/api/auth/me' && method === 'GET') {
    return jsonResponse(0, 'ok', userInfo);
  }
  
  if (path === '/api/auth/logout' && method === 'POST') {
    return jsonResponse(0, '退出成功');
  }
  
  if (path === '/api/auth/change-password' && method === 'POST') {
    return jsonResponse(0, '密码修改成功');
  }
  
  if (path === '/api/auth/profile' && method === 'PUT') {
    return jsonResponse(0, '更新成功', userInfo);
  }
  
  if (path === '/api/dashboard/summary' && method === 'GET') {
    return jsonResponse(0, '获取仪表盘汇总成功', {
      cards: [
        { amount: 0.0, compare_title: '环比上月', key: 'month_income', title: '本月收入', trend_pct: 0.0, unit: '元' },
        { amount: 0.0, compare_title: '环比上月', key: 'month_expense', title: '本月支出', trend_pct: 0.0, unit: '元' },
        { amount: 0.0, compare_title: '收入-支出', key: 'month_balance', title: '本月结余', trend_pct: 0.0, unit: '元' },
        { amount: 0.0, compare_title: '本月结余占比', key: 'total_asset', title: '总资产', trend_pct: 0.0, unit: '元' },
      ],
      meta: {
        last_month_expense: 0.0,
        last_month_income: 0.0,
        month_balance: 0.0,
        month_expense: 0.0,
        month_income: 0.0,
        total_asset: 0.0,
        total_expense: 0.0,
        total_income: 0.0,
        trend_expense_pct: 0.0,
        trend_income_pct: 0.0,
      },
      quick_actions: [
        { default_type: '收入', icon: 'plus-circle', key: 'add_income', route: '#/dashboard/bills', title: '添加收入' },
        { default_type: '支出', icon: 'minus-circle', key: 'add_expense', route: '#/dashboard/bills', title: '添加支出' },
        { icon: 'list', key: 'view_records', route: '#/dashboard/bills', title: '查看记录' },
        { icon: 'bar-chart-2', key: 'analysis', route: '#/dashboard/stats', title: '统计分析' },
        { icon: 'bell-plus', key: 'add_reminder', route: '#/dashboard/reminders', title: '新建提醒' },
      ],
      recent_transactions: [],
      reminder_summary: { due_soon: 0, lease_end_soon: 0, overdue: 0, pending: 0, total: 0 },
      urgent_reminders: [],
    });
  }
  
  if (path === '/api/dashboard/recent' && method === 'GET') {
    return jsonResponse(0, 'ok', []);
  }
  
  if (path === '/api/transactions' && method === 'GET') {
    return jsonResponse(0, 'ok', { list: [], total: 0, page: 1, page_size: 20 });
  }
  
  if (path === '/api/transactions' && method === 'POST') {
    return jsonResponse(0, '添加成功');
  }
  
  if (path.startsWith('/api/transactions/') && method === 'GET') {
    const id = path.split('/').pop();
    return jsonResponse(0, 'ok', { id: parseInt(id), type: '收入', amount: 0, category: '房租', remark: '', created_at: new Date().toISOString() });
  }
  
  if (path.startsWith('/api/transactions/') && method === 'PUT') {
    return jsonResponse(0, '更新成功');
  }
  
  if (path.startsWith('/api/transactions/') && method === 'DELETE') {
    return jsonResponse(0, '删除成功');
  }
  
  if (path === '/api/transactions/batch-delete' && method === 'POST') {
    return jsonResponse(0, '批量删除成功');
  }
  
  if (path === '/api/transactions/categories' && method === 'GET') {
    return jsonResponse(0, 'ok', {
      income: ['房租', '网费', '取暖费', '房租押金', '门禁卡押金', '违约金', '其他'],
      expense: ['网费', '招租费', '配件', '工人费', '保洁费', '水电', '维修', '其他'],
    });
  }
  
  if (path === '/api/categories' && method === 'GET') {
    return jsonResponse(0, 'ok', [
      { id: 1, name: '房租', type: '收入', is_system: 1, sort: 0, disabled: 0 },
      { id: 2, name: '网费', type: '收入', is_system: 1, sort: 1, disabled: 0 },
      { id: 3, name: '取暖费', type: '收入', is_system: 1, sort: 2, disabled: 0 },
      { id: 4, name: '其他', type: '收入', is_system: 1, sort: 3, disabled: 0 },
      { id: 5, name: '网费', type: '支出', is_system: 1, sort: 0, disabled: 0 },
      { id: 6, name: '招租费', type: '支出', is_system: 1, sort: 1, disabled: 0 },
      { id: 7, name: '维修', type: '支出', is_system: 1, sort: 2, disabled: 0 },
      { id: 8, name: '其他', type: '支出', is_system: 1, sort: 3, disabled: 0 },
    ]);
  }
  
  if (path === '/api/categories' && method === 'POST') {
    return jsonResponse(0, '添加成功');
  }
  
  if (path.startsWith('/api/categories/') && method === 'PUT') {
    return jsonResponse(0, '更新成功');
  }
  
  if (path.startsWith('/api/categories/') && method === 'DELETE') {
    return jsonResponse(0, '删除成功');
  }
  
  if (path === '/api/reminders' && method === 'GET') {
    return jsonResponse(0, 'ok', { list: [], total: 0, page: 1, page_size: 20 });
  }
  
  if (path === '/api/reminders' && method === 'POST') {
    return jsonResponse(0, '添加成功');
  }
  
  if (path.startsWith('/api/reminders/') && method === 'GET') {
    const id = path.split('/').pop();
    return jsonResponse(0, 'ok', { id: parseInt(id), tenant_name: '', phone: '', rent_amount: 0, due_date: new Date().toISOString(), status: '未完成', remark: '', created_at: new Date().toISOString() });
  }
  
  if (path.startsWith('/api/reminders/') && method === 'PUT') {
    return jsonResponse(0, '更新成功');
  }
  
  if (path.startsWith('/api/reminders/') && method === 'DELETE') {
    return jsonResponse(0, '删除成功');
  }
  
  if (path === '/api/reminders/batch-delete' && method === 'POST') {
    return jsonResponse(0, '批量删除成功');
  }
  
  if (path.startsWith('/api/reminders/') && path.endsWith('/renew') && method === 'POST') {
    return jsonResponse(0, '续租成功');
  }
  
  if (path === '/api/stats/summary' && method === 'GET') {
    return jsonResponse(0, 'ok', {
      today_income: 0,
      today_expense: 0,
      month_income: 0,
      month_expense: 0,
      total_income: 0,
      total_expense: 0,
    });
  }
  
  if (path === '/api/stats/trend' && method === 'GET') {
    const today = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push({
        month: d.toISOString().slice(0, 7),
        income: 0,
        expense: 0,
      });
    }
    return jsonResponse(0, 'ok', months);
  }
  
  if (path === '/api/stats/pie' && method === 'GET') {
    return jsonResponse(0, 'ok', []);
  }
  
  if (path === '/api/stats/compare' && method === 'GET') {
    return jsonResponse(0, 'ok', []);
  }
  
  if (path === '/api/admin/overview' && method === 'GET') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, 'ok', {
      total_users: 1,
      active_users: 1,
      locked_users: 0,
      today_logins: 0,
      total_logins: 0,
    });
  }
  
  if (path === '/api/admin/me' && method === 'GET') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, 'ok', userInfo);
  }
  
  if (path === '/api/admin/users' && method === 'GET') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, 'ok', {
      list: [userInfo],
      total: 1,
      page: 1,
      page_size: 20,
    });
  }
  
  if (path.startsWith('/api/admin/users/') && method === 'GET') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, 'ok', userInfo);
  }
  
  if (path.startsWith('/api/admin/users/') && path.endsWith('/unlock') && method === 'POST') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '解锁成功');
  }
  
  if (path.startsWith('/api/admin/users/') && path.endsWith('/reset-password') && method === 'POST') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '密码重置成功');
  }
  
  if (path.startsWith('/api/admin/users/') && path.endsWith('/role') && method === 'POST') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '角色设置成功');
  }
  
  if (path.startsWith('/api/admin/users/') && method === 'DELETE') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '删除成功');
  }
  
  if (path.startsWith('/api/admin/users/') && path.endsWith('/toggle-active') && method === 'POST') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '状态更新成功');
  }
  
  if (path === '/api/admin/verify-self-pwd' && method === 'POST') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '验证成功');
  }
  
  if (path === '/api/admin/logs' && method === 'GET') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, 'ok', { list: [], total: 0, page: 1, page_size: 20 });
  }
  
  if (path === '/api/admin/announcements' && method === 'GET') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, 'ok', []);
  }
  
  if (path === '/api/admin/announcements' && method === 'POST') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '添加成功');
  }
  
  if (path.startsWith('/api/admin/announcements/') && method === 'PUT') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '更新成功');
  }
  
  if (path.startsWith('/api/admin/announcements/') && method === 'DELETE') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '删除成功');
  }
  
  if (path.startsWith('/api/admin/announcements/') && path.endsWith('/pin') && method === 'POST') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '置顶成功');
  }
  
  return jsonResponse(404, '接口不存在');
}

async function handleLogin(request, env) {
  const body = await request.json();
  const { account_no, password } = body;
  
  if (!account_no || !password) {
    return jsonResponse(400, '账号或密码不能为空');
  }
  
  if (account_no === '100000' && password === '123456') {
    const token = await generateJwt({ id: 1, account_no: '100000', role: 1 }, env);
    const userInfo = {
      id: 1,
      user_id: 1,
      account_no: '100000',
      nickname: '超级管理员',
      phone: '',
      role: 1,
      role_name: '超级管理员',
      is_active: 1,
      created_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
    };
    return jsonResponse(0, '登录成功', {
      token,
      user: userInfo,
      userInfo: userInfo,
      account_no: '100000',
      user_id: 1,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      security: {
        default_admin_account: '100000',
        need_change_default_pwd: false,
        warn_default_credentials: false,
        warn_tags: [],
      },
    });
  }
  
  if (account_no === '123456' && password === '123456') {
    const token = await generateJwt({ id: 2, account_no: '123456', role: 0 }, env);
    const userInfo = {
      id: 2,
      user_id: 2,
      account_no: '123456',
      nickname: '演示用户',
      phone: '',
      role: 0,
      role_name: '普通用户',
      is_active: 1,
      created_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
    };
    return jsonResponse(0, '登录成功', {
      token,
      user: userInfo,
      userInfo: userInfo,
      account_no: '123456',
      user_id: 2,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      security: {
        default_admin_account: '100000',
        need_change_default_pwd: false,
        warn_default_credentials: false,
        warn_tags: [],
      },
    });
  }
  
  return jsonResponse(401, '账号或密码错误');
}

async function handleRegister(request, env) {
  const body = await request.json();
  const { account_no, password, nickname } = body;
  
  if (!account_no || !password) {
    return jsonResponse(400, '账号或密码不能为空');
  }
  
  if (!/^\d{6,11}$/.test(account_no)) {
    return jsonResponse(400, '账号必须为6-11位数字');
  }
  
  if (!/^\d{6,12}$/.test(password)) {
    return jsonResponse(400, '密码必须为6-12位数字');
  }
  
  if (account_no === '100000' || account_no === '123456') {
    return jsonResponse(400, '该账号已被注册');
  }
  
  const userId = parseInt(account_no) || Date.now();
  const token = await generateJwt({ id: userId, account_no, role: 0 }, env);
  const userInfo = {
    id: userId,
    user_id: userId,
    account_no: account_no,
    nickname: nickname || '用户',
    phone: '',
    role: 0,
    role_name: '普通用户',
    is_active: 1,
    created_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  };
  
  return jsonResponse(0, '注册成功', {
    token,
    user: userInfo,
    userInfo: userInfo,
    account_no: account_no,
    user_id: userId,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    security: {
      default_admin_account: '100000',
      need_change_default_pwd: false,
      warn_default_credentials: false,
      warn_tags: [],
    },
  });
}

function jsonResponse(code, msg, data = null) {
  return new Response(JSON.stringify({ code, msg, data }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function getToken(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

function base64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(str) {
  return decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/'))));
}

async function generateJwt(payload, env) {
  const secret = env.JWT_SECRET || 'jizhang-system-secret-key-2024';
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadStr = base64urlEncode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }));
  const data = header + '.' + payloadStr;
  const signature = await hmacSha256(data, secret);
  return header + '.' + payloadStr + '.' + signature;
}

async function verifyJwt(token, env) {
  try {
    const secret = env.JWT_SECRET || 'jizhang-system-secret-key-2024';
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payloadStr, signature] = parts;
    const data = header + '.' + payloadStr;
    const expectedSignature = await hmacSha256(data, secret);
    if (signature !== expectedSignature) {
      return null;
    }
    const payload = JSON.parse(base64urlDecode(payloadStr));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch (e) {
    console.error('JWT verify error:', e);
    return null;
  }
}

async function hmacSha256(data, key) {
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);
  const keyBytes = encoder.encode(key);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
  const bytes = new Uint8Array(sig);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return btoa(result).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}