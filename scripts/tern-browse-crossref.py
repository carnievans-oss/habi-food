#!/usr/bin/env python3
"""
Cross-reference Habi-Food's browse lists against TERN EcoPlots occurrence data.

Answers one question: of the plants Habi-Food tells carers to collect, which are
actually recorded growing in Victoria by the TERN plot network, and where?

    export TERN_API_KEY=...
    python3 scripts/tern-browse-crossref.py --fetch --cache tern-vic.ndjson
    python3 scripts/tern-browse-crossref.py --offline tern-vic.ndjson --out report.md

Fetch once into a cache, then re-run the analysis offline as often as you like —
the API is somebody else's server and the data changes on the order of seasons,
not minutes.

The browse list is read from the app's own domain data (mobile-dist/js/domain.js,
generated from index.html), so this can never drift from what the app ships.

NOTE ON THE RESPONSE SCHEMA: the exact field names TERN returns for a taxon
record are read tolerantly rather than assumed — see extract_record(). Run with
--dump-keys first to see the real shape of your data and confirm the right
fields are being picked up.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

API_HOST = "ecoplots.tern.org.au"
API_PATH = "/api/v1.0/taxon?dformat=ndjson"

# Victoria, ASGS Ed3 State/Territory code 2.
REGION_TYPE = "https://linked.data.gov.au/dataset/asgsed3/STE"
REGION = "https://linked.data.gov.au/dataset/asgsed3/STE/2"
DATASET = "http://linked.data.gov.au/dataset/ausplots-forest"

FEATURE_TYPES = [
    "http://linked.data.gov.au/def/tern-cv/b311c0d3-4a1a-4932-a39c-f5cdc1afa611",
    "http://linked.data.gov.au/def/tern-cv/60d7edf8-98c6-43e9-841c-e176c334d270",
    "http://linked.data.gov.au/def/tern-cv/2e122e23-881c-43fa-a921-a8745f016ceb",
    "http://linked.data.gov.au/def/tern-cv/ea3a4c64-dac3-4660-809a-8ad5ced8997b",
    "http://linked.data.gov.au/def/tern-cv/ae71c3f6-d430-400f-a1d4-97a333b4ee02",
    "http://linked.data.gov.au/def/tern-cv/45a73139-f6bf-47b7-88d4-4b2865755545",
    "http://linked.data.gov.au/def/tern-cv/32834f36-a478-45be-97f4-ff2ff51e9f5c",
    "http://linked.data.gov.au/def/tern-cv/aef12cd6-3826-4988-a54c-8578d3fb4c8d",
]

# Victoria's actual extent. The region filter above already constrains the query;
# this is belt and braces, and unlike a 91°E–180°E box it contains no invalid
# longitudes and no ocean.
VIC_BBOX = [
    [140.96, -33.98],
    [150.02, -33.98],
    [150.02, -39.20],
    [140.96, -39.20],
    [140.96, -33.98],
]


# ── Reading the browse list ─────────────────────────────────────────

# Emoji category prefixes used by the food lists in index.html.
CATEGORY = {
    "🌿": "plant", "🌸": "plant", "🍎": "plant", "🌲": "plant", "🌱": "plant",
    "🍄": "fungus", "🪲": "invertebrate",
}

# Second words that look like a Latin epithet but are English nouns: "Acacia
# gum", "Eucalyptus bark", "Banksia flowers".
NOT_EPITHET = {
    "species", "spp", "sp", "browse", "gum", "sap", "manna", "bark", "shrub",
    "shrubs", "flowers", "flower", "leaves", "leaf", "nectar", "seed", "seeds",
    "pollen", "fruit", "fruits", "berries", "foliage", "cambium", "blossom",
    "tips", "phyllodes", "exudate", "and", "or", "from", "mix", "grass",
    "grasses", "trees", "tree", "larvae", "adults", "crown", "heartwood",
    "pods", "roots", "tubers", "honeydew", "resin", "lerp", "mammals", "eggs",
    "insects", "worms", "supplement", "minerals",
}

# Leading words that introduce a description, not a genus.
NOT_GENUS = {
    "Small", "Native", "Live", "Fresh", "Wild", "Young", "Mixed", "Various",
    "Commercial", "Insects", "Earthworms", "Soil", "Bark", "Mosses", "Lerp",
    "Honeydew", "Wombaroo", "Invertebrate", "Insect", "Freshwater", "Aquatic",
    "Terrestrial", "Underground", "Surface", "Ground", "Leaf", "Plant",
}

# Genera that are animals, named in food entries that carry no emoji category
# (the stage lists). Without these, "Honeydew (Spondyliaspis, Ctenarytaina)"
# leaves two psyllid genera sitting in the plant column.
INVERTEBRATE_GENERA = {
    "ctenarytaina", "spondyliaspis", "camponotus", "polyrhachis", "iridomyrmex",
    "nasutitermes", "schedorhinotermes", "coptotermes", "oligochaeta",
    "lumbricus", "armadillidium", "gryllodes",
}

RE_BINOMIAL = re.compile(r"^([A-Z][a-z]{2,})\s+([a-z][a-z-]{2,})\b")
RE_GENUS_ONLY = re.compile(r"^([A-Z][a-z]{2,})\s+(?:species|spp\.?|sp\.?)\b")
RE_PAREN_GENERA = re.compile(r"\(([^)]*)\)")


def load_domain():
    """Dump the app's domain constants to JSON via node."""
    script = """
    global.window = {};
    require(process.argv[1]);
    const d = window.HF_DOMAIN;
    const norm = v => {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') {
        try { const p = JSON.parse(v); return Array.isArray(p) ? p : [v]; }
        catch (e) { return [v]; }
      }
      return [];
    };
    // needs{} is keyed by species id, food[] hangs off the species record —
    // resolve both to the display name so one animal is one label.
    const nameOf = {};
    d.SPECIES.forEach(s => { nameOf[s.id] = s.name; });
    const rows = [];
    d.SPECIES.forEach(s => (s.food || []).forEach(f =>
      rows.push({ source: 'diet', animal: s.name, text: f })));
    Object.entries(d.BROWSE_STAGES).forEach(([stage, st]) =>
      Object.entries(st.needs || {}).forEach(([sp, v]) =>
        norm(v).forEach(n => rows.push({
          source: 'stage:' + stage, animal: nameOf[sp] || sp, text: n }))));
    console.log(JSON.stringify(rows));
    """
    domain = os.path.join(ROOT, "mobile-dist", "js", "domain.js")
    if not os.path.exists(domain):
        sys.exit(f"not found: {domain}\nRun `npm run mobile:domain` first.")
    try:
        out = subprocess.run(
            ["node", "-e", script, domain],
            capture_output=True, text=True, check=True,
        )
    except FileNotFoundError:
        sys.exit("node is required to read the app's domain data (it generates domain.js too).")
    except subprocess.CalledProcessError as e:
        sys.exit(f"could not read domain data:\n{e.stderr}")
    return json.loads(out.stdout)


