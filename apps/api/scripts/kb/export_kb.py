import subprocess, json, os, shutil
D = "kb-input"
shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
sql = """select coalesce(json_agg(t),'[]') from (
  select f.effective_subject_id subj, s.name subject_name, f.id, f.name, f.kind, coalesce(f.text_content,'') text
  from wiki.drive_file f join subject s on s.id=f.effective_subject_id
  where f.publication='PUBLISHED' and f.kind<>'FOLDER' order by 1,4) t"""
out = subprocess.run(["docker","exec","ceitba-drive-postgres-1","psql","-U","postgres","-d","ceitba_db","-At","-c",sql], capture_output=True, text=True, check=True).stdout
rows = json.loads(out)
subjects = {}
for r in rows:
    d = os.path.join(D, r["subj"]); os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, r["id"] + ".txt"), "w") as fh: fh.write(r["text"])
    subjects.setdefault(r["subj"], {"name": r["subject_name"], "files": []})["files"].append({"id": r["id"], "name": r["name"], "kind": r["kind"], "chars": len(r["text"])})
for s, v in subjects.items():
    with open(os.path.join(D, s, "_files.json"), "w") as fh: json.dump(v, fh, ensure_ascii=False, indent=1)
    print(s, v["name"], len(v["files"]), "files,", sum(f["chars"] for f in v["files"]), "chars,", sum(1 for f in v["files"] if f["chars"] > 300), "with text")
