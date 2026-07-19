export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  
  if (path.startsWith('/api/')) {
    return handleApiRequest(request, env, path);
  }
  
  return null;
}

async function handleApiRequest(request, env, path) {
  const method = request.method;
  
  if (path === '/api/system/health') {
    return jsonResponse(0, 'ok', { status: 'running' });
  }
  
  if (path === '/api/auth/captcha' && method === 'GET') {
    try {
      const { captcha_id, code, svg } = generateCaptcha();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await supabaseRequest('POST', '/rest/v1/captchas', { captcha_id, code, expires_at: expiresAt }, env);
      return new Response(JSON.stringify({ code: 0, msg: 'ok', data: { captcha_id, image: svg, ttl: 300, length: 4 } }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    } catch (error) {
      console.error('Captcha error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/auth/login' && method === 'POST') {
    try {
      const body = await request.json();
      const { account_no, password, captcha_id, captcha_code } = body;
      
      if (!account_no || !password) {
        return jsonResponse(400, '账号或密码不能为空');
      }
      
      const captchaResponse = await supabaseRequest('GET', `/rest/v1/captchas?captcha_id=eq.${captcha_id}&expires_at=gte.${new Date().toISOString()}`, null, env);
      const captchas = captchaResponse.results || [];
      
      if (captchas.length === 0) {
        return jsonResponse(400, '验证码已过期，请刷新重试');
      }
      
      const captcha = captchas[0];
      if (captcha.code.toLowerCase() !== captcha_code.toLowerCase()) {
        await supabaseRequest('DELETE', `/rest/v1/captchas?captcha_id=eq.${captcha_id}`, null, env);
        return jsonResponse(400, '验证码错误');
      }
      
      await supabaseRequest('DELETE', `/rest/v1/captchas?captcha_id=eq.${captcha_id}`, null, env);
      
      const userResponse = await supabaseRequest('GET', `/rest/v1/users?account_no=eq.${account_no}`, null, env);
      const users = userResponse.results || [];
      
      if (users.length === 0) {
        return jsonResponse(401, '账号或密码错误');
      }
      
      const user = users[0];
      const isValid = await verifyPassword(password, user.password_hash);
      
      if (!isValid) {
        return jsonResponse(401, '账号或密码错误');
      }
      
      if (user.is_active === 0) {
        return jsonResponse(403, '账号已被禁用');
      }
      
      await supabaseRequest('PATCH', `/rest/v1/users?id=eq.${user.id}`, { last_login_at: new Date().toISOString() }, env);
      
      const token = generateJwt({ id: user.id, account_no: user.account_no, role: user.role }, env);
      
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
  
  if (path === '/api/auth/register' && method === 'POST') {
    try {
      const body = await request.json();
      const { account_no, password, nickname } = body;
      
      if (!account_no || !password) {
        return jsonResponse(400, '账号或密码不能为空');
      }
      
      const existingResponse = await supabaseRequest('GET', `/rest/v1/users?account_no=eq.${account_no}`, null, env);
      if (existingResponse.results && existingResponse.results.length > 0) {
        return jsonResponse(409, '该账号已被占用');
      }
      
      const hash = await hashPassword(password);
      
      await supabaseRequest('POST', '/rest/v1/users', {
        account_no,
        password_hash: hash,
        nickname: nickname || '',
        role: 0,
        is_active: true,
        created_at: new Date().toISOString()
      }, env);
      
      return jsonResponse(0, '注册成功', { account_no });
    } catch (error) {
      console.error('Register error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  const token = getToken(request);
  if (!token && path !== '/api/auth/login' && path !== '/api/auth/register' && path !== '/api/system/health') {
    return jsonResponse(401, '未登录');
  }
  
  const decoded = token ? verifyJwt(token, env) : null;
  if (!decoded && path !== '/api/auth/login' && path !== '/api/auth/register' && path !== '/api/system/health') {
    return jsonResponse(401, '登录已过期');
  }
  
  if (path === '/api/dashboard/summary' && method === 'GET') {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const incomeResult = await supabaseRequest('GET', `/rest/v1/transactions?user_id=eq.${decoded.id}&type=eq.收入&trans_date=gte.${today}&select=sum(amount)`, null, env);
      const expenseResult = await supabaseRequest('GET', `/rest/v1/transactions?user_id=eq.${decoded.id}&type=eq.支出&trans_date=gte.${today}&select=sum(amount)`, null, env);
      const txCount = await supabaseRequest('GET', `/rest/v1/transactions?user_id=eq.${decoded.id}&select=count(*)`, null, env);
      const remCount = await supabaseRequest('GET', `/rest/v1/reminders?user_id=eq.${decoded.id}&status=eq.未完成&select=count(*)`, null, env);
      
      return jsonResponse(0, 'ok', {
        today_income: parseFloat(incomeResult.results?.[0]?.sum || 0),
        today_expense: parseFloat(expenseResult.results?.[0]?.sum || 0),
        tx_count: parseInt(txCount.results?.[0]?.count || 0),
        pending_reminders: parseInt(remCount.results?.[0]?.count || 0)
      });
    } catch (error) {
      console.error('Summary error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/dashboard/recent' && method === 'GET') {
    try {
      const limit = parseInt(url.searchParams.get('limit') || '5');
      const recent = await supabaseRequest('GET', `/rest/v1/transactions?user_id=eq.${decoded.id}&select=id,type,category,amount,description,room_no,trans_date,created_at&order=created_at.desc&limit=${limit}`, null, env);
      
      return jsonResponse(0, 'ok', recent.results || []);
    } catch (error) {
      console.error('Recent error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/transactions' && method === 'GET') {
    try {
      const page = parseInt(url.searchParams.get('page') || '1');
      const page_size = parseInt(url.searchParams.get('page_size') || '20');
      const offset = (page - 1) * page_size;
      
      let query = `/rest/v1/transactions?user_id=eq.${decoded.id}&select=id,type,category,amount,description,room_no,trans_date,tag,created_at,updated_at&order=trans_date.desc,id.desc&limit=${page_size}&offset=${offset}`;
      
      const type = url.searchParams.get('type');
      if (type) query += `&type=eq.${type}`;
      
      const results = await supabaseRequest('GET', query, null, env);
      const countResult = await supabaseRequest('GET', `/rest/v1/transactions?user_id=eq.${decoded.id}&select=count(*)`, null, env);
      
      return jsonResponse(0, 'ok', {
        items: results.results || [],
        total: parseInt(countResult.results?.[0]?.count || 0),
        page,
        page_size
      });
    } catch (error) {
      console.error('Transactions error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/transactions' && method === 'POST') {
    try {
      const body = await request.json();
      const { type, category, amount, description, room_no, trans_date, tag } = body;
      
      if (!type || !category || !amount || !trans_date) {
        return jsonResponse(400, '缺少必填字段');
      }
      
      await supabaseRequest('POST', '/rest/v1/transactions', {
        user_id: decoded.id,
        type,
        category,
        amount,
        description: description || '',
        room_no: room_no || '',
        trans_date,
        tag: tag || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, env);
      
      return jsonResponse(0, '创建成功');
    } catch (error) {
      console.error('Create transaction error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path.match(/^\/api\/transactions\/(\d+)$/) && method === 'PUT') {
    try {
      const txId = path.match(/^\/api\/transactions\/(\d+)$/)[1];
      const body = await request.json();
      
      const updateData = { updated_at: new Date().toISOString() };
      if ('type' in body) updateData.type = body.type;
      if ('category' in body) updateData.category = body.category;
      if ('amount' in body) updateData.amount = body.amount;
      if ('description' in body) updateData.description = body.description;
      if ('room_no' in body) updateData.room_no = body.room_no;
      if ('trans_date' in body) updateData.trans_date = body.trans_date;
      if ('tag' in body) updateData.tag = body.tag;
      
      await supabaseRequest('PATCH', `/rest/v1/transactions?id=eq.${txId}&user_id=eq.${decoded.id}`, updateData, env);

      return jsonResponse(0, '更新成功');
    } catch (error) {
      console.error('Update transaction error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path.match(/^\/api\/transactions\/(\d+)$/) && method === 'DELETE') {
    try {
      const txId = path.match(/^\/api\/transactions\/(\d+)$/)[1];
      await supabaseRequest('DELETE', `/rest/v1/transactions?id=eq.${txId}&user_id=eq.${decoded.id}`, null, env);
      
      return jsonResponse(0, '删除成功');
    } catch (error) {
      console.error('Delete transaction error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/transactions/categories' && method === 'GET') {
    try {
      const categories = await supabaseRequest('GET', `/rest/v1/categories?user_id=eq.${decoded.id}&disabled=eq.false&select=id,type,name,is_system,sort&order=type,sort,id`, null, env);
      
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
    try {
      let query = `/rest/v1/reminders?user_id=eq.${decoded.id}&select=id,room_no,rent_amount,due_date,lease_end_date,status,remark,created_at,updated_at&order=status,created_at.desc`;
      
      const status = url.searchParams.get('status');
      if (status) query += `&status=eq.${status}`;
      
      const reminders = await supabaseRequest('GET', query, null, env);
      
      return jsonResponse(0, 'ok', reminders.results || []);
    } catch (error) {
      console.error('Reminders error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/reminders' && method === 'POST') {
    try {
      const body = await request.json();
      const { room_no, rent_amount, due_date, lease_end_date, status, remark } = body;
      
      if (!room_no || !rent_amount || !due_date) {
        return jsonResponse(400, '缺少必填字段');
      }
      
      await supabaseRequest('POST', '/rest/v1/reminders', {
        user_id: decoded.id,
        room_no,
        rent_amount,
        due_date,
        lease_end_date: lease_end_date || null,
        status: status || '未完成',
        remark: remark || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, env);
      
      return jsonResponse(0, '创建成功');
    } catch (error) {
      console.error('Create reminder error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path.match(/^\/api\/reminders\/(\d+)$/) && method === 'PUT') {
    try {
      const remId = path.match(/^\/api\/reminders\/(\d+)$/)[1];
      const body = await request.json();
      
      const updateData = { updated_at: new Date().toISOString() };
      if ('room_no' in body) updateData.room_no = body.room_no;
      if ('rent_amount' in body) updateData.rent_amount = body.rent_amount;
      if ('due_date' in body) updateData.due_date = body.due_date;
      if ('lease_end_date' in body) updateData.lease_end_date = body.lease_end_date;
      if ('status' in body) updateData.status = body.status;
      if ('remark' in body) updateData.remark = body.remark;
      
      await supabaseRequest('PATCH', `/rest/v1/reminders?id=eq.${remId}&user_id=eq.${decoded.id}`, updateData, env);

      return jsonResponse(0, '更新成功');
    } catch (error) {
      console.error('Update reminder error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path.match(/^\/api\/reminders\/(\d+)$/) && method === 'DELETE') {
    try {
      const remId = path.match(/^\/api\/reminders\/(\d+)$/)[1];
      await supabaseRequest('DELETE', `/rest/v1/reminders?id=eq.${remId}&user_id=eq.${decoded.id}`, null, env);
      
      return jsonResponse(0, '删除成功');
    } catch (error) {
      console.error('Delete reminder error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/stats/summary' && method === 'GET') {
    try {
      const incomeResult = await supabaseRequest('GET', `/rest/v1/transactions?user_id=eq.${decoded.id}&type=eq.收入&select=sum(amount)`, null, env);
      const expenseResult = await supabaseRequest('GET', `/rest/v1/transactions?user_id=eq.${decoded.id}&type=eq.支出&select=sum(amount)`, null, env);
      
      return jsonResponse(0, 'ok', {
        total_income: parseFloat(incomeResult.results?.[0]?.sum || 0),
        total_expense: parseFloat(expenseResult.results?.[0]?.sum || 0),
        balance: parseFloat((incomeResult.results?.[0]?.sum || 0) - (expenseResult.results?.[0]?.sum || 0))
      });
    } catch (error) {
      console.error('Stats summary error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/stats/trend' && method === 'GET') {
    try {
      const trend = await supabaseRequest('GET', `/rest/v1/transactions?user_id=eq.${decoded.id}&select=trans_date,type,sum(amount)&group=trans_date,type&order=trans_date.asc`, null, env);
      
      const result = {};
      for (const row of trend.results || []) {
        const date = row.trans_date;
        if (!result[date]) result[date] = { income: 0, expense: 0 };
        if (row.type === '收入') result[date].income = parseFloat(row.sum || 0);
        if (row.type === '支出') result[date].expense = parseFloat(row.sum || 0);
      }
      
      return jsonResponse(0, 'ok', result);
    } catch (error) {
      console.error('Stats trend error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  if (path === '/api/auth/me' && method === 'GET') {
    try {
      const user = await supabaseRequest('GET', `/rest/v1/users?id=eq.${decoded.id}&select=id,account_no,nickname,role,is_active,created_at,last_login_at`, null, env);
      
      if (!user.results || user.results.length === 0) {
        return jsonResponse(401, '用户不存在');
      }
      
      return jsonResponse(0, 'ok', user.results[0]);
    } catch (error) {
      console.error('Auth me error:', error);
      return jsonResponse(500, '服务器内部错误');
    }
  }
  
  return jsonResponse(404, 'API 不存在');
}

async function supabaseRequest(method, path, body = null, env) {
  const supabaseUrl = env.SUPABASE_URL || '';
  const supabaseKey = env.SUPABASE_KEY || '';
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase environment variables not configured');
  }
  
  const url = `${supabaseUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`
  };
  
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  
  const response = await fetch(url, options);
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Supabase API error: ${response.status} - ${JSON.stringify(error)}`);
  }
  
  return response.json();
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

function generateJwt(payload, env) {
  const secret = env.JWT_SECRET || 'jizhang-system-secret-key-2024';
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadStr = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }));
  const signature = btoa(HMACSHA256(`${header}.${payloadStr}`, secret));
  return `${header}.${payloadStr}.${signature}`;
}

function verifyJwt(token, env) {
  try {
    const secret = env.JWT_SECRET || 'jizhang-system-secret-key-2024';
    const [header, payloadStr, signature] = token.split('.');
    const expectedSignature = btoa(HMACSHA256(`${header}.${payloadStr}`, secret));
    
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

async function hashPassword(password) {
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