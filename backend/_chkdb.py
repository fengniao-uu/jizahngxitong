import sqlite3, os
p = r'D:\GitHub_智能记账\backend\data\app.db'
print('EXIST:', os.path.exists(p), 'SIZE:', os.path.getsize(p) if os.path.exists(p) else 0)
conn = sqlite3.connect(p)
cur = conn.cursor()
cur.execute("SELECT id,account_no,nickname,role,is_active FROM users ORDER BY id")
print('ALL_USERS:')
for r in cur.fetchall():
    print('  ', r)
cur.execute("SELECT user_id, COUNT(*) FROM categories WHERE user_id>1 GROUP BY user_id")
print('CATEGORIES_PER_USER (uid>1):', cur.fetchall())
conn.close()