def normalise(name):
    """'Eucalyptus viminalis subsp. cygnetensis Boomsma' -> 'eucalyptus viminalis'."""
    n = re.sub(r"\s+", " ", name.strip())
    n = re.sub(r"\b(subsp|ssp|var|f|forma|cv)\.?\s+\S+", "", n, flags=re.I)
    n = re.sub(r"\s*\([^)]*\)", "", n)          # authority in parentheses
    n = re.sub(r"\s+[A-Z][\w.'-]*$", "", n)      # trailing authority
    parts = n.split()
    if len(parts) >= 2:
        return f"{parts[0].lower()} {parts[1].lower()}"
    return parts[0].lower() if parts else ""


def extract_browse_taxa(rows):
    """
    Pull taxon names out of the free-text food entries.

    Returns (taxa, skipped). `taxa` maps a normalised name to what we know about
    it; `skipped` records every entry we could not turn into a name, with a
    reason, so nothing is silently dropped.
    """
    taxa = {}
    skipped = []

    def add(name, rank, kind, row, via):
        key = normalise(name)
        if not key:
            return
        if key.split()[0] in INVERTEBRATE_GENERA:
            kind = "invertebrate"
        entry = taxa.setdefault(key, {
            "display": name, "rank": rank, "kind": kind,
            "animals": set(), "sources": set(), "via": via,
        })
        entry["animals"].add(row["animal"])
        entry["sources"].add(row["source"])
        if kind != "unknown":
            entry["kind"] = kind

    # Genus -> kind, learned from the entries that carry an emoji category, so
    # the stage lists (which have no emoji) can be classified from the diet lists.
    genus_kind = {}
    for row in rows:
        raw = row["text"].strip()
        kind = CATEGORY.get(raw[:1])
        if not kind:
            continue
        text = re.sub(r"^[^\w]+", "", raw)
        m = RE_BINOMIAL.match(text) or RE_GENUS_ONLY.match(text)
        if m and m.group(1) not in NOT_GENUS:
            genus_kind.setdefault(m.group(1).lower(), kind)

    for row in rows:
        raw = row["text"].strip()
        kind = CATEGORY.get(raw[:1], "unknown")
        text = re.sub(r"^[^\w]+", "", raw)

        g = RE_GENUS_ONLY.match(text)
        if g and g.group(1) not in NOT_GENUS:
            genus = g.group(1)
            add(genus, "genus", kind if kind != "unknown"
                else genus_kind.get(genus.lower(), "unknown"), row, "named")
            continue

        m = RE_BINOMIAL.match(text)
        if m and m.group(1) not in NOT_GENUS and m.group(2) not in NOT_EPITHET:
            genus = m.group(1)
            add(f"{genus} {m.group(2)}", "species", kind if kind != "unknown"
                else genus_kind.get(genus.lower(), "unknown"), row, "named")
            continue

        # Entries like "Native tubers (Bulbine, Dichopogon)" carry their genera
        # in the parenthetical instead of the lead.
        harvested = False
        for paren in RE_PAREN_GENERA.findall(text):
            names = [p.strip() for p in re.split(r"[,;]", paren)]
            for n in names:
                n = re.sub(r"\s+(spp?\.?|species)$", "", n).strip()
                if re.fullmatch(r"[A-Z][a-z]{2,}", n) and n not in NOT_GENUS:
                    add(n, "genus", kind if kind != "unknown"
                        else genus_kind.get(n.lower(), "unknown"), row, "inline list")
                    harvested = True
        if harvested:
            continue

        skipped.append({
            "text": raw,
            "animal": row["animal"],
            "kind": kind,
            "reason": "no taxon name in entry"
                      if kind != "invertebrate" else "invertebrate food item",
        })

    for t in taxa.values():
        t["animals"] = sorted(t["animals"])
        t["sources"] = sorted(t["sources"])
    return taxa, skipped


