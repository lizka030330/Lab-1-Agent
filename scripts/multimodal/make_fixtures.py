"""Власні тестові файли мультимодального набору (Лаб. 4, крок 05). Усе згенеровано тут — чужих документів, фото й голосу немає.
   python3 scripts/multimodal/make_fixtures.py   →   fixtures/multimodal/
Зміст вигаданий: документи про сам навчальний продукт. Детерміновано (фіксований seed)."""
import os, random, tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

OUT = 'fixtures/multimodal'
os.makedirs(OUT, exist_ok=True)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
random.seed(5)

def page(w, h, lines, size):
    img = Image.new('RGB', (w, h), 'white')
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, size)
    y = size
    for t in lines:
        d.text((size, y), t, fill='black', font=f)
        y += int(size * 1.6)
    return img

doc = ['ДОГОВІР № 47-К/2026', 'про навчальне використання харнеса', 'Дата: 25.11.2026', 'Сторони: Студентка групи 4CS-33 і Лабораторія 4',
       'Предмет: перевірка мультимодального входу', 'Строк дії: до 31.12.2026']
page(768, 1000, doc, 30).save(f'{OUT}/page-clear.png')
blur = page(768, 1000, doc, 30).filter(ImageFilter.GaussianBlur(9))
noise = Image.effect_noise((768, 1000), 90).convert('RGB')
Image.blend(blur, noise, 0.45).rotate(7, fillcolor='gray').save(f'{OUT}/scan-blurred.jpg', quality=25)
page(320, 200, ['LAB-4', 'КРОК 05'], 40).save(f'{OUT}/tiny-320x200.png')
page(1600, 1200, ['ЗВІТ КРОКУ 05: МУЛЬТИМОДАЛЬНІСТЬ', '', 'Розділ 1. Вхід — PNG, JPEG, WEBP, PDF', 'Розділ 2. Вихід — синтез мовлення'], 56).save(f'{OUT}/big-1600x1200.png')
page(400, 300, ['TIFF'], 60).save(f'{OUT}/photo.tiff')

pdfmetrics.registerFont(TTFont('DejaVu', FONT))
def pdf(path, pages):
    c = canvas.Canvas(path, pagesize=A4)
    for lines in pages:
        c.setFont('DejaVu', 14)
        y = 800
        for t in lines:
            c.drawString(60, y, t); y -= 24
        c.showPage()
    c.save()
pdf(f'{OUT}/spec-3p.pdf', [
    ['Специфікація харнеса Лаб. 4 — сторінка 1', 'Вимоги до середовища:', 'Node.js версії 22.13 або новішої.', 'Менеджер пакетів: npm 10.'],
    ['Специфікація — сторінка 2', 'Ролі: читач, звідник, верифікатор.', 'Читач не має інструментів запису.'],
    ['Специфікація — сторінка 3', 'Параметри за замовчуванням:', 'Таймаут запиту за замовчуванням — 45 секунд.', 'Кількість гілок — 4.'],
])

def noisy_pdf(path, pages):
    """Сторінки з випадковим шумом не стискаються: ≈ 1,34 МБ на сторінку (вимір 25.11.2026)."""
    c = canvas.Canvas(path, pagesize=A4)
    for n in range(pages):
        p = os.path.join(tempfile.gettempdir(), f'_noise_{n}.png')
        Image.effect_noise((900, 900), 120).convert('RGB').save(p)
        c.drawImage(p, 40, 100, 500, 500); c.setFont('DejaVu', 14); c.drawString(60, 800, f'Скан, сторінка {n + 1}'); c.showPage()
    c.save()
noisy_pdf(f'{OUT}/scan-6mb.pdf', 5)   # > 4,5 MB тіла функції — 413 від ПЛАТФОРМИ
noisy_pdf(f'{OUT}/scan-4mb.pdf', 3)   # між 3 MB (мій ліміт) і 4,5 MB — МОЯ відмова на сервері

open(f'{OUT}/tts-roundtrip.txt', 'w', encoding='utf-8').write('The harness answers questions about the forked repository with verified citations.')
open(f'{OUT}/ua-text.txt', 'w', encoding='utf-8').write('Харнес відповідає на питання про чужий репозиторій і перевіряє кожну цитату.')
for f in sorted(os.listdir(OUT)):
    print(f'{os.path.getsize(f"{OUT}/{f}"):>10}  {f}')
