"""Temporary bar plugin; persistent global lock, immutable QML revisions."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import tempfile
import time
import uuid

from runtime import ROOT, Process, binary, run, wait_until, terminate_group

ID = 'com.omastorm.radar-dev'


class Session:
    def __init__(self, engine):
        self.engine = engine
        # Omarchy's registry uses HOME, not the invoking terminal's XDG override.
        self.plugins = Path.home() / '.config/omarchy/plugins'
        self.dest = self.plugins / ID
        self.token = uuid.uuid4().hex
        self.daemon = None
        self.runtime = None
        self.lock = None
        self.revision = 0
        self.env = None

    def acquire(self):
        self.plugins.mkdir(parents=True, exist_ok=True)
        self.lock = (self.plugins / f'.{ID}.lock').open('a')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another worktree owns the dev plugin; end its mise dev first.') from None
        if self.dest.exists() or self.dest.is_symlink():
            if self.dest.is_symlink():
                raise RuntimeError(f'Refusing foreign dev symlink: {self.dest}')
            owner = self.owner()
            if owner.get('schema') != 1 or owner.get('id') != ID:
                raise RuntimeError(f'Refusing unowned installation: {self.dest}')
            # SIGKILL may leave a daemon. Never kill a reused PID: identity is
            # checked against Linux's process start time as well as the PID.
            pid = owner.get('pid')
            start = self.start_time(pid, include_zombie=True) if pid else None
            if pid and owner.get('start') and (start == owner['start'] or start is None):
                # A departed/zombie leader may leave its original group alive.
                # A reused live PID with a different start time is never killed.
                terminate_group(pid)
            stale_runtime = owner.get('runtime')
            if stale_runtime and Path(stale_runtime).parent == Path('/tmp') and Path(stale_runtime).name.startswith('omastorm-dev-'):
                if Path(stale_runtime).exists():
                    shutil.rmtree(stale_runtime)
            stale_root, stale_token = owner.get('root'), owner.get('token', '')
            if stale_root and __import__('re').fullmatch('[a-f0-9]{32}', stale_token):
                cache = Path(stale_root) / 'target/dev' / stale_token
                if cache.is_dir() and not cache.is_symlink():
                    self.clean_cache(cache)
            self.uninstall()
        self.dest.mkdir()
        self.write_owner()
        self.runtime = Path(tempfile.mkdtemp(prefix='omastorm-dev-', dir='/tmp'))
        self.cache = ROOT / 'target/dev' / self.token
        self.cache.mkdir(parents=True)
        (self.cache / 'config.toml').touch()
        self.env = dict(os.environ, XDG_RUNTIME_DIR=str(self.runtime), XDG_CACHE_HOME=str(self.cache),
                        OMASTORM_ROOT=str(self.dest), OMASTORM_STATE=str(self.cache / 'state.json'),
                        OMASTORM_CONFIG=str(self.cache / 'config.toml'))
        self.start_daemon()

    @staticmethod
    def start_time(pid, include_zombie=False):
        try:
            fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
            return fields[19] if include_zombie or fields[0] != 'Z' else None
        except FileNotFoundError:
            return None

    def owner(self):
        try:
            return json.loads((self.dest / '.owner.json').read_text())
        except (FileNotFoundError, ValueError):
            return {}

    def uninstall(self):
        # Startup may fail before the host has ever discovered the stage.
        if (self.dest / 'manifest.json').exists():
            known = json.loads(run('omarchy', 'plugin', 'list', '--json', capture_output=True, text=True).stdout)
            if any(plugin['id'] == ID for plugin in known):
                run('omarchy', 'plugin', 'disable', ID)
            shutil.rmtree(self.dest)
            run('omarchy-shell', 'shell', 'rescanPlugins')
        else:
            shutil.rmtree(self.dest)

    def write_owner(self):
        pid = self.daemon.child.pid if self.daemon else None
        (self.dest / '.owner.json').write_text(json.dumps(dict(schema=1, id=ID, token=self.token,
                                                             root=str(ROOT), pid=pid,
                                                             runtime=str(self.runtime) if self.runtime else None,
                                                             start=self.start_time(pid) if pid else None)))

    def start_daemon(self):
        if self.daemon:
            self.daemon.close()
        self.daemon = Process([self.engine, 'serve'], self.env, self.cache / 'engine.log')
        self.write_owner()
        wait_until(lambda: (self.runtime / 'omastorm/engine.sock').exists(), process=self.daemon.child)

    def reload(self):
        self.revision += 1
        directory = f'ui-{self.token}-{self.revision}'
        ui = self.dest / directory
        shutil.copytree(ROOT / 'ui', ui)
        settings = dict(development=True, pluginId=ID, root=str(self.dest),
                        revision=self.revision,
                        runtime=str(self.runtime / 'omastorm') + '/', config=str(self.cache / 'config.toml'),
                        state=str(self.cache / 'state.json'))
        (ui / 'Instance.js').write_text('.pragma library\nvar settings = ' + json.dumps(settings) + ';\n')
        manifest = json.loads((ROOT / 'manifest.json').read_text())
        manifest['id'] = ID
        manifest['name'] += ' (dev)'
        manifest['barWidget']['displayName'] += ' (dev)'
        manifest['entryPoints'] = {key: value.replace('ui/', directory + '/', 1)
                                   for key, value in manifest['entryPoints'].items()}
        # All runtime/bootstrap assets are present even though the owner starts
        # the daemon. Revision URLs avoid persistent singleton component caches.
        for name in ('run.sh', 'scripts/fetch-engine.sh', 'scripts/engine-pin.sh', 'scripts/cargo.sh', 'engine/release.pin'):
            dest = self.dest / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, dest)
        pending = self.dest / 'manifest.next'
        pending.write_text(json.dumps(manifest, indent=2) + '\n')
        pending.replace(self.dest / 'manifest.json')
        run('omarchy', 'plugin', 'validate', self.dest)
        run('omarchy-shell', 'shell', 'rescanPlugins')
        wait_until(lambda: ID in [p['id'] for p in json.loads(
            run('omarchy', 'plugin', 'list', '--json', capture_output=True, text=True).stdout)])
        if self.revision == 1:
            run('omarchy', 'plugin', 'enable', ID, '--section', 'left')
        def loaded():
            try:
                status = json.loads(run('omarchy-shell', 'omastorm-dev', 'status', capture_output=True, text=True, timeout=2).stdout)
                return status.get('revision') == self.revision and status.get('pluginId') == ID and status.get('runtime') == settings['runtime'] and status.get('connected') is True
            except (ValueError, RuntimeError, __import__('subprocess').SubprocessError):
                return False
        wait_until(loaded)
        # Keep one previous revision for asynchronous component unloading.
        for old in self.dest.glob(f'ui-{self.token}-*'):
            if int(old.name.rsplit('-', 1)[1]) < self.revision - 1:
                shutil.rmtree(old)
        print(f'Dev loaded revision {self.revision}; rescan reloads all shell plugins.', flush=True)

    def close(self):
        errors = []
        daemon_stopped = True
        if self.daemon:
            try:
                self.daemon.close()
            except Exception as error:
                errors.append(str(error))
                daemon_stopped = False
        if self.lock and self.owner().get('token') == self.token:
            try:
                if daemon_stopped:
                    self.uninstall()
                elif (self.dest / 'manifest.json').exists():
                    # Retain recovery metadata until the owned process stops.
                    run('omarchy', 'plugin', 'disable', ID)
            except Exception as error:
                errors.append(str(error))
        if self.runtime and daemon_stopped:
            shutil.rmtree(self.runtime)
        if hasattr(self, 'cache') and daemon_stopped:
            # Keep failure logs, remove writable state and daemon cache.
            self.clean_cache(self.cache)
        if self.lock:
            self.lock.close()
        if errors:
            raise RuntimeError('Dev cleanup incomplete: ' + '; '.join(errors))
        print('Owned dev resources removed.', flush=True)

    @staticmethod
    def clean_cache(cache):
        for path in cache.iterdir():
            if path.name.endswith('.log'): continue
            if path.is_dir() and not path.is_symlink(): shutil.rmtree(path)
            else: path.unlink()


def snapshot(candidate):
    paths = list((ROOT / 'ui').rglob('*')) + [ROOT / 'manifest.json']
    if candidate:
        paths += list((ROOT / 'engine').rglob('*.rs')) + [ROOT / 'Cargo.lock', ROOT / 'engine/Cargo.toml', ROOT / 'Cargo.toml']
        paths += [ROOT / 'engine/data/sites.json', ROOT / 'engine/data/product.json']
    return {str(p): (p.stat().st_mtime_ns, p.stat().st_size) for p in paths
            if p.is_file() and p.suffix not in ('.qmlc', '.jsc', '.qsb')}


def develop(args):
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, interrupted)
    previous = snapshot(args.engine == 'candidate')
    if args.engine == 'candidate':
        run('bash', ROOT / 'scripts/cargo.sh', 'build', '--offline', '--locked', '--target-dir', ROOT / 'target', timeout=600)
    run('bash', ROOT / 'scripts/build-shader.sh')
    session = Session(binary(args.engine))
    try:
        session.acquire()
        session.reload()
        print('Watching UI/manifest/shaders' + (' and engine' if args.engine == 'candidate' else '') + '; Ctrl-C removes the dev plugin.', flush=True)
        while True:
            time.sleep(.2)
            current = snapshot(args.engine == 'candidate')
            if current == previous:
                if session.daemon.child.poll() is not None:
                    raise RuntimeError('Dev daemon exited; inspect target/dev logs.')
                continue
            time.sleep(.3)
            current = snapshot(args.engine == 'candidate')
            changed = {p for p in current.keys() | previous.keys() if current.get(p) != previous.get(p)}
            if any(p.endswith('.frag') for p in changed):
                run('bash', ROOT / 'scripts/build-shader.sh')
            if args.engine == 'candidate' and any('/engine/' in p or p.endswith('Cargo.lock') or p.endswith('Cargo.toml') for p in changed):
                run('bash', ROOT / 'scripts/cargo.sh', 'build', '--offline', '--locked', '--target-dir', ROOT / 'target', timeout=600)
                session.start_daemon()
            session.reload()
            # Saves during a build/rescan must remain pending for the next
            # loop, rather than disappearing into a post-reload baseline.
            previous = current
    except KeyboardInterrupt:
        pass
    finally:
        # Handled signals cannot interrupt ownership cleanup a second time.
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)
        session.close()