# ── Talking to TERN ─────────────────────────────────────────────────

def build_payload(page, page_size, use_bbox=True):
    query = {
        "region_type": [REGION_TYPE],
        "region": [REGION],
        "dataset": [DATASET],
        "feature_type": FEATURE_TYPES,
    }
    if use_bbox:
        query["spatial"] = {"type": "Polygon", "coordinates": [VIC_BBOX]}
    return {"query": query, "page_number": page, "page_size": page_size}


def fetch(api_key, page_size, max_pages, cache_path, delay, use_bbox=True):
    """Page through the taxon endpoint, writing ndjson to the cache as we go."""
    import http.client

    records = []
    cache = open(cache_path, "w", encoding="utf-8") if cache_path else None
    conn = http.client.HTTPSConnection(API_HOST, timeout=120)
    headers = {"X-Api-Key": api_key, "Content-Type": "application/json"}

    try:
        for page in range(1, max_pages + 1):
            payload = json.dumps(build_payload(page, page_size, use_bbox))
            conn.request("POST", API_PATH, payload, headers)
            res = conn.getresponse()
            body = res.read().decode("utf-8", errors="replace")

            if res.status != 200:
                sys.stderr.write(f"\nHTTP {res.status} on page {page}: {body[:400]}\n")
                if res.status in (401, 403):
                    sys.stderr.write("Check TERN_API_KEY — the endpoint needs a real key.\n")
                break

            page_records = []
            for line in body.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    page_records.append(json.loads(line))
                except json.JSONDecodeError:
                    sys.stderr.write(f"skipped an unparseable ndjson line on page {page}\n")
            if cache:
                for r in page_records:
                    cache.write(json.dumps(r) + "\n")

            records.extend(page_records)
            sys.stderr.write(f"\rpage {page}: {len(page_records)} records "
                             f"({len(records)} total)")
            sys.stderr.flush()

            if len(page_records) < page_size:
                break
            if delay:
                time.sleep(delay)
        sys.stderr.write("\n")
    finally:
        conn.close()
        if cache:
            cache.close()
    return records


