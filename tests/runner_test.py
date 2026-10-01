"""Focused selection, candidate split, and reproducible evidence regressions."""
from argparse import Namespace
from pathlib import Path
import os
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/tooling'))
import suite
import selection
import release
import cli
import dev
import runtime


class RunnerTests(unittest.TestCase):
    def test_candidate_build_and_reload_use_fresh_checkout_artifacts(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            (root / 'scripts').mkdir()
            (root / 'engine/src').mkdir(parents=True)
            (root / 'ui').mkdir()
            (root / 'engine/Cargo.toml').write_text('[package]\nversion = "1.2.3"\n')
            source = root / 'engine/src/main.rs'
            source.write_text('first-build\n')
            stale = root / 'target/debug/omastorm-engine'
            stale.parent.mkdir(parents=True)
            stale.write_text('#!/bin/sh\necho stale\n')
            stale.chmod(0o755)
            # Stand in for Cargo's target-dir precedence without requiring Rust
            # in the tooling-only CI job. Exercise the actual build invocations.
            (root / 'scripts/cargo.sh').write_text('exec ' + shlex.quote(sys.executable) + ' scripts/fake-cargo.py "$@"\n')
            (root / 'scripts/fake-cargo.py').write_text('''import os, sys
from pathlib import Path
args = sys.argv[1:]
target = Path(args[args.index('--target-dir') + 1] if '--target-dir' in args else os.environ['CARGO_TARGET_DIR'])
binary = target / 'debug/omastorm-engine'
binary.parent.mkdir(parents=True, exist_ok=True)
binary.write_text('#!/bin/sh\\necho ' + Path('engine/src/main.rs').read_text().strip() + '\\n')
binary.chmod(0o755)
''')
            (root / 'scripts/build-shader.sh').write_text('exit 0\n')
            launched = []
            closed = []
            def bounded_poll(*args):
                bounded_poll.calls += 1
                if bounded_poll.calls > 50: raise RuntimeError('Candidate reload never completed')
            bounded_poll.calls = 0
            class Session:
                def __init__(self, engine):
                    self.engine = engine
                    self.daemon = type('Daemon', (), {'child': type('Child', (), {'poll': lambda self: None})()})()
                def start_daemon(self):
                    launched.append(subprocess.check_output([self.engine], text=True).strip())
                def acquire(self): self.start_daemon()
                def reload(self):
                    if len(launched) == 1: source.write_text('second-build\n')
                    else: raise KeyboardInterrupt
                def close(self): closed.append(True)
            previous = Path.cwd()
            try:
                with patch.object(cli, 'ROOT', root), patch.object(dev, 'ROOT', root), patch.object(runtime, 'ROOT', root), \
                     patch.dict(os.environ, CARGO_TARGET_DIR=str(root / 'redirected')), \
                     patch.object(cli, 'handle_interruptions'), patch('sys.argv', ['omastorm', 'build']), \
                     patch.object(dev, 'Session', Session), patch.object(dev.signal, 'signal'), patch.object(dev, 'time', Namespace(sleep=bounded_poll)):
                    self.assertEqual(cli.main(), 0)
                    self.assertEqual(subprocess.check_output([stale], text=True).strip(), 'first-build')
                    source.write_text('dev-start-build\n')
                    dev.develop(Namespace(engine='candidate'))
                    self.assertEqual(launched, ['dev-start-build', 'second-build'])
                    self.assertEqual(closed, [True])
                    self.assertFalse((root / 'redirected').exists())
            finally:
                os.chdir(previous)

    def test_cargo_uses_installed_toolchain_in_isolated_xdg(self):
        with tempfile.TemporaryDirectory() as scratch:
            root=Path(scratch); shims=root/'shims'; native=root/'native'; home=root/'cargo'
            for directory in (shims,native,home/'bin'):directory.mkdir(parents=True)
            def executable(path,text):
                path.write_text('#!/bin/sh\n'+text+'\n');path.chmod(0o755)
            executable(shims/'cargo','echo unexpected-mise-shim >&2; exit 99')
            executable(shims/'rustup','echo unexpected-mise-shim >&2; exit 99')
            executable(home/'bin/rustup',f'printf "%s\\n" "{native}/cargo"')
            executable(native/'cargo','rustc "$@"')
            executable(native/'rustc','printf "%s\\n" "$@"')
            env=dict(os.environ,PATH=f'{shims}:/usr/bin:/bin',CARGO_HOME=str(home),XDG_DATA_HOME=str(root/'data'))
            result=subprocess.run(['bash',str(suite.ROOT/'scripts/cargo.sh'),'test','--offline','--locked'],env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(result.stdout.splitlines(),['test','--offline','--locked'])
            executable(home/'bin/rustup','echo toolchain-not-installed >&2; exit 1')
            result=subprocess.run(['bash',str(suite.ROOT/'scripts/cargo.sh'),'test','--offline','--locked'],env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,1)
            self.assertIn('toolchain-not-installed',result.stderr)
            self.assertNotIn('unexpected-mise-shim',result.stderr)

    def test_candidate_smoke_remains_required_during_protocol_split(self):
        with tempfile.TemporaryDirectory() as scratch:
            root=Path(scratch);(root/'engine/src').mkdir(parents=True);(root/'ui').mkdir()
            (root/'engine/src/protocol.rs').write_text('pub const VERSION: u32 = 99;\n')
            (root/'ui/Engine.qml').write_text('message.v !== 7\n')
            class Report:
                rows=[]
                def finish(self):pass
            args=Namespace(scope='ui',case=['picker'],engine='candidate',binary='/bin/false')
            with patch.object(suite,'ROOT',root),patch.object(suite,'Report',return_value=Report()),patch.object(suite,'binary',return_value=Path('/bin/false')),patch.object(suite,'run_cases') as cases,patch.object(release,'smoke',side_effect=RuntimeError('invalid native candidate')) as smoke:
                with self.assertRaisesRegex(RuntimeError,'invalid native candidate'):suite.integration(args)
                self.assertEqual(cases.call_count,1)
                self.assertEqual(cases.call_args.args[3],'pin')
                smoke.assert_called_once_with(Path('/bin/false'))

    def test_changed_shell_runs_lint_and_docs_without_rust(self):
        args=Namespace(scope='all',changed=True,base='origin/main',gpu=False)
        with patch.object(selection,'changed_paths',return_value=('base',['scripts/capture-readme.sh'])),patch.object(suite,'run') as run,patch.object(suite,'unit') as unit,patch.object(suite,'integration') as integration:
            suite.check(args)
            argv=[call.args for call in run.call_args_list]
            self.assertIn(('python3','scripts/tooling/cli.py','lint','--scope','tooling'),argv)
            self.assertIn(('python3','scripts/tooling/docs.py'),argv)
            unit.assert_called_once_with('tooling')
            integration.assert_not_called()

    def test_report_retains_command_arguments(self):
        with tempfile.TemporaryDirectory() as scratch,patch.object(suite,'ROOT',Path(scratch)):
            report=suite.Report('fixture')
            report.step('command',['/bin/true','recorded-argument'])
            self.assertEqual(report.rows[0]['command'],['/bin/true','recorded-argument'])


if __name__=='__main__':unittest.main()
