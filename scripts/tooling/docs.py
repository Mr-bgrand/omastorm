"""Check active Markdown command references and repository links, offline."""
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
RETIRED = re.compile(r'\bmise\s+(?:engine-(?:bump|tag|verify|pin)|build-release)\b|(?:scripts/)(?:check|release-engine|bump-engine-version|tag-engine-release|pin-engine-release|require-origin-main|prepare-pinned-ui-check|link-plugin|dev-bootstrap|check-engine-release|check-engine-binary|ci-protocol)\.sh\b|scripts/ci-(?:changes|tests)\.py\b')
GENERATED = ('target/', 'review/', 'data/raw/', 'data/derived/', 'docs/media/')


def anchors(text):
    text = re.sub(r'^```.*?^```\s*$', '', text, flags=re.M | re.S)
    result = set(); counts = {}
    for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', text, re.M):
        heading = re.sub(r'<[^>]+>', '', heading).lower()
        slug = re.sub(r'[^\w\- ]', '', heading).replace(' ', '-')
        count = counts.get(slug, 0); counts[slug] = count + 1
        result.add(slug + (f'-{count}' if count else ''))
    result.update(re.findall(r'(?:id|name)=["\']([^"\']+)["\']', text))
    return result


def check_file(path, root=ROOT):
    text = path.read_text()
    errors = [f'{path.relative_to(root)}: retired command {m[0]}' for m in RETIRED.finditer(text)]
    prose = re.sub(r'^```.*?^```\s*$', '', text, flags=re.M | re.S)
    links = re.findall(r'!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)', prose)
    links += re.findall(r'^\s*\[[^\]]+\]:\s*(\S+)', prose, re.M)
    for link in links:
        url = urlsplit(link.strip('<>'))
        if url.scheme or url.netloc: continue  # External resources are intentionally not fetched.
        target = (path.parent / unquote(url.path)).resolve() if url.path else path.resolve()
        try: relative = target.relative_to(root.resolve()).as_posix()
        except ValueError:
            errors.append(f'{path.relative_to(root)}: link escapes repository: {link}'); continue
        generated = target.suffix != '.md' and (relative.startswith(GENERATED) or relative in ('site/take.mp4','site/take-poster.png'))
        if not target.exists():
            if not generated: errors.append(f'{path.relative_to(root)}: missing local link: {link}')
        elif url.fragment and target.suffix == '.md' and unquote(url.fragment) not in anchors(target.read_text()):
            errors.append(f'{path.relative_to(root)}: missing local anchor: {link}')
    return errors


def main():
    paths = subprocess.check_output(['git','ls-files','-z','--','*.md'], cwd=ROOT).decode().split('\0')
    errors = []
    for name in paths:
        path = ROOT / name
        if name and path.is_file(): errors.extend(check_file(path))
    if errors: raise SystemExit('\n'.join(errors))
    print('Active documentation commands and local links: PASS')


if __name__ == '__main__': main()
