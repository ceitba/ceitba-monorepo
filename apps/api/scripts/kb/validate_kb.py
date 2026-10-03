"""Local mirror of the import validator in docs/SUBJECT-WIKI.md.

Usage: python3 validate_kb.py <kb-output-dir> [subjectId ...]
Reads source texts from ./kb-input/<subject>/. Exit code 1 if any page is rejected.
"""
import json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.abspath(__file__))
INPUT = os.path.join(ROOT, "kb-input")
SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
LINK = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]")
REQUIRED = ["title", "subject", "type", "summary", "sources", "generator", "generated_at"]


def norm_words(s):
    s = unicodedata.normalize("NFC", s.lower())
    return re.findall(r"\w+", s)


def anchor_of(heading):
    h = "".join(c for c in unicodedata.normalize("NFD", heading.lower()) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", h).strip("-")


HEADINGS = {}


def headings(subj, slug, out_dir):
    key = (subj, slug)
    if key not in HEADINGS:
        p = os.path.join(out_dir, subj, slug + ".md")
        HEADINGS[key] = {anchor_of(h) for h in re.findall(r"(?m)^#{2,4} (.+)$", open(p, encoding="utf-8").read())} if os.path.exists(p) else set()
    return HEADINGS[key]


def parse(path):
    raw = open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", raw, re.S)
    if not m:
        return None, raw, ["missing frontmatter"]
    fm, errors = {}, []
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        k, _, v = line.partition(":")
        v = re.sub(r"\s+#.*$", "", v.strip())
        if v.startswith("[") and v.endswith("]"):
            fm[k.strip()] = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
        else:
            fm[k.strip()] = v.strip("'\"")
    return fm, m.group(2), errors


def main():
    out_dir = sys.argv[1]
    only = set(sys.argv[2:])
    all_pages = {}  # (subject, slug) -> title
    for subj in sorted(os.listdir(out_dir)):
        d = os.path.join(out_dir, subj)
        if os.path.isdir(d):
            for f in os.listdir(d):
                if f.endswith(".md"):
                    all_pages[(subj, f[:-3])] = True
    bad = 0
    for subj in sorted(os.listdir(out_dir)):
        d = os.path.join(out_dir, subj)
        if not os.path.isdir(d) or (only and subj not in only):
            continue
        meta = json.load(open(os.path.join(INPUT, subj, "_files.json")))
        file_ids = {f["id"] for f in meta["files"]}
        texts = {}
        for fid in file_ids:
            p = os.path.join(INPUT, subj, fid + ".txt")
            texts[fid] = norm_words(open(p, encoding="utf-8").read()) if os.path.exists(p) else []
        grams = set()
        for words in texts.values():
            for i in range(len(words) - 39):
                grams.add(" ".join(words[i:i + 40]))
        if not os.path.exists(os.path.join(d, "index.md")):
            print(f"[{subj}] REJECT subject: no index.md"); bad += 1
        for f in sorted(os.listdir(d)):
            if not f.endswith(".md"):
                continue
            slug, errs, warns = f[:-3], [], []
            fm, body, perr = parse(os.path.join(d, f))
            errs += perr
            if fm is not None:
                for k in REQUIRED:
                    if not fm.get(k):
                        errs.append(f"frontmatter: missing {k}")
                if fm.get("subject") != subj:
                    errs.append(f"frontmatter: subject {fm.get('subject')!r} != folder {subj}")
                if not SLUG.match(slug):
                    errs.append("invalid slug")
                if (fm.get("type") == "index") != (slug == "index"):
                    errs.append("type index must be exactly the index.md page")
                if fm.get("type") not in ("index", "topic", "concept"):
                    errs.append(f"bad type {fm.get('type')!r}")
                sources = set(fm.get("sources") or [])
                for s in sources - file_ids:
                    errs.append(f"source {s} is not a published file of {subj}")
                sections = re.split(r"(?m)^## ", body)[1:]
                for sec in sections:
                    if "[[file:" not in sec:
                        errs.append(f"section without citation: '## {sec.splitlines()[0][:50]}'")
                for m in re.finditer(r"\[\[file:", body):
                    end = body.find("]]", m.start())
                    seg = body[m.start(): end if end >= 0 else len(body)]
                    if end < 0 or "\n" in seg:
                        errs.append("citation not closed on the same line: " + seg[:60].replace("\n", " ") + "...")
                    elif "|" in seg and (len(seg.split("|", 1)[1]) > 60 or "$" in seg):
                        errs.append("citation label must be a short file name (<= 60 chars, no math): " + seg[:70])
                if re.search(r"^(fundamentals|vouchers|introduction|overview|summary|basics)$", slug):
                    errs.append("slug must be Spanish")
                for target, _ in LINK.findall(body):
                    target = target.strip()
                    if "#" in target and not target.startswith("file:"):
                        target, anc = target.split("#", 1)
                        ts, tsl = (target.split("/", 1) if "/" in target else (subj, target or slug))
                        if anc not in headings(ts, tsl, out_dir):
                            errs.append(f"anchor #{anc} not found in {ts}/{tsl}")
                        if not target:
                            continue
                    if target.startswith("file:"):
                        fid = target[5:]
                        if fid not in sources:
                            errs.append(f"cites {fid} not in sources")
                    elif re.match(r"^\d+\.\d+$", target):
                        if (target, "index") not in all_pages:
                            warns.append(f"link to subject without wiki: {target}")
                    elif "/" in target:
                        s2, sl = target.split("/", 1)
                        if (s2, sl) not in all_pages:
                            warns.append(f"unresolved cross link: {target}")
                    elif (subj, target) not in all_pages:
                        warns.append(f"unresolved link: {target}")
                words = norm_words(LINK.sub(lambda m: m.group(2) or "", body))
                for i in range(len(words) - 39):
                    if " ".join(words[i:i + 40]) in grams:
                        errs.append("copies >= 40 consecutive words from a source"); break
            status = "REJECT" if errs else "ok"
            if errs:
                bad += 1
            print(f"[{subj}] {status} {slug}" + "".join(f"\n    - {e}" for e in errs) + "".join(f"\n    ~ {w}" for w in warns))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
