"""Failure and ownership regressions for the temporary dev plugin."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/tooling'))
import dev


class FakeDaemon:
    def __init__(self, pid=43127, close_error=None):
        self.child = type('Child', (), {'pid': pid, 'poll': lambda self: None})()
        self.close_error = close_error

    def close(self):
        if self.close_error:
            raise RuntimeError(self.close_error)


class DevFailureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.env = patch.dict(os.environ, HOME=str(self.home), XDG_CONFIG_HOME=str(self.home / 'ignored-xdg'))
        self.env.start()
        self.repo = self.home / 'repo'
        (self.repo / 'ui').mkdir(parents=True)
        (self.repo / 'ui/Bar.qml').write_text('Bar {}\n')
        (self.repo / 'ui/Panel.qml').write_text('Panel {}\n')
        (self.repo / 'ui/qmldir').write_text('module Fixture\n')
        (self.repo / 'scripts').mkdir()
        (self.repo / 'scripts/check.sh').write_text('# fixture\n')
        (self.repo / 'engine').mkdir()
        (self.repo / 'engine/release.pin').write_text('fixture\n')
        (self.repo / 'run.sh').write_text('# fixture\n')
        (self.repo / 'manifest.json').write_text(json.dumps({
            'id': 'com.omastorm.radar',
            'name': 'Omastorm',
            'barWidget': {'displayName': 'Omastorm'},
            'entryPoints': {'barWidget': 'ui/Bar.qml', 'panel': 'ui/Panel.qml'},
        }))
        self.root_patch = patch.object(dev, 'ROOT', self.repo)
        self.root_patch.start()

    def tearDown(self):
        self.root_patch.stop()
        self.env.stop()
        self.tmp.cleanup()

    def staged(self, *, manifest=False, daemon=None):
        session = dev.Session('/unused-engine')
        session.plugins.mkdir(parents=True, exist_ok=True)
        session.lock = (session.plugins / f'.{dev.ID}.lock').open('a')
        import fcntl
        fcntl.flock(session.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        session.dest.mkdir()
        if manifest:
            (session.dest / 'manifest.json').write_text('{}\n')
        session.runtime = self.home / f'runtime-{session.token}'
        session.runtime.mkdir()
        session.cache = self.home / f'cache-{session.token}'
        session.cache.mkdir()
        session.env = {}
        session.daemon = daemon
        session.write_owner()
        return session

    @staticmethod
    def result(stdout):
        return type('Result', (), {'stdout': stdout})()

    def plugin_and_widget_command(self, session, status):
        def command(*args, **kwargs):
            if args[:3] == ('omarchy', 'plugin', 'list'):
                return self.result(json.dumps([{'id': dev.ID}]))
            if args[:3] == ('omarchy-shell', 'omastorm-dev', 'status'):
                return self.result(json.dumps(status(session)))
            return self.result('')
        return command

    def test_startup_failure_before_manifest_is_cleaned_and_next_start_recovers(self):
        runtime_one = self.home / 'runtime-one'
        runtime_two = self.home / 'runtime-two'
        runtime_one.mkdir()
        runtime_two.mkdir()
        waits = [RuntimeError('socket did not start'), None]
        with patch.object(dev.tempfile, 'mkdtemp', side_effect=[str(runtime_one), str(runtime_two)]), \
             patch.object(dev, 'Process', side_effect=[FakeDaemon(), FakeDaemon()]), \
             patch.object(dev, 'wait_until', side_effect=waits), \
             patch.object(dev.Session, 'start_time', return_value='fixture-start'):
            failed = dev.Session('/unused-engine')
            with self.assertRaisesRegex(RuntimeError, 'socket did not start'):
                failed.acquire()
            self.assertFalse((failed.dest / 'manifest.json').exists())
            failed.close()
            self.assertFalse(failed.dest.exists())
            self.assertFalse(runtime_one.exists())

            recovered = dev.Session('/unused-engine')
            try:
                recovered.acquire()
                self.assertTrue(recovered.dest.exists())
                self.assertEqual(json.loads((recovered.dest / '.owner.json').read_text())['token'], recovered.token)
            finally:
                recovered.close()
        self.assertFalse(recovered.dest.exists())

    def test_stale_owned_marker_removes_only_its_dev_runtime(self):
        plugins = self.home / '.config/omarchy/plugins'
        dest = plugins / dev.ID
        stale_runtime = Path(tempfile.mkdtemp(prefix='omastorm-dev-stale-'))
        dest.mkdir(parents=True)
        (dest / '.owner.json').write_text(json.dumps({
            'schema': 1, 'id': dev.ID, 'token': 'stale', 'pid': None,
            'runtime': str(stale_runtime), 'start': None,
        }))
        runtime = self.home / 'new-runtime'
        runtime.mkdir()
        real_rmtree = shutil.rmtree

        def remove(path, *args, **kwargs):
            if Path(path) == stale_runtime:
                removed.append((Path(path), kwargs.get('ignore_errors', False)))
            return real_rmtree(path, *args, **kwargs)

        removed = []
        with patch.object(dev.tempfile, 'mkdtemp', return_value=str(runtime)), \
             patch.object(dev, 'Process', return_value=FakeDaemon()), \
             patch.object(dev, 'wait_until'), \
             patch.object(dev.Session, 'start_time', return_value='fixture-start'), \
             patch.object(dev.shutil, 'rmtree', side_effect=remove):
            session = dev.Session('/unused-engine')
            try:
                session.acquire()
                self.assertEqual(removed, [(stale_runtime, False)])
            finally:
                session.close()

    def test_xdg_config_overrides_share_the_home_registry_lock(self):
        first = dev.Session('/unused-engine')
        second = dev.Session('/unused-engine')
        first_xdg = self.home / 'xdg-one'
        second_xdg = self.home / 'xdg-two'
        runtime = self.home / 'runtime'
        runtime.mkdir()
        with patch.object(dev.tempfile, 'mkdtemp', return_value=str(self.home / 'runtime')), \
             patch.object(dev, 'Process', return_value=FakeDaemon()), \
             patch.object(dev, 'wait_until'), \
             patch.object(dev.Session, 'start_time', return_value='fixture-start'):
            with patch.dict(os.environ, XDG_CONFIG_HOME=str(first_xdg)):
                first.acquire()
            try:
                with patch.dict(os.environ, XDG_CONFIG_HOME=str(second_xdg)):
                    with self.assertRaisesRegex(RuntimeError, 'Another worktree'):
                        second.acquire()
                self.assertEqual(first.plugins, second.plugins)
                self.assertFalse(first_xdg.exists())
                self.assertFalse(second_xdg.exists())
            finally:
                first.close()
                second.close()

    def test_reload_retains_only_current_and_previous_revisions(self):
        session = self.staged()
        def status(current):
            return {'revision': current.revision, 'pluginId': dev.ID,
                    'runtime': str(current.runtime / 'omastorm') + '/', 'connected': True}
        with patch.object(dev, 'run', side_effect=self.plugin_and_widget_command(session, status)):
            try:
                for _ in range(6):
                    session.reload()
                revisions = sorted(path.name for path in session.dest.glob(f'ui-{session.token}-*'))
                self.assertEqual(revisions, [f'ui-{session.token}-5', f'ui-{session.token}-6'])
            finally:
                session.close()

    def test_reload_waits_for_widget_to_report_current_revision_and_connection(self):
        for label, override in (
                ('wrong revision', {'revision': lambda current: current.revision - 1}),
                ('disconnected', {'connected': lambda current: False})):
            with self.subTest(status=label):
                session = self.staged()

                def status(current):
                    fields = {'revision': current.revision, 'pluginId': dev.ID,
                              'runtime': str(current.runtime / 'omastorm') + '/', 'connected': True}
                    for field, value in override.items():
                        fields[field] = value(current)
                    return fields

                wait_calls = []

                def bounded_wait(predicate, timeout=10, process=None):
                    wait_calls.append(predicate)
                    for _ in range(3):
                        if predicate():
                            return
                    raise RuntimeError('readiness predicate remained false after 3 polls')

                with patch.object(dev, 'run', side_effect=self.plugin_and_widget_command(session, status)), \
                     patch.object(dev, 'wait_until', side_effect=bounded_wait):
                    try:
                        with self.assertRaisesRegex(RuntimeError, 'readiness predicate remained false after 3 polls'):
                            session.reload()
                        self.assertEqual(session.revision, 1)
                        self.assertEqual(len(wait_calls), 2)
                    finally:
                        session.close()

    def test_failed_daemon_cleanup_retains_recovery_metadata(self):
        session = self.staged(manifest=True, daemon=FakeDaemon(close_error='daemon close failed'))
        with patch.object(dev, 'run') as command:
            with self.assertRaisesRegex(RuntimeError, 'daemon close failed'):
                session.close()
            command.assert_called_once_with('omarchy', 'plugin', 'disable', dev.ID)
        self.assertTrue((session.dest / '.owner.json').exists())
        self.assertTrue(session.runtime.exists())

    def test_cleanup_reports_daemon_and_plugin_removal_failures(self):
        session = self.staged(manifest=True, daemon=FakeDaemon(close_error='daemon close failed'))
        (session.cache / 'engine.log').write_text('diagnostic\n')
        with patch.object(dev, 'run', side_effect=RuntimeError('plugin service unavailable')):
            with self.assertRaisesRegex(RuntimeError, 'Dev cleanup incomplete: daemon close failed; plugin service unavailable'):
                session.close()
        self.assertTrue((session.cache / 'engine.log').exists())
        self.assertTrue(session.runtime.exists())


if __name__ == '__main__':
    unittest.main()