def read_ndjson(path):
    records = []
    with open(path, encoding="utf-8") as fh:
        for i, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                sys.stderr.write(f"{path}:{i}: unparseable, skipped\n")
    return records


# ── Reading a record ────────────────────────────────────────────────

NAME_KEYS = ("scientificName", "scientific_name", "taxonName", "taxon_name",
             "acceptedNameUsage", "taxon", "name", "label", "value",
             "verbatimScientificName", "species")
LAT_KEYS = ("latitude", "decimalLatitude", "decimal_latitude", "lat", "y")
LNG_KEYS = ("longitude", "decimalLongitude", "decimal_longitude", "lon",
            "lng", "long", "x")
SITE_KEYS = ("siteID", "site_id", "site", "plotName", "plot_name", "plot",
             "featureOfInterest", "feature_of_interest", "locationID")
DATE_KEYS = ("eventDate", "event_date", "date", "resultTime", "observedAt")


def deep_find(obj, keys, depth=0):
    """First value under any of `keys`, searching nested dicts and lists."""
    if depth > 6:
        return None
    if isinstance(obj, dict):
        for k in keys:
            if k in obj:
                v = obj[k]
                if isinstance(v, (str, int, float)) and str(v).strip():
                    return v
                if isinstance(v, dict):
                    inner = deep_find(v, ("value", "label", "name", "@id"), depth + 1)
                    if inner is not None:
                        return inner
        for v in obj.values():
            found = deep_find(v, keys, depth + 1)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = deep_find(v, keys, depth + 1)
            if found is not None:
                return found
    return None


def extract_record(rec):
    """Best-effort pull of name / coordinates / site / date from one record."""
    name = deep_find(rec, NAME_KEYS)
    lat = deep_find(rec, LAT_KEYS)
    lng = deep_find(rec, LNG_KEYS)

    if lat is None or lng is None:
        geom = deep_find(rec, ("geometry", "geo", "location", "point"))
        coords = None
        if isinstance(geom, dict):
            coords = geom.get("coordinates")
        elif isinstance(rec.get("geometry"), dict):
            coords = rec["geometry"].get("coordinates")
        if isinstance(coords, list) and len(coords) >= 2:
            lng, lat = coords[0], coords[1]   # GeoJSON is lng, lat

    def num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    return {
        "name": str(name).strip() if name else None,
        "lat": num(lat),
        "lng": num(lng),
        "site": deep_find(rec, SITE_KEYS),
        "date": deep_find(rec, DATE_KEYS),
    }


# ── The cross-reference ─────────────────────────────────────────────

