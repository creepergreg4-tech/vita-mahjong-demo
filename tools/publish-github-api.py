"""Upload a committed tree through authenticated gh API when Git transport is unavailable.
Only committed blobs are sent. Credentials stay inside gh's keyring helper.
"""
import base64, concurrent.futures, json, pathlib, subprocess, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = 'creepergreg4-tech/vita-mahjong-demo'
CACHE = ROOT / 'research' / 'pages-api-blobs.json'
def run(args, data=None):
    p = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, timeout=90)
    if p.returncode:
        raise RuntimeError(p.stderr.decode('utf8', errors='replace')[:500])
    return p.stdout
def api(route, body=None, method='POST'):
    args = ['gh','api',f'repos/{REPO}/{route}']
    if body is not None: args += ['-X',method,'--input','-']
    for attempt in range(4):
        try: return json.loads(run(args, json.dumps(body).encode() if body is not None else None))
        except RuntimeError:
            if attempt == 3: raise
            time.sleep(2 ** attempt)

entries=[]
for line in run(['git','ls-tree','-rz','HEAD']).split(b'\0'):
    if not line: continue
    info, name = line.split(b'\t',1)
    mode, typ, sha = info.decode().split()
    if typ != 'blob': raise RuntimeError('Only ordinary committed files are supported')
    entries.append({'path':name.decode(),'mode':mode,'type':'blob','sha':sha})
cache=json.loads(CACHE.read_text()) if CACHE.exists() else {}
unique=list(dict.fromkeys(e['sha'] for e in entries if e['sha'] not in cache))
def upload(sha):
    content=run(['git','cat-file','blob',sha])
    reply=api('git/blobs',{'content':base64.b64encode(content).decode(),'encoding':'base64'})
    if reply['sha'] != sha: raise RuntimeError('Git blob hash mismatch')
    return sha
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for i,f in enumerate(concurrent.futures.as_completed([pool.submit(upload,s) for s in unique]),1):
        sha=f.result();cache[sha]=True
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps(cache))
        if i%25==0 or i==len(unique): print(f'Uploaded {i}/{len(unique)} committed blobs',flush=True)
parent=api('git/ref/heads/main')['object']['sha']
base=api('git/commits/'+parent)['tree']['sha']
remote=api('git/trees/'+base+'?recursive=1')
if remote.get('truncated'): raise RuntimeError('Remote tree must not be truncated')
existing={e['path']:e['sha'] for e in remote['tree'] if e['type']=='blob'}
changes=[e for e in entries if existing.get(e['path']) != e['sha']]
if not changes:
    print('Remote committed files already match',flush=True)
    raise SystemExit(0)
# Send only changed paths; keep unrelated remote files intact.
tree=api('git/trees',{'base_tree':base,'tree':changes})
commit=api('git/commits',{'message':'Publish verified mobile Mahjong with gold rewards and blue-back stash rescue','tree':tree['sha'],'parents':[parent]})
ref=api('git/refs/heads/main',{'sha':commit['sha'],'force':False},method='PATCH')
print(json.dumps({'commit':commit['sha'],'ref':ref['ref'],'files':len(entries)}),flush=True)
