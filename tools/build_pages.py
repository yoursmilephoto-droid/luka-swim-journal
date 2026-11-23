"""Build the static journal and one share page per confirmed result."""
import argparse
import html
import json
import re
import shutil
from datetime import date
from pathlib import Path
from urllib.parse import quote

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://yoursmilephoto-droid.github.io/luka-swim-journal/"
STYLES = {
    "free": "Вольный стиль",
    "back": "На спине",
    "breast": "Брасс",
    "fly": "Баттерфляй",
    "medley": "Комплекс",
}


def time_label(value, precision=2):
    minutes, rest = divmod(value, 6000)
    seconds = f"{rest / 100:.{precision}f}".replace(".", ",")
    return f"{minutes}:{seconds.zfill(3 + precision)}" if minutes else f"{seconds} с"


def pool_lengths(row):
    pool = row.get("pool")
    if not pool or row["distance"] % pool:
        return ""
    count = row["distance"] // pool
    last = count % 10
    unit = "длин"
    if not 11 <= count % 100 <= 14:
        if last == 1:
            unit = "длина"
        elif 2 <= last <= 4:
            unit = "длины"
    return f"{count} {unit} бассейна по {pool} м"


def fonts(bold):
    candidates = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold
        else "/System/Library/Fonts/Supplemental/Arial.ttf",
    )
    return next(path for path in candidates if Path(path).is_file())


def preview(photo, path, title, result, date_label, event_label, lengths):
    image = Image.new("RGB", (1200, 630), "#102633")
    crop = ImageOps.fit(photo, (655, 630), centering=(0.06, 0.60))
    fade = Image.linear_gradient("L").rotate(-90, expand=True).resize(crop.size)
    opacity = fade.point([round(255 * (1 - value / 255) ** 0.65) for value in range(256)])
    image.paste(crop, (545, 0), opacity)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((56, 50, 1144, 580), radius=32, outline="#9ac4dc", width=2)
    bold, regular = fonts(True), fonts(False)
    draw.text((92, 95), "Дневник Луки", font=ImageFont.truetype(bold, 30), fill="#d2e9f4")
    draw.text((92, 232), title, font=ImageFont.truetype(bold, 31), fill="#ffffff")
    result_font = ImageFont.truetype(bold, 101)
    while draw.textlength(result, font=result_font) > 515:
        result_font = ImageFont.truetype(bold, result_font.size - 4)
    draw.text((84, 277), result, font=result_font, fill="#ffffff")
    draw.text((93, 449), f"{date_label} · {event_label}", font=ImageFont.truetype(regular, 25), fill="#d2e9f4")
    if lengths:
        draw.text((93, 497), lengths, font=ImageFont.truetype(bold, 26), fill="#ffffff")
    image.save(path, quality=87, optimize=True)


def render(row, output, photo):
    identifier = row["id"]
    if not re.fullmatch(r"[a-z0-9-]+", identifier):
        raise ValueError(f"Invalid result ID: {identifier}")
    path = output / "swims" / identifier
    path.mkdir(parents=True)
    url = f"{BASE}swims/{identifier}/"
    discipline = f"{row['distance']} м · {STYLES[row['style']]}"
    result = time_label(row["time"], row.get("precision", 2))
    day = date.fromisoformat(row["date"]).strftime("%d.%m.%Y")
    event = row.get("event") or "Подтверждённый заплыв"
    kind = "Курсовка" if event == "Курсовка" else "Соревнования"
    headline = f"{discipline} — {result}"
    lengths = pool_lengths(row)
    description = " · ".join(part for part in ("Лука", day, event, lengths) if part)
    message = "\n".join(part for part in (f"🏊 Лука · {headline} ({day})", lengths, url) if part)
    share = "https://max.ru/:share?text=" + quote(message, safe="")
    preview(photo, path / "preview.jpg", discipline, result, day, kind, lengths)

    facts = [("Заплыв", event)]
    if lengths:
        facts.append(("Дистанция в бассейне", lengths))
    elif row.get("pool"):
        facts.append(("Бассейн", f"{row['pool']} м"))
    if row["distance"] >= 200:
        facts.append(("Средний темп на 100 м", time_label(round(row["time"] * 100 / row["distance"]))))
    if row.get("place"):
        facts.append(("Место", str(row["place"])))
    e = html.escape
    fact_html = "".join(f"<div><dt>{e(name)}</dt><dd>{e(value)}</dd></div>" for name, value in facts)
    source = e(row.get("source") or "")
    source_url = row.get("sourceUrl") or ""
    if re.fullmatch(r"https://www\.goswim\.ru/competitions/\d+", source_url):
        source = f'<a href="{e(source_url)}">{source}</a>'
    source_html = f'<p class="swim-source">Источник · {source}</p>' if source else ""
    (path / "index.html").write_text(f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f7f7f5">
<title>{e(headline)} · Дневник Луки</title>
<meta name="description" content="{e(description)}">
<link rel="canonical" href="{url}">
<link rel="stylesheet" href="../../style.css?v=lengths">
<meta property="og:type" content="website">
<meta property="og:title" content="{e(headline)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{url}preview.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{e('Лука · ' + headline)}">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
<main class="wrap swim-layout">
  <a class="swim-back" href="../../#recent-title">← К дневнику Луки</a>
  <article class="swim-card">
    <header class="swim-hero">
      <img src="../../luka-swim.webp" alt="">
      <p class="swim-date"><time datetime="{row['date']}">{day}</time></p>
      <h1>{e(discipline)}</h1>
      <strong class="swim-time">{e(result)}</strong>
    </header>
    <div class="swim-detail">
      <dl class="swim-facts">{fact_html}</dl>
      {source_html}
      <div class="share-actions"><a class="primary" href="{e(share)}">Поделиться в MAX ↗</a></div>
    </div>
  </article>
</main>
</body>
</html>
""", encoding="utf-8")


def build(output):
    output.mkdir(parents=True, exist_ok=True)
    for name in ("index.html", "app.js", "stories.js", "style.css", "starts.json", "luka-swim.webp"):
        shutil.copy2(ROOT / name, output)
    shutil.copytree(ROOT / "media", output / "media")
    rows = json.loads((ROOT / "starts.json").read_text(encoding="utf-8"))
    with Image.open(ROOT / "luka-swim.webp") as original:
        photo = original.convert("RGB")
    for row in rows:
        if row["status"] == "verified" and row["time"] is not None:
            render(row, output, photo)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    build(parser.parse_args().output)
