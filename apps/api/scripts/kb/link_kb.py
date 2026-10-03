"""Step 3 of the pipeline (deterministic linker).

Rule: a key concept that has its own page is never mentioned without a link to it.
For every page and every `##` section (plus the intro before the first heading), the first plain-text
mention of another page of the same subject (title or alias) becomes `[[slug|mention]]`, unless that
section already links to it. Cross-subject links are left to the judgement pass (string matching across
subjects produces false friends).

Skips frontmatter, headings, code, math, existing links and citations.
Usage: python3 link_kb.py kb-output [subject ...] [--dry-run]   (only rewrites pages of the given subjects)
       python3 link_kb.py kb-output --check   -> lists unlinked mentions, exit 1 if any
"""
import json, os, re, sys, unicodedata

OUT = sys.argv[1]
DRY = "--dry-run" in sys.argv
CHECK = "--check" in sys.argv
ONLY = {a for a in sys.argv[2:] if not a.startswith("--")}
PROTECT = re.compile(r"(\$\$.*?\$\$|\$[^$\n]+\$|`[^`]*`|\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\))", re.S)
STOP = {"de", "del", "la", "el", "los", "las", "y", "e", "en", "a", "por", "para", "con", "un", "una", "o"}


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def content_words(t):
    return [w for w in re.findall(r"\w+", fold(t)) if w not in STOP]


def terms(page):
    out = []
    for i, t in enumerate([page["title"], *page.get("aliases", [])]):
        t = t.strip()
        if not t or re.search(r"[=+$()]", t):
            continue
        cw = content_words(t)
        if len(cw) >= 2 or (len(cw) == 1 and len(cw[0]) >= (4 if i == 0 else 6)):
            out.append(t)
    return sorted(set(out), key=len, reverse=True)


def find_mention(line, ts):
    parts = PROTECT.split(line)
    for j in range(0, len(parts), 2):
        fseg = fold(parts[j])
        for t in ts:
            m = re.search(r"(?<!\w)" + re.escape(fold(t)) + r"(?!\w)", fseg)
            if m:
                return j, parts, m.start(), m.end()
    return None


def main():
    pages = {}
    for subj in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, subj, "_concepts.json")
        if os.path.exists(p):
            for page in json.load(open(p)):
                if page["type"] != "index":
                    pages[(subj, page["slug"])] = terms(page)
    total, missing = 0, []
    for subj in sorted(os.listdir(OUT)):
        d = os.path.join(OUT, subj)
        if not os.path.isdir(d) or (ONLY and subj not in ONLY):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".md"):
                continue
            slug, path = f[:-3], os.path.join(d, f)
            raw = open(path, encoding="utf-8").read()
            m = re.match(r"^(---\n.*?\n---\n)(.*)$", raw, re.S)
            head, body = m.group(1), m.group(2)
            lines = body.split("\n")
            sections, cur = [], []
            for i, ln in enumerate(lines):
                if ln.startswith("## ") and cur:
                    sections.append(cur); cur = []
                cur.append(i)
            sections.append(cur)
            added = []
            for idxs in sections:
                sec_text = "\n".join(lines[i] for i in idxs)
                linked = {t.split("|")[0].split("#")[0].strip() for t in re.findall(r"\[\[([^\]]+)\]\]", sec_text)}
                for (s2, sl), ts in pages.items():
                    if s2 != subj or sl == slug or sl in linked or not ts:
                        continue
                    for i in idxs:
                        if lines[i].startswith("#") or lines[i].startswith("---"):
                            continue
                        hit = find_mention(lines[i], ts)
                        if hit:
                            j, parts, a, b = hit
                            orig = parts[j][a:b]
                            if CHECK:
                                missing.append(f"[{subj}] {slug}: '{orig}' -> [[{sl}]]")
                            else:
                                parts[j] = parts[j][:a] + f"[[{sl}|{orig}]]" + parts[j][b:]
                                lines[i] = "".join(parts)
                                added.append(sl)
                            linked.add(sl)
                            break
            if added:
                total += len(added)
                if not DRY:
                    open(path, "w", encoding="utf-8").write(head + "\n".join(lines))
    if CHECK:
        print("\n".join(missing) or "all concept mentions linked")
        sys.exit(1 if missing else 0)
    print(f"{total} links {'would be ' if DRY else ''}added")


if __name__ == "__main__":
    main()