def crossref(taxa, records):
    by_species = defaultdict(list)
    by_genus = defaultdict(list)
    unnamed = 0

    for rec in records:
        got = extract_record(rec)
        if not got["name"]:
            unnamed += 1
            continue
        key = normalise(got["name"])
        if not key:
            unnamed += 1
            continue
        by_species[key].append(got)
        by_genus[key.split()[0]].append(got)

    matched, genus_only, absent = [], [], []
    for key, info in sorted(taxa.items()):
        if info["kind"] != "plant":
            continue
        if info["rank"] == "species":
            hits = by_species.get(key, [])
            if hits:
                matched.append((key, info, hits))
                continue
            congeners = by_genus.get(key.split()[0], [])
            if congeners:
                genus_only.append((key, info, congeners))
            else:
                absent.append((key, info))
        else:
            hits = by_genus.get(key.split()[0], [])
            (matched if hits else absent).append(
                (key, info, hits) if hits else (key, info))

    # TERN plants from genera the animals eat, that no Habi-Food list names.
    browse_genera = {k.split()[0] for k, v in taxa.items() if v["kind"] == "plant"}
    listed = {k for k, v in taxa.items() if v["kind"] == "plant" and v["rank"] == "species"}
    candidates = []
    for key, hits in by_species.items():
        genus = key.split()[0]
        if genus in browse_genera and key not in listed and " " in key:
            candidates.append((key, hits))
    candidates.sort(key=lambda x: -len(x[1]))

    return {
        "matched": matched, "genus_only": genus_only, "absent": absent,
        "candidates": candidates, "unnamed": unnamed,
        "tern_taxa": len(by_species),
    }


def bbox_of(hits):
    pts = [(h["lat"], h["lng"]) for h in hits if h["lat"] is not None and h["lng"] is not None]
    if not pts:
        return None
    lats = [p[0] for p in pts]
    lngs = [p[1] for p in pts]
    return (min(lats), max(lats), min(lngs), max(lngs), len(pts))


def sites_of(hits):
    return sorted({str(h["site"]) for h in hits if h["site"]})


