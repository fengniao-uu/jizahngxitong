import io
import os
import uuid
import secrets
import hashlib
import datetime as dt
import random
import base64
from typing import Tuple

# ---------- 开关：可通过 Cloudflare 环境变量 DISABLE_CAPTCHA=1 关闭验证码 ----------
_DISABLE_CAPTCHA = str(os.getenv("DISABLE_CAPTCHA", "0") or "0").lower() in {
    "1", "true", "yes", "y", "on",
}

# ---------- Pillow 兼容性检测 ----------
_PIL_OK = False
try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    _PIL_OK = True
except Exception:
    _PIL_OK = False

_CAPTCHA_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_CAPTCHA_LEN = 4
_CAPTCHA_TTL_SEC = 300
_IMG_W, _IMG_H = 160, 52


def _rand_color(lo: int = 0, hi: int = 255) -> Tuple[int, int, int]:
    return (
        random.randint(lo, hi),
        random.randint(lo, hi),
        random.randint(lo, hi),
    )


def _hex_color(c: Tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(c[0] & 0xFF, c[1] & 0xFF, c[2] & 0xFF)


def _pillow_draw_captcha(code_chars):
    """Pillow 可用时的原生绘图方案。"""
    r1 = _rand_color(210, 255)
    g1 = _rand_color(210, 255)
    b1 = _rand_color(210, 255)
    r2 = _rand_color(170, 225)
    g2 = _rand_color(170, 225)
    b2 = _rand_color(170, 225)
    img = Image.new("RGB", (_IMG_W, _IMG_H), (248, 250, 252))
    pix = img.load()
    for y in range(_IMG_H):
        t = y / _IMG_H
        rr = int(r1[0] * (1 - t) + r2[0] * t) & 0xFF
        gg = int(g1[1] * (1 - t) + g2[1] * t) & 0xFF
        bb = int(b1[2] * (1 - t) + b2[2] * t) & 0xFF
        for x in range(_IMG_W):
            pix[x, y] = (rr, gg, bb)

    draw = ImageDraw.Draw(img)
    try:
        sizes = [30, 31, 32, 33, 34, 35, 36]
        candidates = [
            "C:/Windows/Fonts/arialbd.ttf",
            "C:/Windows/Fonts/Arial.ttf",
            "C:/Windows/Fonts/msyhbd.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/Library/Fonts/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        ]
        font = ImageFont.load_default()
        for p in candidates:
            if os.path.exists(p):
                try:
                    font = ImageFont.truetype(p, random.choice(sizes))
                    break
                except Exception:
                    continue
    except Exception:
        font = ImageFont.load_default()

    # 噪点
    for _ in range(80):
        x = random.randint(0, _IMG_W - 1)
        y = random.randint(0, _IMG_H - 1)
        draw.point((x, y), fill=_rand_color(60, 220))

    # 干扰线
    for _ in range(4):
        x1 = random.randint(0, _IMG_W // 3)
        y1 = random.randint(0, _IMG_H - 1)
        x2 = random.randint(_IMG_W * 2 // 3, _IMG_W - 1)
        y2 = random.randint(0, _IMG_H - 1)
        draw.line([(x1, y1), (x2, y2)], fill=_rand_color(90, 200), width=random.randint(1, 2))

    # 干扰弧线
    for _ in range(2):
        bbox = [
            random.randint(-10, _IMG_W // 2),
            random.randint(-10, _IMG_H // 2),
            random.randint(_IMG_W // 2, _IMG_W + 10),
            random.randint(_IMG_H // 2, _IMG_H + 10),
        ]
        draw.arc(
            bbox,
            start=random.randint(0, 180),
            end=random.randint(180, 360),
            fill=_rand_color(80, 190),
            width=random.randint(1, 2),
        )

    char_w = _IMG_W / (_CAPTCHA_LEN + 1)
    for i, ch in enumerate(code_chars):
        char_img = Image.new("RGBA", (50, 52), (0, 0, 0, 0))
        cd = ImageDraw.Draw(char_img)
        fg = _rand_color(10, 110)
        while fg[0] + fg[1] + fg[2] > 260:
            fg = _rand_color(10, 110)
        try:
            bbox_t = cd.textbbox((0, 0), ch, font=font)
            tw = bbox_t[2] - bbox_t[0]
            th = bbox_t[3] - bbox_t[1]
            tx = (50 - tw) // 2 - bbox_t[0]
            ty = (52 - th) // 2 - bbox_t[1]
        except Exception:
            tx, ty = 10, 8
        cd.text((tx, ty), ch, font=font, fill=fg)
        angle = random.randint(-28, 28)
        char_img = char_img.rotate(angle, resample=Image.BICUBIC, expand=True)
        px = int(char_w * (i + 0.55) + random.randint(-6, 6))
        py = random.randint(0, _IMG_H - 38)
        img.paste(char_img, (px, py), char_img)

    try:
        img = img.filter(ImageFilter.SMOOTH)
    except Exception:
        pass

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return "data:image/png;base64," + b64


def _svg_draw_captcha(code_plain):
    """Pillow 不可用时的降级：生成 SVG 验证码（纯 Python，零 C 扩展）。"""
    chars = list(code_plain)
    parts = []
    bg_c1 = _hex_color(_rand_color(230, 255))
    bg_c2 = _hex_color(_rand_color(190, 235))
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{_IMG_W}" height="{_IMG_H}" viewBox="0 0 {_IMG_W} {_IMG_H}">'
    )
    parts.append(
        f'<defs><linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">'
        f'<stop offset="0%" stop-color="{bg_c1}"/>'
        f'<stop offset="100%" stop-color="{bg_c2}"/>'
        f"</linearGradient></defs>"
    )
    parts.append(f'<rect width="{_IMG_W}" height="{_IMG_H}" fill="url(#bg)"/>')

    # 噪点
    for _ in range(60):
        x = random.randint(0, _IMG_W - 1)
        y = random.randint(0, _IMG_H - 1)
        c = _hex_color(_rand_color(80, 200))
        parts.append(f'<circle cx="{x}" cy="{y}" r="1" fill="{c}" opacity="0.7"/>')

    # 干扰线
    for _ in range(4):
        x1 = random.randint(0, _IMG_W // 3)
        y1 = random.randint(0, _IMG_H - 1)
        x2 = random.randint(_IMG_W * 2 // 3, _IMG_W - 1)
        y2 = random.randint(0, _IMG_H - 1)
        c = _hex_color(_rand_color(90, 180))
        w = random.randint(1, 2)
        parts.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="{w}" opacity="0.7"/>'
        )

    # 字符
    step = _IMG_W / (_CAPTCHA_LEN + 1)
    for i, ch in enumerate(chars):
        fg = _hex_color(_rand_color(10, 100))
        angle = random.randint(-25, 25)
        x = int(step * (i + 0.6) + random.randint(-5, 5))
        y = int(_IMG_H * 0.65 + random.randint(-6, 6))
        fs = random.randint(28, 34)
        parts.append(
            f'<text x="{x}" y="{y}" fill="{fg}" font-size="{fs}" '
            f'font-family="Arial, Helvetica, sans-serif" font-weight="bold" '
            f'transform="rotate({angle} {x} {y})">{ch}</text>'
        )

    parts.append("</svg>")
    svg_str = "".join(parts)
    svg_b64 = base64.b64encode(svg_str.encode("utf-8")).decode("ascii")
    return "data:image/svg+xml;base64," + svg_b64


def _placeholder_captcha(code_plain):
    """终极兜底：返回一段纯文本 PNG（或直接把 code 明文写在 data URI 里的极简 SVG）。"""
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{_IMG_W}" height="{_IMG_H}">'
        f'<rect width="100%" height="100%" fill="#eef2ff"/>'
        f'<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" '
        f'font-family="monospace" font-size="24" font-weight="bold" fill="#4338ca">{code_plain}</text>'
        f"</svg>"
    )
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return "data:image/svg+xml;base64," + b64


def generate_captcha() -> dict:
    """生成验证码。返回 {captcha_id, image: 'data:xxx', ttl, expires_at, code_plain, ...}。

    降级策略：
      1. DISABLE_CAPTCHA=1 → code_plain = "0000"，返回占位图，验证时任意输入通过
      2. Pillow 可用 → 生成高质量 PNG 验证码
      3. Pillow 不可用 → 降级为内联 SVG 验证码（纯 Python）
      4. 任何异常 → 终极兜底占位图
    """
    if _DISABLE_CAPTCHA:
        code_plain = "0000"
        salt = "disabled"
        code_hash = hashlib.sha256((salt + code_plain).encode("utf-8")).hexdigest()
        captcha_id = uuid.uuid4().hex
        now = dt.datetime.utcnow()
        exp = now + dt.timedelta(seconds=_CAPTCHA_TTL_SEC)
        expires_at = exp.strftime("%Y-%m-%d %H:%M:%S")
        try:
            image_uri = _placeholder_captcha("CAPTCHA OFF")
        except Exception:
            image_uri = ""
        return {
            "captcha_id": captcha_id,
            "code_hash": code_hash,
            "salt": salt,
            "expires_at": expires_at,
            "image": image_uri,
            "ttl": _CAPTCHA_TTL_SEC,
            "disabled": True,
        }

    code_chars = [secrets.choice(_CAPTCHA_CHARS) for _ in range(_CAPTCHA_LEN)]
    code_plain = "".join(code_chars)
    salt = secrets.token_hex(8)
    code_hash = hashlib.sha256((salt + code_plain).encode("utf-8")).hexdigest()
    captcha_id = uuid.uuid4().hex

    image_uri = ""
    try:
        if _PIL_OK:
            image_uri = _pillow_draw_captcha(code_chars)
    except Exception:
        image_uri = ""

    if not image_uri:
        try:
            image_uri = _svg_draw_captcha(code_plain)
        except Exception:
            image_uri = ""

    if not image_uri:
        try:
            image_uri = _placeholder_captcha(code_plain)
        except Exception:
            image_uri = ""

    now = dt.datetime.utcnow()
    exp = now + dt.timedelta(seconds=_CAPTCHA_TTL_SEC)
    expires_at = exp.strftime("%Y-%m-%d %H:%M:%S")

    return {
        "captcha_id": captcha_id,
        "code_hash": code_hash,
        "salt": salt,
        "expires_at": expires_at,
        "image": image_uri,
        "ttl": _CAPTCHA_TTL_SEC,
    }


def is_captcha_disabled() -> bool:
    """供外部判断当前是否关闭了验证码（如关闭，auth 路由可跳过校验）。"""
    return _DISABLE_CAPTCHA
