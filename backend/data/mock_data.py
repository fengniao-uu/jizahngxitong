USERS = {
    'admin': {
        'password': 'admin123',
        'name': '用户昵称',
        'avatar': '',
        'role': 'admin'
    }
}

LOGIN_OK = {
    'token': 'mock-jwt-admin-20260702',
    'userInfo': {
        'name': '用户昵称',
        'avatar': '',
        'role': 'admin'
    }
}

SUMMARY = {
    'cards': [
        {
            'title': '本月收入',
            'amount': 8247,
            'yoy': 12.5,
            'color': 'blue'
        },
        {
            'title': '本月支出',
            'amount': 4632.5,
            'yoy': -8.3,
            'color': 'green'
        },
        {
            'title': '本月结余',
            'amount': 3614.5,
            'yoy': 35.7,
            'color': 'purple'
        },
        {
            'title': '总资产',
            'amount': 128650.75,
            'yoy': 5.8,
            'color': 'orange'
        }
    ]
}

TREND = {
    'months': ['1月', '2月', '3月', '4月', '5月', '6月'],
    'income': [5200, 7300, 9600, 6500, 8100, 8247],
    'expense': [2300, 3400, 4100, 2800, 3900, 4632.5]
}

EXPENSE_BY_CATEGORY = {
    'total': 4632.5,
    'list': [
        {
            'category': '餐饮美食',
            'amount': 1287.5,
            'percent': 27.8,
            'color': '#f59e0b'
        },
        {
            'category': '交通出行',
            'amount': 856,
            'percent': 18.5,
            'color': '#10b981'
        },
        {
            'category': '购物消费',
            'amount': 743.2,
            'percent': 16,
            'color': '#3b82f6'
        },
        {
            'category': '居住缴费',
            'amount': 652.3,
            'percent': 14.1,
            'color': '#8b5cf6'
        },
        {
            'category': '休闲娱乐',
            'amount': 523.5,
            'percent': 11.3,
            'color': '#ec4899'
        },
        {
            'category': '其他支出',
            'amount': 570,
            'percent': 12.3,
            'color': '#6b7280'
        }
    ]
}

RECENT_TRANSACTIONS = [
    {
        'id': 1,
        'type': 'expense',
        'category': '餐饮美食',
        'amount': 56.5,
        'description': '午餐-外卖',
        'date': '2026-07-02 12:30',
        'icon': 'food'
    },
    {
        'id': 2,
        'type': 'income',
        'category': '工资薪酬',
        'amount': 15000,
        'description': '6月工资',
        'date': '2026-07-01 10:00',
        'icon': 'salary'
    },
    {
        'id': 3,
        'type': 'expense',
        'category': '交通出行',
        'amount': 32,
        'description': '地铁通勤',
        'date': '2026-07-01 08:15',
        'icon': 'transport'
    },
    {
        'id': 4,
        'type': 'expense',
        'category': '购物消费',
        'amount': 299,
        'description': '日用品采购',
        'date': '2026-06-30 19:45',
        'icon': 'shopping'
    },
    {
        'id': 5,
        'type': 'expense',
        'category': '居住缴费',
        'amount': 1200,
        'description': '7月房租',
        'date': '2026-06-30 09:00',
        'icon': 'rent'
    }
]

BUDGET = {
    'used': 3400,
    'total': 5000,
    'percent': 68
}

FLOAT_CARDS = {
    'today_income': 32686,
    'today_expense': 18000
}
