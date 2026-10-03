"""Owned process-group and handled-signal regressions for tooling runtime."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/tooling'))
from runtime import Process, run


def group_kill(pid, signum=signal.SIGKILL):
    if pid is None:
        return
    try:
        os.killpg(pid, signum)
    except ProcessLookupError:
        pass


def running(pid):
    try:
        stat = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return stat[0] != 'Z'
    except FileNotFoundError:
        return False


def wait_stopped(pid, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not running(pid):
            return True
        time.sleep(.02)
    return not running(pid)


class RuntimeProcessTests(unittest.TestCase):
    def test_bounded_run_kills_children_on_timeout(self):
        with tempfile.TemporaryDirectory() as scratch:
            pidfile = Path(scratch) / 'child.pid'
            with self.assertRaises(subprocess.TimeoutExpired):
                run('/bin/bash', '-c', f'sleep 60 & echo $! > {pidfile}; wait', timeout=.2)
            self.assertTrue(wait_stopped(int(pidfile.read_text())), 'bounded command leaked an owned child')
    def test_close_kills_owned_descendant_after_shell_leader_exits(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            pidfile = root / 'descendant.pid'
            process = Process(['/bin/bash', '-c', f'sleep 60 & echo $! > {pidfile}; exit 0'],
                              os.environ.copy(), root / 'process.log')
            descendant = None
            try:
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline and not pidfile.exists():
                    time.sleep(.02)
                self.assertTrue(pidfile.exists(), 'fixture shell did not start sleep')
                descendant = int(pidfile.read_text())
                process.child.wait(timeout=3)
                self.assertEqual(process.child.returncode, 0, 'fixture shell leader should have exited')
                self.assertTrue(running(descendant), 'sleep descendant exited before close was exercised')

                process.close()

                self.assertTrue(wait_stopped(descendant), 'Process.close left the owned sleep descendant running')
            finally:
                group_kill(process.child.pid)
                if process.child.poll() is None:
                    process.child.wait(timeout=3)
                if not process.log.closed:
                    process.log.close()

    def test_cli_dev_handles_term_and_hup_and_closes_owned_child(self):
        tooling = Path(__file__).resolve().parents[1] / 'scripts/tooling'
        cli_path = tooling / 'cli.py'
        for handled_signal in (signal.SIGTERM, signal.SIGHUP):
            with self.subTest(signal=handled_signal.name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                child_pid_file = root / 'owned-child.pid'
                closed_file = root / 'session-closed'
                log = root / 'owned-child.log'
                harness = root / 'invoke_cli.py'
                harness.write_text(f'''\
import os, sys
from pathlib import Path
sys.path.insert(0, {str(tooling)!r})
import cli, dev
from runtime import Process

child_pid_file = Path({str(child_pid_file)!r})
closed_file = Path({str(closed_file)!r})
log = Path({str(log)!r})

class FakeSession:
    def __init__(self, engine):
        self.daemon = None
    def acquire(self):
        self.daemon = Process([sys.executable, '-c', 'import time; time.sleep(60)'], os.environ.copy(), log)
        child_pid_file.write_text(str(self.daemon.child.pid))
    def reload(self):
        pass
    def close(self):
        self.daemon.close()
        closed_file.write_text('closed')
        print('OWNED_SESSION_CLOSED', flush=True)

dev.Session = FakeSession
dev.binary = lambda mode: '/isolated/fixture-engine'
dev.run = lambda *args, **kwargs: None
dev.snapshot = lambda candidate: {{}}
sys.argv = ['omastorm', 'dev', '--engine', 'pin']
raise SystemExit(cli.main())
''')
                child = subprocess.Popen([sys.executable, str(harness)], cwd=tooling.parents[1],
                                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                         text=True, start_new_session=True)
                owned_pid = None
                try:
                    deadline = time.monotonic() + 5
                    while time.monotonic() < deadline and not child_pid_file.exists() and child.poll() is None:
                        time.sleep(.02)
                    self.assertTrue(child_pid_file.exists(), 'CLI did not start the isolated owned child')
                    owned_pid = int(child_pid_file.read_text())

                    os.kill(child.pid, handled_signal)
                    output, _ = child.communicate(timeout=5)

                    self.assertEqual(child.returncode, 0, f'CLI status for {handled_signal.name}: {output}')
                    self.assertTrue(closed_file.exists(), f'CLI skipped session close for {handled_signal.name}: {output}')
                    self.assertIn('OWNED_SESSION_CLOSED', output)
                    self.assertTrue(wait_stopped(owned_pid), f'{handled_signal.name} left the owned child running')
                finally:
                    group_kill(owned_pid)
                    group_kill(child.pid)
                    if child.poll() is None:
                        child.communicate(timeout=3)

    def test_tooling_unit_handles_term_hup_int_with_finally_cleanup(self):
        tooling = Path(__file__).resolve().parents[1] / 'scripts/tooling'
        for handled_signal, expected_status in ((signal.SIGTERM, 143), (signal.SIGHUP, 129), (signal.SIGINT, 130)):
            with self.subTest(signal=handled_signal.name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                child_pid_file = root / 'owned-child.pid'
                finally_file = root / 'unit-finally'
                log = root / 'owned-child.log'
                harness = root / 'invoke_cli.py'
                harness.write_text(f'''\
import os, sys, time
from pathlib import Path
sys.path.insert(0, {str(tooling)!r})
import cli, suite
from runtime import Process

child_pid_file = Path({str(child_pid_file)!r})
finally_file = Path({str(finally_file)!r})
log = Path({str(log)!r})

def isolated_unit(scope):
    owned = Process([sys.executable, '-c', 'import time; time.sleep(60)'], os.environ.copy(), log)
    child_pid_file.write_text(str(owned.child.pid))
    try:
        while True:
            time.sleep(.05)
    finally:
        owned.close()
        finally_file.write_text('finally')
        print('TOOLING_UNIT_FINALLY', flush=True)

suite.unit = isolated_unit
suite.integration = lambda args: None
sys.argv = ['omastorm', 'test', '--scope', 'tooling']
raise SystemExit(cli.main())
''')
                child = subprocess.Popen([sys.executable, str(harness)], cwd=tooling.parents[1],
                                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                         text=True, start_new_session=True)
                owned_pid = None
                try:
                    deadline = time.monotonic() + 5
                    while time.monotonic() < deadline and not child_pid_file.exists() and child.poll() is None:
                        time.sleep(.02)
                    self.assertTrue(child_pid_file.exists(), 'tooling command did not start the isolated owned child')
                    owned_pid = int(child_pid_file.read_text())

                    os.kill(child.pid, handled_signal)
                    output, _ = child.communicate(timeout=5)

                    self.assertEqual(child.returncode, expected_status,
                                     f'tooling CLI status for {handled_signal.name}: {output}')
                    self.assertTrue(finally_file.exists(), f'tooling unit skipped finally for {handled_signal.name}: {output}')
                    self.assertIn('TOOLING_UNIT_FINALLY', output)
                    self.assertTrue(wait_stopped(owned_pid), f'{handled_signal.name} left the tooling child running')
                finally:
                    group_kill(owned_pid)
                    group_kill(child.pid)
                    if child.poll() is None:
                        try:
                            child.communicate(timeout=3)
                        except subprocess.TimeoutExpired:
                            child.kill()
                            child.communicate(timeout=3)


if __name__ == '__main__':
    unittest.main()
