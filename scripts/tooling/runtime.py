"""Shared offline binary selection and owned subprocess lifetime."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]


def run(*args, **kwargs):
    timeout = kwargs.pop('timeout', 30)
    data = kwargs.pop('input', None)
    if kwargs.pop('capture_output', False):
        kwargs.update(stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if data is not None: kwargs['stdin'] = subprocess.PIPE
    argv = list(map(str, args))
    child = subprocess.Popen(argv, start_new_session=True, **kwargs)
    try:
        stdout, stderr = child.communicate(data, timeout=timeout)
        result = subprocess.CompletedProcess(argv, child.returncode, stdout, stderr)
        result.check_returncode()
        return result
    finally:
        stop_group(child)


def group_alive(pid):
    for entry in Path('/proc').iterdir():
        if not entry.name.isdecimal(): continue
        try:
            fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            if fields[0] != 'Z' and int(fields[2]) == pid: return True
        except (FileNotFoundError, ProcessLookupError): continue
    return False


def terminate_group(pid):
    try: os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError: pass
    deadline = time.monotonic() + 5
    while group_alive(pid) and time.monotonic() < deadline: time.sleep(.05)
    if group_alive(pid):
        try: os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError: pass
        wait_until(lambda: not group_alive(pid), timeout=5)


def stop_group(child):
    terminate_group(child.pid)
    child.wait(timeout=5)


def pin():
    return dict(line.split('=', 1) for line in (ROOT / 'engine/release.pin').read_text().splitlines()
                if line and not line.startswith('#'))


def binary(mode='pin', explicit=None):
    if explicit:
        path = Path(explicit).resolve()
    elif mode == 'candidate':
        path = ROOT / 'target/debug/omastorm-engine'
    else:
        path = ROOT / 'target/pinned-data/omastorm/bin/omastorm-engine'
    if not path.is_file() or not os.access(path, os.X_OK):
        raise RuntimeError(f'Missing {mode} engine: {path}. Run mise setup or mise build first.')
    if mode == 'pin':
        import platform
        arch = {'arm64': 'aarch64'}.get(platform.machine(), platform.machine())
        expected = pin().get(f'sha256_{arch}')
        if not expected or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'Engine does not match committed published pin: {path}')
    if mode == 'pin':
        version = pin()['tag']
    else:
        import tomllib
        version = 'engine ' + tomllib.loads((ROOT / 'engine/Cargo.toml').read_text())['package']['version'] + ', source candidate'
    print(f'Engine {mode}: {path} ({version})', flush=True)
    return path


def wait_until(predicate, timeout=10, process=None):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        if process and process.poll() is not None:
            raise RuntimeError(f'Owned process exited: {process.returncode}')
        time.sleep(.05)
    raise RuntimeError(f'Readiness timeout after {timeout}s')


class Process:
    def __init__(self, argv, env, log):
        self.log = Path(log).open('a')
        try:
            self.child = subprocess.Popen(list(map(str, argv)), env=env, stdout=self.log,
                                          stderr=subprocess.STDOUT, start_new_session=True)
        except BaseException:
            self.log.close()
            raise

    def close(self):
        # A shell leader can exit before its children. Its process group remains
        # ours while descendants exist; never use leader liveness as cleanup.
        try: stop_group(self.child)
        finally: self.log.close()

    def group_alive(self):
        return group_alive(self.child.pid)


class Interrupted(BaseException):
    def __init__(self, signum):
        self.signum = signum


def handle_interruptions():
    def interrupt(signum, frame):
        raise Interrupted(signum)
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, interrupt)
