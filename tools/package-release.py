"""Bundle the source, built demo and selected evidence without caches or source APK."""
from pathlib import Path
import hashlib
import json
import zipfile

root=Path(__file__).resolve().parents[1]
out=root/'delivery'
out.mkdir(exist_ok=True)
archive=out/'Vita-Mahjong-2.7-体验与工程.zip'
folders=['src','public','docs','tools','tests','.github']
build=root/'release-2.7'
files=[root/n for n in ['README.md','package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','start-demo.cmd','.gitignore']]
files.extend(root/'research'/'combo'/name for name in ['reference-notes.md','original-assets.json','runtime-assets.json'] if (root/'research'/'combo'/name).exists())
files.extend(root/'research'/'reward-fx'/name for name in ['README.md','timelines.json','gift-crop-comparison.jpg'] if (root/'research'/'reward-fx'/name).exists())
for folder in folders:
    files.extend(p for p in (root/folder).rglob('*') if p.is_file() and p.suffix not in {'.pyc'} and '__pycache__' not in p.parts)
evidence=[]
for folder in ['v4-onboarding','v8-lines','v9-reward','v10-stash','v11-stacks']:
    evidence.extend(p for p in (root/'test-output'/folder).glob('*') if p.is_file() and p.suffix in ['.png','.json'])
for name in ['level-verification.json','level-quality.json']:
    p=root/'test-output'/name
    if p.exists():evidence.append(p)
build_hashes={str(p.relative_to(build)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in build.rglob('*') if p.is_file()}
(out/'build-sha256.json').write_text(json.dumps(build_hashes,indent=2),encoding='utf8')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(files):z.write(p,p.relative_to(root).as_posix())
    for p in build.rglob('*'):
        if p.is_file():z.write(p,'dist/'+p.relative_to(build).as_posix())
    for p in evidence:z.write(p,'evidence/'+p.relative_to(root/'test-output').as_posix())
    z.write(out/'build-sha256.json','evidence/build-sha256.json')
    z.write(out/'Vita Mahjong玩法设计与迭代总结.pdf','总结/Vita Mahjong玩法设计与迭代总结.pdf')
    z.write(out/'Vita Mahjong玩法设计与迭代总结.png','总结/Vita Mahjong玩法设计与迭代总结.png')
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
summary={'archive':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'build_files':len(build_hashes)}
(out/'package-report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(summary,ensure_ascii=False))
