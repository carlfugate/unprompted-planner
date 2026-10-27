"""Scrape the [un]prompted agenda page into data/talks.json.

Usage: python3 scraper/scrape.py [--html local.html]
Exits 0 and leaves talks.json untouched when the page's WordPress
`modified` timestamp matches the one already recorded.
"""
import argparse
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString

SITE = "https://unpromptedcon.org"
SLUG = "agenda-10-2026"
WS_SLUG = "workshops"
WORKSHOP_REG = "https://luma.com/unprompted-workshops"
TRACK_ORDER = {"Stage 1": 0, "Stage 2": 1, "Workshops": 2, "Villages": 3}
DAY_DATES = ["2026-10-27", "2026-10-28", "2026-10-29"]
OUT = Path(__file__).resolve().parent.parent / "data" / "talks.json"
UA = {"User-Agent": "unprompted-planner (+https://carlfugate.github.io/unprompted-planner/)"}
BREAK_RE = re.compile(r"\b(break|lunch|mingling|move between rooms|registration|gathering)\b", re.I)
TIME_RE = re.compile(r"(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})")


def get(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def page_modified() -> str:
    """Latest WordPress modified_gmt across the agenda and workshops pages."""
    data = json.loads(get(f"{SITE}/wp-json/wp/v2/pages?slug={SLUG},{WS_SLUG}&_fields=modified_gmt"))
    return max(d["modified_gmt"] for d in data) + "Z"


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def parse(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    tabs = soup.select_one("div.et_pb_tabs.Agenda-Schedule") or soup.select_one("div.et_pb_tabs")
    if tabs is None:
        raise SystemExit("agenda tabs not found - page markup changed")
    talks = []
    for day_idx, tab in enumerate(tabs.select("div.et_pb_all_tabs > div.et_pb_tab")):
        date = DAY_DATES[day_idx] if day_idx < len(DAY_DATES) else None
        for stage in tab.select("div.stages"):
            h = stage.find("h2")
            track = clean(h.get_text()) if h else "Unknown"
            current = None
            for tr in stage.select("tr"):
                tds = tr.find_all("td", recursive=False)
                if len(tds) == 1 and "desc" in (tds[0].get("class") or []):
                    if current is not None:
                        current["abstract"] = clean(tds[0].get_text(" "))
                    continue
                if len(tds) < 2:
                    continue
                m = TIME_RE.search(tds[0].get_text())
                if not m:
                    continue
                cell = tds[1]
                speakers = []
                for sp in cell.select("div.speaker-part"):
                    name_el = sp.select_one("span.speaker")
                    name = clean(name_el.get_text()) if name_el else clean(sp.get_text())
                    full = clean(sp.get_text(" "))
                    affil = clean(full[len(name):].lstrip(" ,")) if full.startswith(name) else ""
                    if name:
                        speakers.append({"name": name, "affiliation": affil})
                    sp.decompose()
                strong = cell.find("strong")
                src = strong if strong else cell
                # Villages put a subtitle after a <br> inside the title <strong>
                parts = [clean(p) for p in src.get_text("\n").split("\n") if clean(p)]
                title = parts[0] if parts else ""
                subtitle = " ".join(parts[1:])
                start, end = (t.zfill(5) for t in m.groups())
                is_break = not speakers and bool(BREAK_RE.search(title))
                key = f"{date}|{track}|{start}|{title}"
                current = {
                    "id": hashlib.sha1(key.encode()).hexdigest()[:10],
                    "day": day_idx + 1,
                    "date": date,
                    "track": track,
                    "start": start,
                    "end": end,
                    "title": title,
                    "speakers": speakers,
                    "abstract": subtitle,
                    "kind": "break" if is_break else ("village" if track == "Villages" else "session"),
                }
                talks.append(current)
    return talks


def to24(t: str) -> str:
    """'10:15a' / '1:45p' -> '10:15' / '13:45'."""
    m = re.fullmatch(r"(\d{1,2}):(\d{2})([ap])", t.strip().lower())
    if not m:
        raise ValueError(t)
    h = int(m.group(1)) % 12 + (12 if m.group(3) == "p" else 0)
    return f"{h:02d}:{m.group(2)}"


def in_colored_span(node, stop) -> bool:
    p = node.parent
    while p is not None and p is not stop:
        if p.name == "span" and "color" in (p.get("style") or ""):
            return True
        p = p.parent
    return False


def parse_workshops(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    slots = {}
    for btn in soup.select("button.agenda-tab-btn[data-agenda-tab]"):
        sub = btn.select_one(".day-sub-title")
        m = re.match(r"\s*([\d:]+[ap])\s*-\s*([\d:]+[ap])", sub.get_text() if sub else "")
        if m:
            slots[btn["data-agenda-tab"]] = (to24(m.group(1)), to24(m.group(2)))
    out = []
    for slot_id, (start, end) in slots.items():
        day = int(re.match(r"day(\d)", slot_id).group(1))
        date = DAY_DATES[day - 1]
        box = soup.find(id=slot_id)
        if box is None:
            continue
        # Each workshop = header text module followed by a "Read more" toggle.
        for toggle in box.select("div.et_pb_toggle"):
            text_mod = toggle.find_previous_sibling("div", class_="et_pb_text")
            if text_mod is None:
                continue
            title, speakers, tail = None, [], []
            for n in text_mod.descendants:
                if not isinstance(n, NavigableString):
                    continue
                x = clean(str(n))
                if not x:
                    continue
                if title is None:
                    title = x
                elif tail or x.startswith("Summary"):
                    tail.append(x)
                elif in_colored_span(n, text_mod):  # speaker names are highlighted
                    speakers.append({"name": x.rstrip(" ,"), "affiliation": ""})
                elif speakers:
                    speakers[-1]["affiliation"] = clean(speakers[-1]["affiliation"] + " " + x)
            for s in speakers:
                s["affiliation"] = s["affiliation"].strip(" ,")
            info = " ".join(tail)
            sm = re.search(r"Summary:\s*(.*?)(?:Level:|$)", info)
            lv = re.search(r"Level:\s*(.+)$", info)
            content = toggle.select_one(".et_pb_toggle_content")
            details = clean(content.get_text(" ")) if content else ""
            out.append({
                "id": hashlib.sha1(f"{date}|Workshops|{start}|{title}".encode()).hexdigest()[:10],
                "day": day,
                "date": date,
                "track": "Workshops",
                "start": start,
                "end": end,
                "title": title,
                "speakers": speakers,
                "abstract": clean(sm.group(1)) if sm else info,
                "details": details,
                "level": clean(lv.group(1)) if lv else "",
                "register": WORKSHOP_REG,
                "kind": "workshop",
            })
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    modified = page_modified()
    if OUT.exists() and not a.force:
        if json.loads(OUT.read_text()).get("source_modified") == modified:
            print(f"unchanged ({modified})")
            return 0
    talks = parse(get(f"{SITE}/{SLUG}/")) + parse_workshops(get(f"{SITE}/{WS_SLUG}/"))
    if len([t for t in talks if t["kind"] == "session"]) < 10:
        print(f"refusing to write: only {len(talks)} rows parsed", file=sys.stderr)
        return 1
    talks.sort(key=lambda t: (t["day"], t["start"], TRACK_ORDER.get(t["track"], 9)))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({
        "source": f"{SITE}/{SLUG}/",
        "source_modified": modified,
        "days": DAY_DATES,
        "talks": talks,
    }, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {len(talks)} rows ({modified})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
