import Quickshell
import Quickshell.Io

ShellRoot {
    RadarWindow { id: window }
    IpcHandler {
        target: "locationTest"
        function lockId(): string { return window.store.lockId; }
        function ready(): bool {
            return window.store.initialized && window.viewApplied
                && !window.applyingView && !window.store.persistTimer.running
                && !window.store.remembered.writer.running;
        }
    }
}
