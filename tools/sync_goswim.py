#!/usr/bin/env python3
"""Append new public GoSwim results for Luka to the published journal."""
import argparse
import json
import re
from collections import Counter
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

BASE_URL = "https://www.goswim.ru"
PROFILE = "/athletes/340953"
NAME = "Лозовой Лука"
BIRTH_YEAR = "2017"
HEADERS = ("Дата", "Соревнование", "Дистанция", "Время", "Место", "AQUA")
STYLES = {"в/стиль": "free", "брасс": "breast", "н/спине": "back",
          "батт.": "fly", "компл.": "medley"}
JOURNAL = Path(__file__).resolve().parents[1] / "starts.json"


class GoSwimPage(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.title = []
        self.heading = []
        self.canonical = ""
        self.tables = []
        self.table = self.row = self.cell = None
        self.text_target = None
        self.meet_metadata = []
        self.in_meet_metadata = False
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonical = attrs.get("href", "")
        if tag in ("title", "h1"):
            self.text_target = self.title if tag == "title" else self.heading
        if tag == "div" and "dh-meta" in attrs.get("class", "").split():
            self.in_meet_metadata = True
        if tag == "table":
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = ([], [])
        elif tag == "a" and self.cell is not None:
            self.cell[1].append(attrs.get("href", ""))

    def handle_data(self, data):
        if self.text_target is not None:
            self.text_target.append(data)
        if self.in_meet_metadata and data.strip():
            self.meet_metadata.append(data.strip())
        if self.cell is not None:
            self.cell[0].append(data)

    def handle_endtag(self, tag):
        if tag in ("title", "h1"):
            self.text_target = None
        if tag == "div" and self.in_meet_metadata:
            self.in_meet_metadata = False
        if tag in ("td", "th") and self.cell is not None:
            self.row.append((" ".join("".join(self.cell[0]).split()), self.cell[1]))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def fetch(path):
    request = Request(BASE_URL + path, headers={"User-Agent": "LukaSwimJournal/1.0",
                                                "Accept": "text/html"})
    with urlopen(request, timeout=20) as response:
        document = response.read(2_000_001)
        if len(document) > 2_000_000:
            raise ValueError("Unexpectedly large GoSwim response")
        return document.decode("utf-8")


def swim_time(value):
    match = re.fullmatch(r"(\d{1,2}):([0-5]\d)[.,](\d{2})", value)
    if not match:
        raise ValueError(f"Unrecognized GoSwim result: {value}")
    minutes, seconds, hundredths = map(int, match.groups())
    return minutes * 6000 + seconds * 100 + hundredths


def portal_results(source):
    page = GoSwimPage(source)
    if (urlsplit(page.canonical).path != PROFILE or "".join(page.heading).strip() != NAME
            or f"({BIRTH_YEAR})" not in "".join(page.title)):
        raise ValueError("GoSwim profile identity did not match")
    tables = [t for t in page.tables if t and tuple(cell[0] for cell in t[0]) == HEADERS]
    if len(tables) != 1 or len(tables[0]) < 2:
        raise ValueError("GoSwim start history table is missing or changed")
    skipped = 0
    results = []
    for cells in tables[0][1:]:
        if len(cells) != 6:
            raise ValueError("Unexpected number of GoSwim result columns")
        start_date, event, discipline, value, rank, points = (c[0] for c in cells)
        if value in {"DNS", "DNF", "NS", "—"}:
            skipped += 1
            continue
        discipline_match = re.fullmatch(r"(\d+),\s*(.+)", discipline)
        meet = next((href for href in cells[1][1] if re.fullmatch(r"/competitions/\d+", href)), None)
        if not discipline_match or not meet or discipline_match[2] not in STYLES:
            skipped += 1
            continue
        iso_date = datetime.strptime(start_date, "%d.%m.%Y").date().isoformat()
        distance = int(discipline_match[1])
        style = STYLES[discipline_match[2]]
        status = "dq" if value == "DSQ" else "verified"
        result = {
            "id": f"goswim-{meet.split('/')[-1]}-{iso_date}-{distance}-{style}",
            "date": iso_date, "distance": distance, "style": style,
            "time": None if status == "dq" else swim_time(value),
            "pool": None, "status": status, "event": event,
            "source": f"GoSwim · история стартов и результаты № {meet.split('/')[-1]}",
            "sourceUrl": BASE_URL + meet,
            "note": "Дата указана по истории стартов на GoSwim."
        }
        if rank.isdecimal():
            result["place"] = int(rank)
        elif re.fullmatch(r"(?:I|II|III) \(ю\)|I|II|III|КМС|МС|МСМК", rank):
            result["rank"] = rank.replace(" (ю)", " юн.")
        if points.isdecimal() and int(points) > 0:
            result["points"] = int(points)
        results.append((meet, result))
    return results, skipped


def existing_result(result, journal):
    for saved in journal:
        if (result["distance"], result["style"]) != (saved["distance"], saved["style"]):
            continue
        if result["id"] == saved["id"] or result["date"] == saved["date"]:
            return True
        # GoSwim may use the opening date for both days of one meet.
        if (not saved["id"].startswith("goswim-") and result["status"] == "verified"
                and result["time"] == saved["time"]
                and abs((date.fromisoformat(result["date"]) - date.fromisoformat(saved["date"])).days) == 1):
            return True
    return False


def pool_length(path):
    page = GoSwimPage(fetch(path))
    if urlsplit(page.canonical).path != path:
        raise ValueError("GoSwim returned an unexpected competition page")
    return next((int(m[1]) for entry in page.meet_metadata
                 if (m := re.fullmatch(r"(25|50)\s*м", entry))), None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Verify without writing starts.json")
    parser.add_argument("--profile-html", type=Path, help="Use a saved GoSwim page without network requests")
    args = parser.parse_args()
    source = args.profile_html.read_text(encoding="utf-8") if args.profile_html else fetch(PROFILE)
    results, skipped = portal_results(source)
    journal = json.loads(JOURNAL.read_text(encoding="utf-8"))
    frequencies = Counter(row["id"] for _, row in results)
    additions = []
    pools = {}
    for meet, result in results:
        if frequencies[result["id"]] > 1:
            skipped += 1
            continue
        if existing_result(result, journal + additions):
            continue
        if not args.profile_html:
            if meet not in pools:
                pools[meet] = pool_length(meet)
            result["pool"] = pools[meet]
        additions.append(result)
    print(f"GoSwim: {len(results)} результатов, новых {len(additions)}, пропущено {skipped}.")
    for row in additions:
        print(row["date"], row["distance"], row["style"], row["sourceUrl"])
    if additions and not args.dry_run:
        output = sorted(journal + additions, key=lambda row: row["date"])
        payload = "[\n" + ",\n".join("  " + json.dumps(row, ensure_ascii=False, separators=(",", ":"))
                                    for row in output) + "\n]\n"
        tmp = JOURNAL.with_suffix(".tmp")
        tmp.write_text(payload, encoding="utf-8")
        tmp.replace(JOURNAL)


if __name__ == "__main__":
    main()
