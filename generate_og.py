"""
Gerador de og:images — Makewell Comunicação
Usa o fundo da og-image.jpg como base exata, substitui apenas o conteúdo.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

BASE   = os.path.dirname(os.path.abspath(__file__))
IMAGES = os.path.join(BASE, "images")
FONTS  = os.path.expanduser("~/Library/Fonts")

W, H = 1200, 630

GOLD_BR = (255, 155, 10)
WHITE   = (255, 255, 255)
GRAY    = (200, 200, 200)
GRAY_DK = (130, 130, 130)


def fnt(name, size):
    paths = {
        "black":    os.path.join(FONTS, "Montserrat-Black.otf"),
        "bold":     os.path.join(FONTS, "Montserrat-Bold.otf"),
        "semibold": os.path.join(FONTS, "Montserrat-SemiBold.otf"),
    }
    return ImageFont.truetype(paths.get(name, paths["bold"]), size)


def make_base():
    import numpy as np

    ys = np.linspace(0, 1, H).reshape(H, 1)
    xs = np.linspace(0, 1, W).reshape(1, W)

    d1 = np.sqrt(xs**2 + ys**2)
    t1 = np.exp(-d1 / 0.18)
    r1 = 255 * t1
    g1 = 140 * t1 * 0.72
    b1 = 20  * t1 * 0.15

    d2 = np.sqrt((1-xs)**2 + (1-ys)**2)
    t2 = np.exp(-d2 / 0.22)
    r2 = 252 * t2
    g2 = 200 * t2 * 0.90
    b2 = 100 * t2 * 0.55

    r = np.clip(r1 + r2, 0, 255)
    g = np.clip(g1 + g2, 0, 255)
    b = np.clip(b1 + b2, 0, 255)

    arr = np.stack([r, g, b], axis=2).astype(np.uint8)
    img = Image.fromarray(arr)

    grid_layer = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(grid_layer)
    for x in range(0, W + 1, 56):
        gd.line([(x, 0), (x, H)], fill=(255, 255, 255), width=1)
    for y in range(0, H + 1, 56):
        gd.line([(0, y), (W, y)], fill=(255, 255, 255), width=1)
    img = Image.blend(img, grid_layer, alpha=0.07)

    return img


def add_card_glow(img, x1, y1, x2, y2, radius=16):
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(10, 0, -1):
        ex = i * 9
        t = i / 10
        a = int(160 * t ** 1.2)  # mais intenso
        col = (min(255, int(240 * t ** 1.0)), max(0, int(90 * t ** 1.8)), 0, a)
        gd.rounded_rectangle([x1 - ex, y1 - ex, x2 + ex, y2 + ex],
                              radius=radius + ex // 2, fill=col)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=18))
    result = img.convert("RGBA")
    result = Image.alpha_composite(result, glow)
    return result.convert("RGB")


def draw_card(draw, x1, y1, x2, y2, radius=16):
    draw.rounded_rectangle([x1, y1, x2, y2], radius=radius, fill=(10, 6, 1))
    draw.rounded_rectangle([x1, y1, x2, y2], radius=radius,
                            outline=(240, 120, 5), width=2)


# Padrão único: número fnt(black,72) y+8 | label fnt(bold,22) y+92 | sublabel fnt(semibold,14) y+120
CARD_H = 148
F_NUM  = ("black",  72)
F_LBL  = ("bold",   22)   # era 18 — aumentado para equilíbrio visual
F_SUB  = ("semibold", 14)

def fill_card(draw, cx, cy, cw, num, lbl, sub=""):
    f_n = fnt(*F_NUM)
    nb = draw.textbbox((0, 0), num, font=f_n)
    draw.text((cx + (cw - (nb[2]-nb[0])) // 2, cy + 8), num, font=f_n, fill=GOLD_BR)
    f_l = fnt(*F_LBL)
    lb = draw.textbbox((0, 0), lbl, font=f_l)
    draw.text((cx + (cw - (lb[2]-lb[0])) // 2, cy + 92), lbl, font=f_l, fill=WHITE)
    if sub:
        f_s = fnt(*F_SUB)
        sb = draw.textbbox((0, 0), sub, font=f_s)
        draw.text((cx + (cw - (sb[2]-sb[0])) // 2, cy + 120), sub, font=f_s, fill=GRAY_DK)


def txt_center(draw, y, text, f, fill):
    bbox = draw.textbbox((0, 0), text, font=f)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, y), text, font=f, fill=fill)


def tag_pill(draw, x, y, text, fg=WHITE, border=(160, 80, 10)):
    f = fnt("bold", 13)
    bbox = draw.textbbox((0, 0), text, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    px, py = 20, 10
    w2, h2 = tw + px * 2, th + py * 2
    draw.rounded_rectangle([x, y, x + w2, y + h2], radius=10,
                            fill=(10, 6, 1), outline=border, width=2)
    draw.text((x + px, y + py), text, font=f, fill=fg)
    return x + w2 + 12


def paste_logo(img, y=28, height=72):
    logo = Image.open(os.path.join(IMAGES, "logo-makewell-branca.webp")).convert("RGBA")
    ratio = height / logo.height
    nw = int(logo.width * ratio)
    logo = logo.resize((nw, height), Image.LANCZOS)
    img.paste(logo, ((W - nw) // 2, y), logo)


def save(img, name):
    path = os.path.join(IMAGES, name)
    img.convert("RGB").save(path, "JPEG", quality=94, optimize=True)
    print(f"✅ {name}")


# ──────────────────────────────────────────
# CASES
# ──────────────────────────────────────────
def gen_cases():
    img = make_base()

    CW3 = 348; GAP3 = 26
    total = 3*CW3 + 2*GAP3; cx0 = (W-total)//2; cy0 = 218

    for i in range(3):
        img = add_card_glow(img, cx0+i*(CW3+GAP3), cy0, cx0+i*(CW3+GAP3)+CW3, cy0+CARD_H)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    txt_center(draw, 108, "Casos Reais. Resultados Reais.", fnt("black", 56), WHITE)
    txt_center(draw, 172, "ROI comprovado em Saúde, Jurídico e Terceiro Setor", fnt("semibold", 19), GRAY)

    cards = [("+26x","ROI","Jurídico"), ("+20x","ROI","Saúde"), ("13M","Impactados","Doenças Raras")]
    for i,(num,lbl,sub) in enumerate(cards):
        cx = cx0+i*(CW3+GAP3)
        draw_card(draw, cx, cy0, cx+CW3, cy0+CARD_H)
        fill_card(draw, cx, cy0, CW3, num, lbl, sub)

    tags = ["JURÍDICO","SAÚDE","TERCEIRO SETOR","FLORIDA"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = cy0+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, cy0+CARD_H+66, "makewell.com.br/cases", fnt("semibold", 15), WHITE)
    save(img, "og-cases-pt.jpg")


# ──────────────────────────────────────────
# CASA HUNTER
# ──────────────────────────────────────────
def gen_casa_hunter():
    img = make_base()

    CW3 = 330; GAP3 = 20
    total3 = 3*CW3+2*GAP3; sx3 = (W-total3)//2; sy3 = 294

    for i in range(3):
        img = add_card_glow(img, sx3+i*(CW3+GAP3), sy3, sx3+i*(CW3+GAP3)+CW3, sy3+CARD_H, radius=14)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    lbl_tag = "CASE MAKEWELL — DOENÇAS RARAS"
    f_lbl = fnt("bold", 14)
    lb = draw.textbbox((0,0), lbl_tag, font=f_lbl)
    draw.text(((W-(lb[2]-lb[0]))//2, 108), lbl_tag, font=f_lbl, fill=GOLD_BR)

    txt_center(draw, 128, "13 Milhões", fnt("black", 96), WHITE)
    txt_center(draw, 234, "de brasileiros com doenças raras", fnt("black", 30), GOLD_BR)
    draw.line([(W//2-230, 278), (W//2+230, 278)], fill=(90,48,3), width=1)

    stats3 = [("4 anos","de estratégia",""), ("50K","seguidores",""), ("Doc.","nacional","")]
    for i,(num,lbl2,sub) in enumerate(stats3):
        cx = sx3+i*(CW3+GAP3)
        draw_card(draw, cx, sy3, cx+CW3, sy3+CARD_H, radius=14)
        fill_card(draw, cx, sy3, CW3, num, lbl2)

    tags = ["SAÚDE","TERCEIRO SETOR","DOCUMENTÁRIO","CAUSA NACIONAL"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = sy3+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, sy3+CARD_H+66, "makewell.com.br/cases/casa-hunter-casa-dos-raros", fnt("semibold", 15), WHITE)
    save(img, "og-casa-hunter-pt.jpg")


# ──────────────────────────────────────────
# SOBRE
# ──────────────────────────────────────────
def gen_sobre():
    img = make_base()

    CW4 = 258; GAP4 = 16
    total4 = 4*CW4+3*GAP4; sx4 = (W-total4)//2; sy4 = 284

    for i in range(4):
        img = add_card_glow(img, sx4+i*(CW4+GAP4), sy4, sx4+i*(CW4+GAP4)+CW4, sy4+CARD_H, radius=14)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    txt_center(draw, 108, "Sobre a Makewell", fnt("black", 76), WHITE)
    txt_center(draw, 192, "Comunicação estratégica desde 2017", fnt("black", 34), GOLD_BR)
    draw.line([(W//2-250, 242), (W//2+250, 242)], fill=(90,48,3), width=1)
    txt_center(draw, 254, "Da criação de marca à geração de receita previsível.", fnt("semibold", 17), GRAY)

    stats4 = [("2017","Fundação",""), ("50+","Clientes",""), ("9+","Anos",""), ("2","Países","")]
    for i,(num,lbl3,sub) in enumerate(stats4):
        cx = sx4+i*(CW4+GAP4)
        draw_card(draw, cx, sy4, cx+CW4, sy4+CARD_H, radius=14)
        fill_card(draw, cx, sy4, CW4, num, lbl3)

    tags = ["MACEIÓ — AL","SÃO PAULO — SP","FLORIDA — EUA"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = sy4+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, sy4+CARD_H+66, "makewell.com.br/sobre", fnt("semibold", 15), WHITE)
    save(img, "og-sobre-pt.jpg")


# ──────────────────────────────────────────
# EN — HOME
# ──────────────────────────────────────────
def gen_home_en():
    img = make_base()

    CW_H = 258; GAP_H = 16
    total_h = 4*CW_H+3*GAP_H; sxh = (W-total_h)//2; syh = 310

    for i in range(4):
        cx = sxh+i*(CW_H+GAP_H)
        img = add_card_glow(img, cx, syh, cx+CW_H, syh+CARD_H, radius=14)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    txt_center(draw, 108, "Intelligent Marketing", fnt("black", 76), WHITE)
    txt_center(draw, 196, "for Brazilian Businesses", fnt("black", 38), GOLD_BR)
    draw.line([(W//2-260, 250), (W//2+260, 250)], fill=(90,48,3), width=1)
    txt_center(draw, 262, "Branding · Paid Traffic · SEO · Sales · Automation", fnt("semibold", 18), GRAY)

    stats = [("50+","Clients",""), ("9+","Years",""), ("+26x","ROI",""), ("2","Countries","")]
    for i,(num,lbl,sub) in enumerate(stats):
        cx = sxh+i*(CW_H+GAP_H)
        draw_card(draw, cx, syh, cx+CW_H, syh+CARD_H, radius=14)
        fill_card(draw, cx, syh, CW_H, num, lbl)

    tags = ["BRANDING","PAID TRAFFIC","SEO","CRM","AI"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = syh+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, syh+CARD_H+66, "makewell.agency/en", fnt("semibold", 15), WHITE)
    save(img, "og-home-en.jpg")


# ──────────────────────────────────────────
# EN — CASES
# ──────────────────────────────────────────
def gen_cases_en():
    img = make_base()

    cw = 348; gap = 26
    total = 3*cw + 2*gap; cx0 = (W-total)//2; cy0 = 218

    for i in range(3):
        cx = cx0+i*(cw+gap)
        img = add_card_glow(img, cx, cy0, cx+cw, cy0+CARD_H)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    txt_center(draw, 108, "Real Cases. Real Results.", fnt("black", 56), WHITE)
    txt_center(draw, 172, "Proven ROI in Healthcare, Legal and Nonprofits", fnt("semibold", 19), GRAY)

    cards = [("+26x","ROI","Legal"), ("+20x","ROI","Healthcare"), ("13M","Impacted","Rare Diseases")]
    for i,(num,lbl,sub) in enumerate(cards):
        cx = cx0+i*(cw+gap)
        draw_card(draw, cx, cy0, cx+cw, cy0+CARD_H)
        fill_card(draw, cx, cy0, cw, num, lbl, sub)

    tags = ["LEGAL","HEALTHCARE","NONPROFITS","FLORIDA"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = cy0+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, cy0+CARD_H+66, "makewell.agency/en/cases", fnt("semibold", 15), WHITE)
    save(img, "og-cases-en.jpg")


# ──────────────────────────────────────────
# EN — CASA HUNTER
# ──────────────────────────────────────────
def gen_casa_hunter_en():
    img = make_base()

    cw3 = 330; gap3 = 20
    total3 = 3*cw3+2*gap3; sx3 = (W-total3)//2; sy3 = 294

    for i in range(3):
        cx = sx3+i*(cw3+gap3)
        img = add_card_glow(img, cx, sy3, cx+cw3, sy3+CARD_H, radius=14)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    lbl = "MAKEWELL CASE — RARE DISEASES"
    f_lbl = fnt("bold", 14)
    lb = draw.textbbox((0,0), lbl, font=f_lbl)
    draw.text(((W-(lb[2]-lb[0]))//2, 108), lbl, font=f_lbl, fill=GOLD_BR)

    txt_center(draw, 128, "13 Million", fnt("black", 100), WHITE)
    txt_center(draw, 238, "Brazilians with rare diseases", fnt("black", 32), GOLD_BR)
    draw.line([(W//2-230, 282), (W//2+230, 282)], fill=(90,48,3), width=1)

    stats3_en = [("4 years","of strategy",""), ("50K","followers",""), ("Doc.","national","")]
    for i,(num,lbl2,sub) in enumerate(stats3_en):
        cx = sx3+i*(cw3+gap3)
        draw_card(draw, cx, sy3, cx+cw3, sy3+CARD_H, radius=14)
        fill_card(draw, cx, sy3, cw3, num, lbl2)

    tags = ["HEALTHCARE","NONPROFIT","DOCUMENTARY","NATIONAL CAUSE"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = sy3+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, sy3+CARD_H+66, "makewell.agency/en/cases/casa-hunter-casa-dos-raros", fnt("semibold", 15), WHITE)
    save(img, "og-casa-hunter-en.jpg")


# ──────────────────────────────────────────
# EN — ABOUT
# ──────────────────────────────────────────
def gen_sobre_en():
    img = make_base()

    cw4 = 255; gap4 = 16
    total4 = 4*cw4+3*gap4; sx4 = (W-total4)//2; sy4 = 284

    for i in range(4):
        cx = sx4+i*(cw4+gap4)
        img = add_card_glow(img, cx, sy4, cx+cw4, sy4+CARD_H, radius=14)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    txt_center(draw, 108, "About Makewell", fnt("black", 76), WHITE)
    txt_center(draw, 196, "Strategic communication since 2017", fnt("black", 34), GOLD_BR)
    draw.line([(W//2-250, 248), (W//2+250, 248)], fill=(90,48,3), width=1)
    txt_center(draw, 260, "From brand creation to predictable revenue generation.", fnt("semibold", 18), GRAY)

    stats4_en = [("2017","Founded",""), ("50+","Clients",""), ("9+","Years",""), ("2","Countries","")]
    for i,(num,lbl3,sub) in enumerate(stats4_en):
        cx = sx4+i*(cw4+gap4)
        draw_card(draw, cx, sy4, cx+cw4, sy4+CARD_H, radius=14)
        fill_card(draw, cx, sy4, cw4, num, lbl3)

    tags = ["MACEIÓ — BR","SÃO PAULO — BR","FLORIDA — USA"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = sy4+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, sy4+CARD_H+66, "makewell.agency/en/about", fnt("semibold", 15), WHITE)
    save(img, "og-sobre-en.jpg")


# ──────────────────────────────────────────
# ES — HOME
# ──────────────────────────────────────────
def gen_home_es():
    img = make_base()

    CW_H = 258; GAP_H = 16
    total_h = 4*CW_H+3*GAP_H; sxh = (W-total_h)//2; syh = 310

    for i in range(4):
        cx = sxh+i*(CW_H+GAP_H)
        img = add_card_glow(img, cx, syh, cx+CW_H, syh+CARD_H, radius=14)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    txt_center(draw, 108, "Marketing Inteligente", fnt("black", 68), WHITE)
    txt_center(draw, 194, "para Brasileños en España", fnt("black", 34), GOLD_BR)
    draw.line([(W//2-260, 248), (W//2+260, 248)], fill=(90,48,3), width=1)
    txt_center(draw, 260, "Branding · Tráfico Pago · SEO · Ventas · Automatización", fnt("semibold", 18), GRAY)

    stats = [("50+","Clientes",""), ("9+","Años",""), ("+26x","ROI",""), ("2","Países","")]
    for i,(num,lbl,sub) in enumerate(stats):
        cx = sxh+i*(CW_H+GAP_H)
        draw_card(draw, cx, syh, cx+CW_H, syh+CARD_H, radius=14)
        fill_card(draw, cx, syh, CW_H, num, lbl)

    tags = ["BRANDING","TRÁFICO PAGO","SEO","CRM","IA"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = syh+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, syh+CARD_H+66, "makewell.agency/es", fnt("semibold", 15), WHITE)
    save(img, "og-home-es.jpg")


# ──────────────────────────────────────────
# ES — CASES
# ──────────────────────────────────────────
def gen_cases_es():
    img = make_base()

    cw = 348; gap = 26
    total = 3*cw + 2*gap; cx0 = (W-total)//2; cy0 = 218

    for i in range(3):
        cx = cx0+i*(cw+gap)
        img = add_card_glow(img, cx, cy0, cx+cw, cy0+CARD_H)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    txt_center(draw, 108, "Casos Reales. Resultados Reales.", fnt("black", 50), WHITE)
    txt_center(draw, 172, "ROI comprobado en Salud, Legal y Tercer Sector", fnt("semibold", 19), GRAY)

    cards = [("+26x","ROI","Legal"), ("+20x","ROI","Salud"), ("13M","Impactados","Enfermedades Raras")]
    for i,(num,lbl,sub) in enumerate(cards):
        cx = cx0+i*(cw+gap)
        draw_card(draw, cx, cy0, cx+cw, cy0+CARD_H)
        fill_card(draw, cx, cy0, cw, num, lbl, sub)

    tags = ["LEGAL","SALUD","TERCER SECTOR","ESPAÑA"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = cy0+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, cy0+CARD_H+66, "makewell.agency/es/cases", fnt("semibold", 15), WHITE)
    save(img, "og-cases-es.jpg")


# ──────────────────────────────────────────
# ES — CASA HUNTER
# ──────────────────────────────────────────
def gen_casa_hunter_es():
    img = make_base()

    cw3 = 330; gap3 = 20
    total3 = 3*cw3+2*gap3; sx3 = (W-total3)//2; sy3 = 294

    for i in range(3):
        cx = sx3+i*(cw3+gap3)
        img = add_card_glow(img, cx, sy3, cx+cw3, sy3+CARD_H, radius=14)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    lbl = "CASO MAKEWELL — ENFERMEDADES RARAS"
    f_lbl = fnt("bold", 14)
    lb = draw.textbbox((0,0), lbl, font=f_lbl)
    draw.text(((W-(lb[2]-lb[0]))//2, 108), lbl, font=f_lbl, fill=GOLD_BR)

    txt_center(draw, 128, "13 Millones", fnt("black", 96), WHITE)
    txt_center(draw, 234, "de brasileños con enfermedades raras", fnt("black", 28), GOLD_BR)
    draw.line([(W//2-230, 278), (W//2+230, 278)], fill=(90,48,3), width=1)

    stats3_es = [("4 años","de estrategia",""), ("50K","seguidores",""), ("Doc.","nacional","")]
    for i,(num,lbl2,sub) in enumerate(stats3_es):
        cx = sx3+i*(cw3+gap3)
        draw_card(draw, cx, sy3, cx+cw3, sy3+CARD_H, radius=14)
        fill_card(draw, cx, sy3, cw3, num, lbl2)

    tags = ["SALUD","TERCER SECTOR","DOCUMENTAL","CAUSA NACIONAL"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = sy3+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, sy3+CARD_H+66, "makewell.agency/es/cases/casa-hunter-casa-dos-raros", fnt("semibold", 15), WHITE)
    save(img, "og-casa-hunter-es.jpg")


# ──────────────────────────────────────────
# ES — ABOUT
# ──────────────────────────────────────────
def gen_sobre_es():
    img = make_base()

    cw4 = 255; gap4 = 16
    total4 = 4*cw4+3*gap4; sx4 = (W-total4)//2; sy4 = 284

    for i in range(4):
        cx = sx4+i*(cw4+gap4)
        img = add_card_glow(img, cx, sy4, cx+cw4, sy4+CARD_H, radius=14)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    txt_center(draw, 108, "Sobre Makewell", fnt("black", 76), WHITE)
    txt_center(draw, 196, "Comunicación estratégica desde 2017", fnt("black", 30), GOLD_BR)
    draw.line([(W//2-250, 248), (W//2+250, 248)], fill=(90,48,3), width=1)
    txt_center(draw, 260, "De la creación de marca a la generación de ingresos predecibles.", fnt("semibold", 16), GRAY)

    stats4_es = [("2017","Fundación",""), ("50+","Clientes",""), ("9+","Años",""), ("2","Países","")]
    for i,(num,lbl3,sub) in enumerate(stats4_es):
        cx = sx4+i*(cw4+gap4)
        draw_card(draw, cx, sy4, cx+cw4, sy4+CARD_H, radius=14)
        fill_card(draw, cx, sy4, cw4, num, lbl3)

    tags = ["MACEIÓ — BR","SÃO PAULO — BR","ESPAÑA"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = sy4+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, sy4+CARD_H+66, "makewell.agency/es/about", fnt("semibold", 15), WHITE)
    save(img, "og-sobre-es.jpg")


# ──────────────────────────────────────────
# PT (Portugal) — HOME
# ──────────────────────────────────────────
def gen_home_pt_pt():
    img = make_base()

    CW_H = 258; GAP_H = 16
    total_h = 4*CW_H+3*GAP_H; sxh = (W-total_h)//2; syh = 310

    for i in range(4):
        cx = sxh+i*(CW_H+GAP_H)
        img = add_card_glow(img, cx, syh, cx+CW_H, syh+CARD_H, radius=14)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    txt_center(draw, 108, "Marketing Inteligente", fnt("black", 68), WHITE)
    txt_center(draw, 194, "em Portugal", fnt("black", 40), GOLD_BR)
    draw.line([(W//2-260, 248), (W//2+260, 248)], fill=(90,48,3), width=1)
    txt_center(draw, 260, "Branding · Tráfego Pago · SEO · Vendas · Automação", fnt("semibold", 18), GRAY)

    stats = [("50+","Clientes",""), ("9+","Anos",""), ("+26x","ROI",""), ("2","Países","")]
    for i,(num,lbl,sub) in enumerate(stats):
        cx = sxh+i*(CW_H+GAP_H)
        draw_card(draw, cx, syh, cx+CW_H, syh+CARD_H, radius=14)
        fill_card(draw, cx, syh, CW_H, num, lbl)

    tags = ["BRANDING","TRÁFEGO PAGO","SEO","CRM","IA"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = syh+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, syh+CARD_H+66, "makewell.agency/pt", fnt("semibold", 15), WHITE)
    save(img, "og-home-pt-pt.jpg")


# ──────────────────────────────────────────
# PT (Portugal) — CASES
# ──────────────────────────────────────────
def gen_cases_pt_pt():
    img = make_base()

    cw = 348; gap = 26
    total = 3*cw + 2*gap; cx0 = (W-total)//2; cy0 = 218

    for i in range(3):
        cx = cx0+i*(cw+gap)
        img = add_card_glow(img, cx, cy0, cx+cw, cy0+CARD_H)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    txt_center(draw, 108, "Casos Reais. Resultados Reais.", fnt("black", 52), WHITE)
    txt_center(draw, 172, "ROI comprovado em Saúde, Jurídico e Terceiro Setor", fnt("semibold", 19), GRAY)

    cards = [("+26x","ROI","Jurídico"), ("+20x","ROI","Saúde"), ("13M","Impactados","Doenças Raras")]
    for i,(num,lbl,sub) in enumerate(cards):
        cx = cx0+i*(cw+gap)
        draw_card(draw, cx, cy0, cx+cw, cy0+CARD_H)
        fill_card(draw, cx, cy0, cw, num, lbl, sub)

    tags = ["JURÍDICO","SAÚDE","TERCEIRO SETOR","PORTUGAL"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = cy0+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, cy0+CARD_H+66, "makewell.agency/pt/cases", fnt("semibold", 15), WHITE)
    save(img, "og-cases-pt-pt.jpg")


# ──────────────────────────────────────────
# PT (Portugal) — CASA HUNTER
# ──────────────────────────────────────────
def gen_casa_hunter_pt_pt():
    img = make_base()

    cw3 = 330; gap3 = 20
    total3 = 3*cw3+2*gap3; sx3 = (W-total3)//2; sy3 = 294

    for i in range(3):
        cx = sx3+i*(cw3+gap3)
        img = add_card_glow(img, cx, sy3, cx+cw3, sy3+CARD_H, radius=14)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    lbl = "CASE MAKEWELL — DOENÇAS RARAS"
    f_lbl = fnt("bold", 14)
    lb = draw.textbbox((0,0), lbl, font=f_lbl)
    draw.text(((W-(lb[2]-lb[0]))//2, 108), lbl, font=f_lbl, fill=GOLD_BR)

    txt_center(draw, 128, "13 Milhões", fnt("black", 96), WHITE)
    txt_center(draw, 234, "de brasileiros com doenças raras", fnt("black", 30), GOLD_BR)
    draw.line([(W//2-230, 278), (W//2+230, 278)], fill=(90,48,3), width=1)

    stats3_pt = [("4 anos","de estratégia",""), ("50K","seguidores",""), ("Doc.","nacional","")]
    for i,(num,lbl2,sub) in enumerate(stats3_pt):
        cx = sx3+i*(cw3+gap3)
        draw_card(draw, cx, sy3, cx+cw3, sy3+CARD_H, radius=14)
        fill_card(draw, cx, sy3, cw3, num, lbl2)

    tags = ["SAÚDE","TERCEIRO SETOR","DOCUMENTÁRIO","CAUSA NACIONAL"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = sy3+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, sy3+CARD_H+66, "makewell.agency/pt/cases/casa-hunter-casa-dos-raros", fnt("semibold", 15), WHITE)
    save(img, "og-casa-hunter-pt-pt.jpg")


# ──────────────────────────────────────────
# PT (Portugal) — ABOUT
# ──────────────────────────────────────────
def gen_sobre_pt_pt():
    img = make_base()

    cw4 = 255; gap4 = 16
    total4 = 4*cw4+3*gap4; sx4 = (W-total4)//2; sy4 = 284

    for i in range(4):
        cx = sx4+i*(cw4+gap4)
        img = add_card_glow(img, cx, sy4, cx+cw4, sy4+CARD_H, radius=14)

    paste_logo(img, y=26, height=72)
    draw = ImageDraw.Draw(img)

    txt_center(draw, 108, "Sobre a Makewell", fnt("black", 76), WHITE)
    txt_center(draw, 192, "Comunicação estratégica desde 2017", fnt("black", 30), GOLD_BR)
    draw.line([(W//2-250, 242), (W//2+250, 242)], fill=(90,48,3), width=1)
    txt_center(draw, 254, "Da criação de marca à geração de receita previsível.", fnt("semibold", 17), GRAY)

    stats4_pt = [("2017","Fundação",""), ("50+","Clientes",""), ("9+","Anos",""), ("2","Países","")]
    for i,(num,lbl3,sub) in enumerate(stats4_pt):
        cx = sx4+i*(cw4+gap4)
        draw_card(draw, cx, sy4, cx+cw4, sy4+CARD_H, radius=14)
        fill_card(draw, cx, sy4, cw4, num, lbl3)

    tags = ["MACEIÓ — BR","SÃO PAULO — BR","PORTUGAL"]
    f_t = fnt("bold", 11)
    tw_total = sum(draw.textbbox((0,0),t,font=f_t)[2]+40 for t in tags)+(len(tags)-1)*10
    tx = (W-tw_total)//2
    ty = sy4+CARD_H+18
    for t in tags: tx = tag_pill(draw, tx, ty, t)

    txt_center(draw, sy4+CARD_H+66, "makewell.agency/pt/about", fnt("semibold", 15), WHITE)
    save(img, "og-sobre-pt-pt.jpg")


if __name__ == "__main__":
    gen_cases()
    gen_casa_hunter()
    gen_sobre()
    gen_home_en()
    gen_cases_en()
    gen_casa_hunter_en()
    gen_sobre_en()
    gen_home_es()
    gen_cases_es()
    gen_casa_hunter_es()
    gen_sobre_es()
    gen_home_pt_pt()
    gen_cases_pt_pt()
    gen_casa_hunter_pt_pt()
    gen_sobre_pt_pt()
    print("\n✅ 15 og:images geradas")
