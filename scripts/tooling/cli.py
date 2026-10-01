#!/usr/bin/env python3
"""Omastorm's eight public commands; argument definitions also generate help."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

from runtime import ROOT, run


def parser():
    top = argparse.ArgumentParser(description=__doc__)
    commands = top.add_subparsers(dest='command', required=True)
    setup = commands.add_parser('setup', help='Fetch locked dependencies and verify fixtures/published engine')
    setup.add_argument('--profile', choices=('desktop', 'engine', 'ui'), default='desktop')
    setup.add_argument('--install-tools', action='store_true', help='Install mise-managed tooling; no privileged packages')
    dev = commands.add_parser('dev', help='Temporary isolated bar plugin; removed on exit')
    dev.add_argument('--engine', choices=('pin', 'candidate'), default='pin')
    test = commands.add_parser('test', help='Fast unit tests, or selected process/UI integration')
    test.add_argument('mode', nargs='?', choices=('unit', 'integration'), default='unit')
    test.add_argument('--scope', choices=('all', 'engine', 'protocol', 'ui', 'installer', 'tooling'), default='all')
    for name in ('lint', 'format'):
        command = commands.add_parser(name, help='Check' if name == 'lint' else 'Apply supported language formatters')
        command.add_argument('--scope', choices=('all', 'engine', 'ui', 'tooling'), default='all')
    commands.add_parser('build', help='Incremental offline engine and baked shader build')
    check = commands.add_parser('check', help='Complete applicable checks; focused scopes or changed paths')
    check.add_argument('--scope', choices=('all', 'engine', 'protocol', 'ui', 'installer', 'rendering'), default='all')
    check.add_argument('--gpu', action='store_true', help='Add desktop OpenGL sampling/camera checks')
    release = commands.add_parser('release', help='Show release stages without mutation when no stage is supplied')
    stages = release.add_subparsers(dest='product')
    for name in ('engine', 'plugin'):
        product = stages.add_parser(name)
        actions = product.add_subparsers(dest='stage', required=True)
        prepare = actions.add_parser('prepare', help='Write version locally on a working branch; no commit/push')
        prepare.add_argument('version')
        actions.add_parser('tag', help='Validate clean current main; push matching tag and draft release')
        if name == 'engine':
            pin = actions.add_parser('pin', help='Verify public release assets before atomic local pin write')
            pin.add_argument('tag')
    return top


def setup(args):
    if args.install_tools:
        run('mise', 'install', timeout=600)
    required = {'engine': (), 'ui': ('quickshell', 'socat'),
                'desktop': ('quickshell', 'socat', 'omarchy', 'omarchy-shell')}[args.profile]
    import shutil
    missing = [name for name in required if not shutil.which(name)]
    if missing:
        raise RuntimeError('Missing desktop packages: ' + ', '.join(missing) + '. Install explicitly with omarchy pkg add; setup never elevates privileges.')
    run('bash', ROOT / 'scripts/extract-fixtures.sh')
    if args.profile in ('desktop', 'engine'):
        run('bash', ROOT / 'scripts/cargo.sh', 'fetch', '--locked', timeout=600)
    if args.profile in ('desktop', 'ui'):
        env = dict(os.environ, XDG_DATA_HOME=str(ROOT / 'target/pinned-data'))
        run('bash', ROOT / 'scripts/fetch-engine.sh', env=env)
    print('Setup complete. Optional capture packages: imagemagick, ffmpeg. Shader/lint/format tools: qt6-shadertools, qt6-declarative. No development/test command fetches dependencies.')


def main():
    os.chdir(ROOT)
    top = parser()
    args = top.parse_args()
    if args.command == 'release' and not args.product:
        top.parse_args(['release', '--help'])
    try:
        if args.command == 'setup':
            setup(args)
        elif args.command == 'dev':
            from dev import develop
            develop(args)
        elif args.command == 'build':
            run('bash', ROOT / 'scripts/cargo.sh', 'build', '--offline', '--locked', timeout=600)
            run('bash', ROOT / 'scripts/build-shader.sh')
        elif args.command == 'test':
            if args.mode == 'unit':
                if args.scope not in ('all', 'engine'):
                    top.error('Unit scope currently supports all or engine; integration supports protocol/UI/installer.')
                run('bash', ROOT / 'scripts/cargo.sh', 'test', '--offline', '--locked', '--bin', 'omastorm-engine', timeout=600)
                run('bash', ROOT / 'scripts/cargo.sh', 'test', '--offline', '--locked', '--test', 'rendering', timeout=600)
            else:
                run('bash', ROOT / 'scripts/check.sh', args.scope, timeout=900)
        elif args.command in ('lint', 'format'):
            if args.scope in ('all', 'ui'):
                for file in sorted((ROOT / 'ui').glob('*.qml')):
                    run('/usr/lib/qt6/bin/qmlformat', *(['-i'] if args.command == 'format' else []), file, stdout=subprocess.DEVNULL)
                run('/usr/lib/qt6/bin/qmllint', *sorted((ROOT / 'ui').glob('*.js')))
            if args.scope in ('all', 'engine'):
                run('bash', ROOT / 'scripts/cargo.sh', 'fmt', *(['--check'] if args.command == 'lint' else []))
                if args.command == 'lint':
                    run('bash', ROOT / 'scripts/cargo.sh', 'clippy', '--offline', '--locked', '--all-targets', '--', '-D', 'warnings', timeout=600)
            if args.command == 'lint' and args.scope in ('all', 'tooling'):
                run('shellcheck', '-x', ROOT / 'run.sh', *sorted((ROOT / 'scripts').glob('*.sh')))
        elif args.command == 'check':
            run('bash', ROOT / 'scripts/check.sh', args.scope, *(['--gpu'] if args.gpu else []), timeout=900)
        else:
            raise RuntimeError('Release stages are being migrated; this stage is not available yet.')
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
