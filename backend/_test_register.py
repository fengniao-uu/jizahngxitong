import urllib.request, urllib.error, json, sys
BASE = 'http://127.0.0.1:5000'
def post(path, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(BASE + path, data=data, headers={'Content-Type':'application/json'})
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        return resp.getcode(), json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode('utf-8'))

# --- 测试1：全新账号注册 ---
c, r = post('/api/auth/register', {'account_no':'222001','password':'654321','nickname':'完整链路测试'})
print('TEST1 REGISTER NEW -> HTTP=%d code=%s msg=%s user_id=%s' % (c, r.get('code'), r.get('msg'), (r.get('data') or {}).get('user_id')))

# --- 测试2：重复注册 ---
c, r = post('/api/auth/register', {'account_no':'222001','password':'654321','nickname':'x'})
print('TEST2 REGISTER DUP -> HTTP=%d code=%s msg=%s' % (c, r.get('code'), r.get('msg')))

# --- 测试3：格式错误 ---
c, r = post('/api/auth/register', {'account_no':'12','password':'abc','nickname':''})
print('TEST3 REGISTER BAD -> HTTP=%d code=%s msg=%s' % (c, r.get('code'), r.get('msg')))

# --- 测试4：注册的新账号登录（DISABLE_CAPTCHA=1 已开） ---
c, r = post('/api/auth/login', {'account_no':'222001','password':'654321','captcha_id':'ignored','captcha_code':'ignored'})
print('TEST4 LOGIN NEW   -> HTTP=%d code=%s msg=%s token_1st30=%s' % (c, r.get('code'), r.get('msg'), ((r.get('data') or {}).get('token') or '')[:30]))
token = ((r.get('data') or {}).get('token') or '') if c == 200 and r.get('code') == 0 else ''

# --- 测试5：携带 JWT 调 /api/auth/me ---
if token:
    try:
        req = urllib.request.Request(BASE + '/api/auth/me', headers={'Authorization':'Bearer '+token})
        resp = urllib.request.urlopen(req, timeout=10)
        me = json.loads(resp.read().decode('utf-8'))
        print('TEST5 ME WITH TOKEN -> HTTP=%d code=%s account=%s nick=%s' % (resp.getcode(), me.get('code'), (me.get('data') or {}).get('account_no'), (me.get('data') or {}).get('nickname')))
    except Exception as e:
        print('TEST5 ME EXCEPTION:', e)
else:
    print('TEST5 ME WITH TOKEN -> SKIP (no token from login)')
