export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  
  if (path.startsWith('/api/')) {
    return handleApiRequest(request, env, path);
  }
  
  return handleStaticRequest(request, path);
}

async function handleApiRequest(request, env, path) {
  const method = request.method;
  
  if (path === '/api/system/health') {
    return jsonResponse(0, 'ok', { status: 'running' });
  }
  
  if (path === '/api/auth/login' && method === 'POST') {
    try {
      const body = await request.json();
      const { account_no, password } = body;
      
      if (!account_no || !password) {
        return jsonResponse(400, '账号或密码不能为空');
      }
      
      const existing = await env.DB.prepare('SELECT id FROM users WHERE account_no = ?').bind(account_no).first();
      
      if (!existing) {
        const hash = await bcryptHash(password);
        await env.DB.prepare(`
          INSERT INTO users (account_no, password_hash, nickname, role, is_active)
          VALUES (?, ?, '用户', 0, 1)
        `).bind(account_no, hash).run();
        
        await seedCategories(env.DB, account_no);
      }
      
      const user = await env.DB.prepare('SELECT * FROM users WHERE account_no = ?').bind(account_no).first();
      const storedHash = user.password_hash;
      
      const isValid = await bcryptCompare(password, storedHash);
      if (!isValid) {
        return jsonResponse(401, '账号或密码错误');
      }
      
      if (user.is_active === 0) {
        return jsonResponse(403, '账号已被禁用');
      }
      
      await env.DB.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run();
      
      const token = generateJwt({ id: user.id, account_no: user.account_no, role: user.role });
      
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
    } catch (error) {
      console.error('Login error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/dashboard/summary' && method === 'GET') {
    const token = getToken(request);
    if (!token) return jsonResponse(401, '未登录');
    
    const decoded = verifyJwt(token);
    if (!decoded) return jsonResponse(401, '登录已过期');
    
    try {
      const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(decoded.id).first();
      if (!user) return jsonResponse(401, '用户不存在');
      
      const today = new Date().toISOString().split('T')[0];
      
      const incomeResult = await env.DB.prepare(`
        SELECT SUM(amount) as total FROM transactions 
        WHERE user_id = ? AND type = '收入' AND tx_date >= ?
      `).bind(user.id, today).first();
      
      const expenseResult = await env.DB.prepare(`
        SELECT SUM(amount) as total FROM transactions 
        WHERE user_id = ? AND type = '支出' AND tx_date >= ?
      `).bind(user.id, today).first();
      
      const txCount = await env.DB.prepare(`
        SELECT COUNT(*) as count FROM transactions WHERE user_id = ?
      `).bind(user.id).first();
      
      const remCount = await env.DB.prepare(`
        SELECT COUNT(*) as count FROM reminders WHERE user_id = ? AND status = 'pending'
      `).bind(user.id).first();
      
      return jsonResponse(0, 'ok', {
        today_income: parseFloat(incomeResult.total || 0),
        today_expense: parseFloat(expenseResult.total || 0),
        tx_count: parseInt(txCount.count || 0),
        pending_reminders: parseInt(remCount.count || 0)
      });
    } catch (error) {
      console.error('Summary error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/dashboard/recent' && method === 'GET') {
    const token = getToken(request);
    if (!token) return jsonResponse(401, '未登录');
    
    const decoded = verifyJwt(token);
    if (!decoded) return jsonResponse(401, '登录已过期');
    
    try {
      const limit = parseInt(url.searchParams.get('limit') || '5');
      const recent = await env.DB.prepare(`
        SELECT id, type, category, amount, description, room, tx_date, created_at 
        FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
      `).bind(decoded.id, limit).all();
      
      return jsonResponse(0, 'ok', recent.results || []);
    } catch (error) {
      console.error('Recent error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/transactions' && method === 'GET') {
    const token = getToken(request);
    if (!token) return jsonResponse(401, '未登录');
    
    const decoded = verifyJwt(token);
    if (!decoded) return jsonResponse(401, '登录已过期');
    
    try {
      const page = parseInt(url.searchParams.get('page') || '1');
      const page_size = parseInt(url.searchParams.get('page_size') || '20');
      const offset = (page - 1) * page_size;
      
      const results = await env.DB.prepare(`
        SELECT id, type, category, amount, description, room, tx_date, created_at 
        FROM transactions WHERE user_id = ? ORDER BY tx_date DESC, created_at DESC LIMIT ? OFFSET ?
      `).bind(decoded.id, page_size, offset).all();
      
      const countResult = await env.DB.prepare(`
        SELECT COUNT(*) as count FROM transactions WHERE user_id = ?
      `).bind(decoded.id).first();
      
      return jsonResponse(0, 'ok', {
        items: results.results || [],
        total: parseInt(countResult.count || 0),
        page,
        page_size
      });
    } catch (error) {
      console.error('Transactions error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/transactions' && method === 'POST') {
    const token = getToken(request);
    if (!token) return jsonResponse(401, '未登录');
    
    const decoded = verifyJwt(token);
    if (!decoded) return jsonResponse(401, '登录已过期');
    
    try {
      const body = await request.json();
      const { type, category, amount, description, room, tx_date } = body;
      
      if (!type || !category || !amount || !tx_date) {
        return jsonResponse(400, '缺少必填字段');
      }
      
      await env.DB.prepare(`
        INSERT INTO transactions (user_id, type, category, amount, description, room, tx_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(decoded.id, type, category, amount, description || '', room || '', tx_date).run();
      
      return jsonResponse(0, '创建成功');
    } catch (error) {
      console.error('Create transaction error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/transactions/categories' && method === 'GET') {
    const token = getToken(request);
    if (!token) return jsonResponse(401, '未登录');
    
    const decoded = verifyJwt(token);
    if (!decoded) return jsonResponse(401, '登录已过期');
    
    try {
      const categories = await env.DB.prepare(`
        SELECT id, type, name, sort_order FROM categories WHERE user_id = ? AND is_deleted = 0
      `).bind(decoded.id).all();
      
      const grouped = { 收入: [], 支出: [] };
      for (const cat of categories.results || []) {
        if (grouped[cat.type]) {
          grouped[cat.type].push(cat);
        }
      }
      
      return jsonResponse(0, 'ok', grouped);
    } catch (error) {
      console.error('Categories error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/reminders' && method === 'GET') {
    const token = getToken(request);
    if (!token) return jsonResponse(401, '未登录');
    
    const decoded = verifyJwt(token);
    if (!decoded) return jsonResponse(401, '登录已过期');
    
    try {
      const reminders = await env.DB.prepare(`
        SELECT id, tenant_name, room, amount, due_day, last_paid_date, status, remark, created_at 
        FROM reminders WHERE user_id = ? ORDER BY created_at DESC
      `).bind(decoded.id).all();
      
      return jsonResponse(0, 'ok', reminders.results || []);
    } catch (error) {
      console.error('Reminders error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/reminders' && method === 'POST') {
    const token = getToken(request);
    if (!token) return jsonResponse(401, '未登录');
    
    const decoded = verifyJwt(token);
    if (!decoded) return jsonResponse(401, '登录已过期');
    
    try {
      const body = await request.json();
      const { tenant_name, room, amount, due_day, remark } = body;
      
      if (!tenant_name || !amount) {
        return jsonResponse(400, '缺少必填字段');
      }
      
      await env.DB.prepare(`
        INSERT INTO reminders (user_id, tenant_name, room, amount, due_day, remark)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(decoded.id, tenant_name, room || '', amount, due_day || 1, remark || '').run();
      
      return jsonResponse(0, '创建成功');
    } catch (error) {
      console.error('Create reminder error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/stats/summary' && method === 'GET') {
    const token = getToken(request);
    if (!token) return jsonResponse(401, '未登录');
    
    const decoded = verifyJwt(token);
    if (!decoded) return jsonResponse(401, '登录已过期');
    
    try {
      const incomeResult = await env.DB.prepare(`
        SELECT SUM(amount) as total FROM transactions WHERE user_id = ? AND type = '收入'
      `).bind(decoded.id).first();
      
      const expenseResult = await env.DB.prepare(`
        SELECT SUM(amount) as total FROM transactions WHERE user_id = ? AND type = '支出'
      `).bind(decoded.id).first();
      
      return jsonResponse(0, 'ok', {
        total_income: parseFloat(incomeResult.total || 0),
        total_expense: parseFloat(expenseResult.total || 0),
        balance: parseFloat((incomeResult.total || 0) - (expenseResult.total || 0))
      });
    } catch (error) {
      console.error('Stats summary error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  return jsonResponse(404, 'API 不存在');
}

async function handleStaticRequest(request, path) {
  const filePath = path === '/' ? '/index.html' : path;
  
  try {
    const file = await fetch(`file:///workspace/frontend${filePath}`);
    return file;
  } catch {
    return new Response('Not found', { status: 404 });
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

function generateJwt(payload) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadStr = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }));
  const signature = btoa(HMACSHA256(`${header}.${payloadStr}`, 'jizhang-system-secret-key-2024'));
  return `${header}.${payloadStr}.${signature}`;
}

function verifyJwt(token) {
  try {
    const [header, payloadStr, signature] = token.split('.');
    const expectedSignature = btoa(HMACSHA256(`${header}.${payloadStr}`, 'jizhang-system-secret-key-2024'));
    
    if (signature !== expectedSignature) {
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

function HMACSHA256(message, secret) {
  const encoder = new TextEncoder();
  const key = encoder.encode(secret);
  const data = encoder.encode(message);
  
  return crypto.subtle.sign('HMAC', crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data)
    .then(signature => {
      const bytes = new Uint8Array(signature);
      let result = '';
      for (let i = 0; i < bytes.length; i++) {
        result += String.fromCharCode(bytes[i]);
      }
      return result;
    });
}

async function bcryptHash(password) {
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

async function bcryptCompare(password, hash) {
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

async function seedCategories(db, account_no) {
  const user = await db.prepare('SELECT id FROM users WHERE account_no = ?').bind(account_no).first();
  if (!user) return;
  
  const categories = [
    ['收入', '房租'], ['收入', '工资'], ['收入', '奖金'], ['收入', '投资收益'], ['收入', '其他收入'],
    ['支出', '招租费'], ['支出', '水电费'], ['支出', '物业费'], ['支出', '维修费'], ['支出', '其他支出']
  ];
  
  for (let i = 0; i < categories.length; i++) {
    const [type, name] = categories[i];
    await db.prepare(`
      INSERT INTO categories (user_id, type, name, sort_order)
      VALUES (?, ?, ?, ?)
    `).bind(user.id, type, name, i).run();
  }
}