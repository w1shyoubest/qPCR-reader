"""Assemble the single-file app (index.html) from src/ and the pinned third-party libraries.
Usage (from the repo root):  python3 src/build.py
Downloads the libraries from npm once into src/vendor/ if they are missing."""
import os, subprocess, tarfile, io, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); SRC = os.path.join(ROOT, 'src'); V = os.path.join(SRC, 'vendor')
LIBS = {'jszip.min.js': ('jszip', '3.10.1', 'package/dist/jszip.min.js'),
        'xlsx.full.min.js': ('xlsx', '0.18.5', 'package/dist/xlsx.full.min.js'),
        'chart.umd.js': ('chart.js', '4.4.1', 'package/dist/chart.umd.js')}
os.makedirs(V, exist_ok=True)
for out, (name, ver, inner) in LIBS.items():
    p = os.path.join(V, out)
    if not os.path.exists(p):
        url = f'https://registry.npmjs.org/{name}/-/{name.split("/")[-1]}-{ver}.tgz'
        with tarfile.open(fileobj=io.BytesIO(urllib.request.urlopen(url).read())) as t:
            open(p, 'wb').write(t.extractfile(inner).read())
safe = lambda s: s.replace('</script', '<\\/script')
t = open(os.path.join(SRC, 'template.html'), encoding='utf-8').read()
for k, f in {'/*JSZIP*/': 'vendor/jszip.min.js', '/*XLSX*/': 'vendor/xlsx.full.min.js', '/*CHARTJS*/': 'vendor/chart.umd.js', '/*CORE*/': 'core.js', '/*APP2*/': 'app2.js'}.items():
    t = t.replace(k, safe(open(os.path.join(SRC, f), encoding='utf-8').read()))
open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8').write(t)
print('index.html written')