def write_report(result, taxa, skipped, records, out):
    w = out.write
    w("# Habi-Food browse list × TERN EcoPlots (AusPlots Forest, Victoria)\n\n")
    w(f"- TERN records read: **{len(records)}**\n")
    w(f"- distinct taxa in those records: **{result['tern_taxa']}**\n")
    plants = sum(1 for v in taxa.values() if v["kind"] == "plant")
    w(f"- plant taxa named across Habi-Food's food and browse-stage lists: **{plants}**\n")
    if result["unnamed"]:
        w(f"- records with no readable taxon name: **{result['unnamed']}** "
          "(run with `--dump-keys` if this is large — the field names may differ)\n")
    w("\n")

    w("## Recorded in Victorian forest plots\n\n")
    if not result["matched"]:
        w("_Nothing matched. If the record count above is non-zero, the taxon "
          "field is probably being read from the wrong key — check `--dump-keys`._\n\n")
    else:
        w("| Browse plant | Listed as | Records | Plots | Latitude range | "
          "Longitude range | Eaten by |\n")
        w("|---|---|---:|---:|---|---|---|\n")
        for key, info, hits in sorted(result["matched"], key=lambda x: -len(x[2])):
            bb = bbox_of(hits)
            span = (f"{bb[0]:.2f} – {bb[1]:.2f}", f"{bb[2]:.2f} – {bb[3]:.2f}") if bb else ("—", "—")
            animals = ", ".join(info["animals"][:3])
            if len(info["animals"]) > 3:
                animals += f" +{len(info['animals']) - 3}"
            rank = "genus" if info["rank"] == "genus" else "species"
            w(f"| _{info['display']}_ | {rank} | {len(hits)} | {len(sites_of(hits))} | "
              f"{span[0]} | {span[1]} | {animals} |\n")
        w("\n")

    w("## Listed species absent, but congeners recorded\n\n")
    w("The exact species is not in the plot data, but other members of its genus "
      "are — worth checking whether the substitute is acceptable browse.\n\n")
    if not result["genus_only"]:
        w("_None._\n\n")
    else:
        for key, info, hits in sorted(result["genus_only"], key=lambda x: -len(x[2])):
            others = sorted({normalise(h["name"]) for h in hits if h["name"]})[:6]
            w(f"- _{info['display']}_ — genus recorded {len(hits)}×, as: "
              + ", ".join(f"_{o}_" for o in others) + "\n")
        w("\n")

    w("## Listed plants with no record in this dataset\n\n")
    w("Absence here means absence *from AusPlots Forest plots in Victoria* — a "
      "sparse research network, not a flora survey. It is not evidence the plant "
      "is not there.\n\n")
    absent = [(k, i) for k, i in result["absent"]]
    if not absent:
        w("_None._\n\n")
    else:
        for key, info in sorted(absent):
            w(f"- _{info['display']}_ ({info['rank']}) — {', '.join(info['animals'][:3])}\n")
        w("\n")

    w("## Recorded plants worth considering\n\n")
    w("Species in the plot data from genera Habi-Food already treats as food, "
      "which no list names. Check palatability before adding anything.\n\n")
    if not result["candidates"]:
        w("_None._\n\n")
    else:
        for key, hits in result["candidates"][:30]:
            w(f"- _{key}_ — {len(hits)} records across {len(sites_of(hits))} plots\n")
        if len(result["candidates"]) > 30:
            w(f"\n_({len(result['candidates']) - 30} more not shown.)_\n")
        w("\n")

    w("## Entries carrying no taxon name\n\n")
    w("Not dropped silently: these food entries name no plant to look up.\n\n")
    by_reason = defaultdict(list)
    for s in skipped:
        by_reason[s["reason"]].append(s)
    for reason, items in sorted(by_reason.items()):
        w(f"**{reason}** — {len(items)} entries\n\n")
        for s in items[:8]:
            w(f"- {s['text'][:90]}\n")
        if len(items) > 8:
            w(f"- _…and {len(items) - 8} more_\n")
        w("\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--fetch", action="store_true", help="query the TERN API")
    src.add_argument("--offline", metavar="FILE", help="read a saved ndjson dump")
    ap.add_argument("--api-key", default=os.environ.get("TERN_API_KEY"),
                    help="TERN API key (or set TERN_API_KEY)")
    ap.add_argument("--cache", metavar="FILE", help="write fetched ndjson here")
    ap.add_argument("--out", metavar="FILE", help="write the report here (default: stdout)")
    ap.add_argument("--json", metavar="FILE", help="also write the raw cross-reference as JSON")
    ap.add_argument("--page-size", type=int, default=500)
    ap.add_argument("--max-pages", type=int, default=200)
    ap.add_argument("--delay", type=float, default=0.3, help="seconds between pages")
    ap.add_argument("--no-bbox", action="store_true",
                    help="omit the spatial filter (the region filter already scopes to Victoria)")
    ap.add_argument("--dump-keys", type=int, metavar="N", default=0,
                    help="print the structure of the first N records and exit")
    args = ap.parse_args()

    if args.fetch and not args.api_key:
        sys.exit("no API key: pass --api-key or set TERN_API_KEY")

    if args.fetch:
        records = fetch(args.api_key, args.page_size, args.max_pages,
                        args.cache, args.delay, use_bbox=not args.no_bbox)
    else:
        records = read_ndjson(args.offline)

    if not records:
        sys.exit("no records — nothing to cross-reference")

    if args.dump_keys:
        for rec in records[:args.dump_keys]:
            print(json.dumps(rec, indent=2)[:2000])
            print("-" * 60)
            print("read as:", json.dumps(extract_record(rec)))
            print("=" * 60)
        return

    rows = load_domain()
    taxa, skipped = extract_browse_taxa(rows)
    result = crossref(taxa, records)

    out = open(args.out, "w", encoding="utf-8") if args.out else sys.stdout
    try:
        write_report(result, taxa, skipped, records, out)
    finally:
        if args.out:
            out.close()
            print(f"report written to {args.out}", file=sys.stderr)

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({
                "matched": [{"taxon": k, "display": i["display"], "records": len(h),
                             "plots": sites_of(h), "animals": i["animals"]}
                            for k, i, h in result["matched"]],
                "genus_only": [{"taxon": k, "records": len(h)} for k, i, h in result["genus_only"]],
                "absent": [{"taxon": k, "display": i["display"]} for k, i in result["absent"]],
                "candidates": [{"taxon": k, "records": len(h)} for k, h in result["candidates"]],
            }, fh, indent=2)
        print(f"json written to {args.json}", file=sys.stderr)


if __name__ == "__main__":
    main()
