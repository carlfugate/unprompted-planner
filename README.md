# [un]prompted planner

Unofficial, mobile-first schedule browser and planner for
[[un]prompted](https://unpromptedcon.org/), October 27-29, 2026, San Francisco.

**Live:** https://carlfugate.github.io/unprompted-planner/

- Agenda by day, interleaved across Stage 1, Stage 2, Workshops and Villages
  (list on phones, timeline grid on wide screens)
- Search titles, speakers, companies and abstracts; filter by track
- Star talks into **My plan**, with clash warnings and free gaps
- **Now** view: what's live, what's next, what's next in your plan
- Export one talk, a day, or the whole plan to `.ics`
- Installable PWA; works offline once loaded

Starred talks are stored in your browser's `localStorage` only.

## Data

`scraper/scrape.py` reads the WordPress pages
[`/agenda-10-2026/`](https://unpromptedcon.org/agenda-10-2026/) and
[`/workshops/`](https://unpromptedcon.org/workshops/) and writes `data/talks.json`.
A GitHub Action runs it hourly, skips when the pages' `modified_gmt` hasn't
changed, and redeploys GitHub Pages when the data does change.

The scraper depends on the site's Divi markup. If the organisers rebuild the
page it will fail loudly (it refuses to write fewer than 10 sessions) rather
than publish an empty schedule.

```bash
python3 -m venv .venv && .venv/bin/pip install beautifulsoup4
.venv/bin/python scraper/scrape.py --force
python3 -m http.server 8000 --bind 127.0.0.1
```

Not affiliated with [un]prompted. The agenda is subject to change; check the
official site.
