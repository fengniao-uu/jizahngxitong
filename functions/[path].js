export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  
  if (path.startsWith('/api/')) {
    try {
      return await handleApiRequest(request, env, path);
    } catch (error) {
      console.error('API handler error:', error);
      return new Response(JSON.stringify({ code: 500, msg: '服务器内部错误', data: null }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
  }
  
  return null;
}

const CAPTCHA_STORE = new Map();

async function handleApiRequest(request, env, path) {
  const method = request.method;
  
  if (path === '/api/auth/captcha' && method === 'GET') {
    const { captcha_id, code, svg } = generateCaptcha();
    CAPTCHA_STORE.set(captcha_id, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
    return new Response(JSON.stringify({ code: 0, msg: 'ok', data: { captcha_id, image: svg, ttl: 300, length: 4 } }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
  
  if (path === '/api/system/health' && method === 'GET') {
    return jsonResponse(0, 'ok', { status: 'running' });
  }
  
  const hasDb = env && env.DB;
  
  if (!hasDb) {
    return jsonResponse(500, '数据库未配置');
  }
  
  try {
    await initDb(env);
  } catch (dbErr) {
    console.error('Database init error:', dbErr);
    return jsonResponse(500, '数据库初始化失败');
  }
  
  if (path === '/api/auth/login' && method === 'POST') {
    const body = await request.json();
    const { account_no, password, captcha_id, captcha_code } = body;
    
    if (!account_no || !password) {
      return jsonResponse(400, '账号或密码不能为空');
    }
    
    const captcha = CAPTCHA_STORE.get(captcha_id);
    if (!captcha || captcha.expiresAt < Date.now()) {
      CAPTCHA_STORE.delete(captcha_id);
      return jsonResponse(400, '验证码已过期，请刷新重试');
    }
    
    if (captcha.code.toLowerCase() !== captcha_code.toLowerCase()) {
      CAPTCHA_STORE.delete(captcha_id);
      return jsonResponse(400, '验证码错误');
    }
    
    CAPTCHA_STORE.delete(captcha_id);
    
    const user = await env.DB.prepare('SELECT * FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1')
      .bind(account_no).first();
    
    if (!user) {
      return jsonResponse(401, '账号或密码错误');
    }
    
    const isValid = await verifyPassword(password, user.password_hash);
    
    if (!isValid) {
      return jsonResponse(401, '账号或密码错误');
    }
    
    if (user.is_active === 0) {
      return jsonResponse(403, '账号已被禁用');
    }
    
    await env.DB.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(user.id).run();
    
    const token = await generateJwt({ id: user.id, account_no: user.account_no, role: user.role }, env);
    
    return jsonResponse(0, '登录成功', {
      token,
      user: {
        id: user.id,
        account_no: user.account_no,
        nickname: user.nickname,
        role: user.role,
        is_active: user.is_active
      }
    });
  }
  
  if (path === '/api/auth/register' && method === 'POST') {
    const body = await request.json();
    const { account_no, password, nickname } = body;
    
    if (!account_no || !password) {
      return jsonResponse(400, '账号或密码不能为空');
    }
    
    const existing = await env.DB.prepare('SELECT id FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1')
      .bind(account_no).first();
    
    if (existing) {
      return jsonResponse(409, '该账号已被占用');
    }
    
    const hash = await generatePasswordHash(password);
    
    await env.DB.prepare('INSERT INTO users(account_no, password_hash, nickname, role, is_active) VALUES(?, ?, ?, 0, 1)')
      .bind(account_no, hash, nickname || '').run();
    
    const newUser = await env.DB.prepare('SELECT id FROM users WHERE account_no = ? LIMIT 1').bind(account_no).first();
    const userId = newUser.id;
    
    const SYSTEM_CATEGORIES = {
      '收入': ['房租', '网费', '取暖费', '房租押金', '门禁卡押金', '违约金', '其他'],
      '支出': ['网费', '招租费', '配件', '工人费', '保洁费', '水电', '维修', '其他']
    };
    
    for (const [type, names] of Object.entries(SYSTEM_CATEGORIES)) {
      for (let i = 0; i < names.length; i++) {
        await env.DB.prepare('INSERT OR IGNORE INTO categories(user_id, type, name, is_system, sort) VALUES(?, ?, ?, 1, ?)')
          .bind(userId, type, names[i], i).run();
      }
    }
    
    return jsonResponse(0, '注册成功', { account_no });
  }
  
  const token = getToken(request);
  if (!token && path !== '/api/auth/login' && path !== '/api/auth/register') {
    return jsonResponse(401, '未登录');
  }
  
  const decoded = token ? await verifyJwt(token, env) : null;
  if (!decoded && path !== '/api/auth/login' && path !== '/api/auth/register') {
    return jsonResponse(401, '登录已过期');
  }
  
  if (path === '/api/dashboard/summary' && method === 'GET') {
    const today = new Date().toISOString().split('T')[0];
    
    const incomeResult = await env.DB.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND trans_date >= ? AND deleted = 0')
      .bind(decoded.id, '收入', today).first();
    const expenseResult = await env.DB.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND trans_date >= ? AND deleted = 0')
      .bind(decoded.id, '支出', today).first();
    const txCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ? AND deleted = 0')
      .bind(decoded.id).first();
    const remCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM reminders WHERE user_id = ? AND status = ? AND deleted = 0')
      .bind(decoded.id, '未完成').first();
    
    return jsonResponse(0, 'ok', {
      today_income: parseFloat(incomeResult.total || 0),
      today_expense: parseFloat(expenseResult.total || 0),
      tx_count: parseInt(txCount.cnt || 0),
      pending_reminders: parseInt(remCount.cnt || 0)
    });
  }
  
  if (path === '/api/dashboard/recent' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '5');
    const recent = await env.DB.prepare(`
      SELECT id, type, category, amount, description, room_no, trans_date, created_at 
      FROM transactions WHERE user_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT ?
    `).bind(decoded.id, limit).all();
    
    return jsonResponse(0, 'ok', recent.results || []);
  }
  
  if (path === '/api/transactions' && method === 'GET') {
    const page = parseInt(url.searchParams.get('page') || '1');
    const page_size = parseInt(url.searchParams.get('page_size') || '20');
    const offset = (page - 1) * page_size;
    
    let query = `
      SELECT id, type, category, amount, description, room_no, trans_date, tag, created_at, updated_at 
      FROM transactions WHERE user_id = ? AND deleted = 0 ORDER BY trans_date DESC, id DESC LIMIT ? OFFSET ?
    `;
    let params = [decoded.id, page_size, offset];
    
    const type = url.searchParams.get('type');
    if (type) {
      query = `
        SELECT id, type, category, amount, description, room_no, trans_date, tag, created_at, updated_at 
        FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0 ORDER BY trans_date DESC, id DESC LIMIT ? OFFSET ?
      `;
      params = [decoded.id, type, page_size, offset];
    }
    
    const results = await env.DB.prepare(query).bind(...params).all();
    const countResult = await env.DB.prepare('SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ? AND deleted = 0')
      .bind(decoded.id).first();
    
    return jsonResponse(0, 'ok', {
      items: results.results || [],
      total: parseInt(countResult.cnt || 0),
      page,
      page_size
    });
  }
  
  if (path === '/api/transactions' && method === 'POST') {
    const body = await request.json();
    const { type, category, amount, description, room_no, trans_date, tag } = body;
    
    if (!type || !category || !amount || !trans_date) {
      return jsonResponse(400, '缺少必填字段');
    }
    
    await env.DB.prepare(`
      INSERT INTO transactions(user_id, type, category, amount, description, room_no, trans_date, tag)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(decoded.id, type, category, amount, description || '', room_no || '', trans_date, tag || '').run();
    
    return jsonResponse(0, '创建成功');
  }
  
  if (path.match(/^\/api\/transactions\/(\d+)$/) && method === 'PUT') {
    const txId = path.match(/^\/api\/transactions\/(\d+)$/)[1];
    const body = await request.json();
    
    const updateData = [];
    const params = [];
    if ('type' in body) { updateData.push('type = ?'); params.push(body.type); }
    if ('category' in body) { updateData.push('category = ?'); params.push(body.category); }
    if ('amount' in body) { updateData.push('amount = ?'); params.push(body.amount); }
    if ('description' in body) { updateData.push('description = ?'); params.push(body.description); }
    if ('room_no' in body) { updateData.push('room_no = ?'); params.push(body.room_no); }
    if ('trans_date' in body) { updateData.push('trans_date = ?'); params.push(body.trans_date); }
    if ('tag' in body) { updateData.push('tag = ?'); params.push(body.tag); }
    
    if (updateData.length === 0) {
      return jsonResponse(400, '没有需要更新的字段');
    }
    
    params.push(txId, decoded.id);
    await env.DB.prepare(`UPDATE transactions SET ${updateData.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
      .bind(...params).run();
    
    return jsonResponse(0, '更新成功');
  }
  
  if (path.match(/^\/api\/transactions\/(\d+)$/) && method === 'DELETE') {
    const txId = path.match(/^\/api\/transactions\/(\d+)$/)[1];
    await env.DB.prepare('UPDATE transactions SET deleted = 1 WHERE id = ? AND user_id = ?')
      .bind(txId, decoded.id).run();
    
    return jsonResponse(0, '删除成功');
  }
  
  if (path === '/api/transactions/categories' && method === 'GET') {
    const categories = await env.DB.prepare('SELECT id, type, name, is_system, sort FROM categories WHERE user_id = ? AND disabled = 0 ORDER BY type, sort, id')
      .bind(decoded.id).all();
    
    const grouped = { '收入': [], '支出': [] };
    for (const cat of categories.results || []) {
      if (grouped[cat.type]) {
        grouped[cat.type].push(cat);
      }
    }
    
    return jsonResponse(0, 'ok', grouped);
  }
  
  if (path === '/api/reminders' && method === 'GET') {
    let query = 'SELECT id, room_no, rent_amount, due_date, lease_end_date, status, remark, created_at, updated_at FROM reminders WHERE user_id = ? AND deleted = 0 ORDER BY status, created_at DESC';
    let params = [decoded.id];
    
    const status = url.searchParams.get('status');
    if (status) {
      query = 'SELECT id, room_no, rent_amount, due_date, lease_end_date, status, remark, created_at, updated_at FROM reminders WHERE user_id = ? AND status = ? AND deleted = 0 ORDER BY status, created_at DESC';
      params = [decoded.id, status];
    }
    
    const reminders = await env.DB.prepare(query).bind(...params).all();
    
    return jsonResponse(0, 'ok', reminders.results || []);
  }
  
  if (path === '/api/reminders' && method === 'POST') {
    const body = await request.json();
    const { room_no, rent_amount, due_date, lease_end_date, status, remark } = body;
    
    if (!room_no || !rent_amount || !due_date) {
      return jsonResponse(400, '缺少必填字段');
    }
    
    await env.DB.prepare(`
      INSERT INTO reminders(user_id, room_no, rent_amount, due_date, lease_end_date, status, remark)
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `).bind(decoded.id, room_no, rent_amount, due_date, lease_end_date || null, status || '未完成', remark || '').run();
    
    return jsonResponse(0, '创建成功');
  }
  
  if (path.match(/^\/api\/reminders\/(\d+)$/) && method === 'PUT') {
    const remId = path.match(/^\/api\/reminders\/(\d+)$/)[1];
    const body = await request.json();
    
    const updateData = [];
    const params = [];
    if ('room_no' in body) { updateData.push('room_no = ?'); params.push(body.room_no); }
    if ('rent_amount' in body) { updateData.push('rent_amount = ?'); params.push(body.rent_amount); }
    if ('due_date' in body) { updateData.push('due_date = ?'); params.push(body.due_date); }
    if ('lease_end_date' in body) { updateData.push('lease_end_date = ?'); params.push(body.lease_end_date || null); }
    if ('status' in body) { updateData.push('status = ?'); params.push(body.status); }
    if ('remark' in body) { updateData.push('remark = ?'); params.push(body.remark); }
    
    if (updateData.length === 0) {
      return jsonResponse(400, '没有需要更新的字段');
    }
    
    params.push(remId, decoded.id);
    await env.DB.prepare(`UPDATE reminders SET ${updateData.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
      .bind(...params).run();
    
    return jsonResponse(0, '更新成功');
  }
  
  if (path.match(/^\/api\/reminders\/(\d+)$/) && method === 'DELETE') {
    const remId = path.match(/^\/api\/reminders\/(\d+)$/)[1];
    await env.DB.prepare('UPDATE reminders SET deleted = 1 WHERE id = ? AND user_id = ?')
      .bind(remId, decoded.id).run();
    
    return jsonResponse(0, '删除成功');
  }
  
  if (path === '/api/stats/summary' && method === 'GET') {
    const incomeResult = await env.DB.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0')
      .bind(decoded.id, '收入').first();
    const expenseResult = await env.DB.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0')
      .bind(decoded.id, '支出').first();
    
    return jsonResponse(0, 'ok', {
      total_income: parseFloat(incomeResult.total || 0),
      total_expense: parseFloat(expenseResult.total || 0),
      balance: parseFloat((incomeResult.total || 0) - (expenseResult.total || 0))
    });
  }
  
  if (path === '/api/stats/trend' && method === 'GET') {
    const trend = await env.DB.prepare(`
      SELECT strftime('%Y-%m', trans_date) as month, type, COALESCE(SUM(amount), 0) as total 
      FROM transactions WHERE user_id = ? AND deleted = 0 
      AND trans_date >= date('now', '-11 months', 'start of month')
      GROUP BY strftime('%Y-%m', trans_date), type ORDER BY month ASC
    `).bind(decoded.id).all();
    
    const result = {};
    for (const row of trend.results || []) {
      const date = row.month;
      if (!result[date]) result[date] = { income: 0, expense: 0 };
      if (row.type === '收入') result[date].income = parseFloat(row.total || 0);
      if (row.type === '支出') result[date].expense = parseFloat(row.total || 0);
    }
    
    return jsonResponse(0, 'ok', result);
  }
  
  if (path === '/api/auth/me' && method === 'GET') {
    const user = await env.DB.prepare('SELECT id, account_no, nickname, role, is_active, created_at, last_login_at FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1')
      .bind(decoded.id).first();
    
    if (!user) {
      return jsonResponse(401, '用户不存在');
    }
    
    return jsonResponse(0, 'ok', user);
  }
  
  if (path === '/api/auth/change-password' && method === 'POST') {
    const body = await request.json();
    const { old_password, new_password } = body;
    
    const user = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1')
      .bind(decoded.id).first();
    
    if (!user) {
      return jsonResponse(401, '用户不存在');
    }
    
    const isValid = await verifyPassword(old_password, user.password_hash);
    if (!isValid) {
      return jsonResponse(400, '旧密码错误');
    }
    
    const newHash = await generatePasswordHash(new_password);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, decoded.id).run();
    
    return jsonResponse(0, '密码修改成功');
  }
  
  if (path === '/api/auth/profile' && method === 'PUT') {
    const body = await request.json();
    const { nickname, phone } = body;
    
    const updateData = [];
    const params = [];
    if ('nickname' in body) { updateData.push('nickname = ?'); params.push(nickname); }
    if ('phone' in body) { updateData.push('phone = ?'); params.push(phone); }
    
    if (updateData.length === 0) {
      return jsonResponse(400, '没有需要更新的字段');
    }
    
    params.push(decoded.id);
    await env.DB.prepare(`UPDATE users SET ${updateData.join(', ')} WHERE id = ?`).bind(...params).run();
    
    return jsonResponse(0, '更新成功');
  }
  
  if (path === '/api/auth/delete-account' && method === 'POST') {
    const body = await request.json();
    const { password } = body;
    
    const user = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1')
      .bind(decoded.id).first();
    
    if (!user) {
      return jsonResponse(401, '用户不存在');
    }
    
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return jsonResponse(400, '密码错误');
    }
    
    await env.DB.prepare('DELETE FROM transactions WHERE user_id = ?').bind(decoded.id).run();
    await env.DB.prepare('DELETE FROM reminders WHERE user_id = ?').bind(decoded.id).run();
    await env.DB.prepare('DELETE FROM categories WHERE user_id = ?').bind(decoded.id).run();
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(decoded.id).run();
    
    return jsonResponse(0, '账号已删除');
  }
  
  return jsonResponse(404, 'API 不存在');
}

async function initDb(env) {
  const DB_SCHEMA = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_no CHAR(6) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMP,
      is_deleted BOOLEAN NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      last_failed_at TIMESTAMP,
      locked_until TIMESTAMP,
      nickname VARCHAR(32) NOT NULL DEFAULT '',
      phone VARCHAR(20) NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT 1,
      role INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type CHAR(4) NOT NULL,
      name VARCHAR(20) NOT NULL,
      is_system BOOLEAN NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      disabled BOOLEAN NOT NULL DEFAULT 0,
      UNIQUE(user_id, type, name)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type CHAR(4) NOT NULL,
      category VARCHAR(20) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      description VARCHAR(200) NOT NULL DEFAULT '',
      room_no VARCHAR(20) NOT NULL DEFAULT '',
      trans_date DATE NOT NULL,
      tag VARCHAR(50) NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted BOOLEAN NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      room_no VARCHAR(20) NOT NULL,
      rent_amount DECIMAL(12,2) NOT NULL,
      due_date DATE NOT NULL,
      lease_end_date DATE,
      status VARCHAR(10) NOT NULL DEFAULT '未完成',
      remark VARCHAR(200) NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted BOOLEAN NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title VARCHAR(80) NOT NULL,
      content TEXT NOT NULL,
      banner_level VARCHAR(10) NOT NULL DEFAULT 'info',
      priority INTEGER NOT NULL DEFAULT 0,
      is_pinned BOOLEAN NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT 1,
      effective_at TIMESTAMP,
      expire_at TIMESTAMP,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_deleted BOOLEAN NOT NULL DEFAULT 0
    );
  `;
  
  const db = env.DB;
  const statements = DB_SCHEMA.split(';').filter(s => s.trim());
  
  for (const stmt of statements) {
    await db.prepare(stmt.trim()).run();
  }
  
  await ensureAdminUser(env);
}

async function ensureAdminUser(env) {
  const db = env.DB;
  const result = await db.prepare('SELECT id FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1').bind('100000').first();
  
  if (result) return;
  
  const pwdHash = await generatePasswordHash('123456');
  await db.prepare(`
    INSERT INTO users(account_no, password_hash, role, nickname, is_active) 
    VALUES(?, ?, 1, '超级管理员', 1)
  `).bind('100000', pwdHash).run();
  
  const admin = await db.prepare('SELECT id FROM users WHERE account_no = ? LIMIT 1').bind('100000').first();
  const adminId = admin.id;
  
  const SYSTEM_CATEGORIES = {
    '收入': ['房租', '网费', '取暖费', '房租押金', '门禁卡押金', '违约金', '其他'],
    '支出': ['网费', '招租费', '配件', '工人费', '保洁费', '水电', '维修', '其他']
  };
  
  for (const [type, names] of Object.entries(SYSTEM_CATEGORIES)) {
    for (let i = 0; i < names.length; i++) {
      await db.prepare(`
        INSERT OR IGNORE INTO categories(user_id, type, name, is_system, sort)
        VALUES(?, ?, ?, 1, ?)
      `).bind(adminId, type, names[i], i).run();
    }
  }
}

function jsonResponse(code, msg, data = null) {
  return new Response(JSON.stringify({ code, msg, data }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function getToken(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

async function generateJwt(payload, env) {
  const secret = env.JWT_SECRET || 'jizhang-system-secret-key-2024';
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadStr = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }));
  const signature = await HMACSHA256(`${header}.${payloadStr}`, secret);
  return `${header}.${payloadStr}.${btoa(signature)}`;
}

async function verifyJwt(token, env) {
  try {
    const secret = env.JWT_SECRET || 'jizhang-system-secret-key-2024';
    const [header, payloadStr, signature] = token.split('.');
    
    const expectedSignature = await HMACSHA256(`${header}.${payloadStr}`, secret);
    if (signature !== btoa(expectedSignature)) {
      return null;
    }
    
    const payload = JSON.parse(atob(payloadStr));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    
    return payload;
  } catch {
    return null;
  }
}

async function HMACSHA256(message, secret) {
  const encoder = new TextEncoder();
  const key = encoder.encode(secret);
  const data = encoder.encode(message);
  
  const signature = await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data);
  const bytes = new Uint8Array(signature);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

function generateCaptcha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  const captcha_id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const width = 120;
  const height = 40;
  
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#f5f5f5"/>`;
  
  for (let i = 0; i < 4; i++) {
    const x = 10 + i * 25;
    const y = 28;
    const char = code.charAt(i);
    const fontSize = 24 + Math.random() * 4;
    const rotate = (Math.random() - 0.5) * 30;
    const color = `rgb(${100 + Math.random() * 100}, ${100 + Math.random() * 100}, ${100 + Math.random() * 100})`;
    
    svg += `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="Arial, sans-serif" fill="${color}" transform="rotate(${rotate}, ${x}, ${y})" style="font-weight:bold">${char}</text>`;
  }
  
  for (let i = 0; i < 4; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const x2 = Math.random() * width;
    const y2 = Math.random() * height;
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#d0d0d0" stroke-width="1"/>`;
  }
  
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = Math.random() * 1.5;
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="#d0d0d0"/>`;
  }
  
  svg += '</svg>';
  
  return { captcha_id, code, svg };
}

async function generatePasswordHash(password) {
  const saltRounds = 10;
  const salt = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(Math.random().toString()));
  const saltStr = Array.from(new Uint8Array(salt)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 22);
  
  const data = new TextEncoder().encode(password + saltStr);
  let hash = await crypto.subtle.digest('SHA-256', data);
  for (let i = 0; i < saltRounds; i++) {
    hash = await crypto.subtle.digest('SHA-256', new Uint8Array([...new Uint8Array(hash), ...data]));
  }
  
  const hashStr = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `$2b$${saltRounds}$${saltStr}${hashStr}`;
}

async function verifyPassword(password, hash) {
  const parts = hash.split('$');
  if (parts.length !== 4) return false;
  
  const saltRounds = parseInt(parts[2]);
  const saltStr = parts[3].substring(0, 22);
  
  const data = new TextEncoder().encode(password + saltStr);
  let computedHash = await crypto.subtle.digest('SHA-256', data);
  for (let i = 0; i < saltRounds; i++) {
    computedHash = await crypto.subtle.digest('SHA-256', new Uint8Array([...new Uint8Array(computedHash), ...data]));
  }
  
  const computedHashStr = Array.from(new Uint8Array(computedHash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hash === `$2b$${saltRounds}$${saltStr}${computedHashStr}`;
}