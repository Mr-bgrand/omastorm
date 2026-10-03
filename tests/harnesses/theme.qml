import Quickshell
import Quickshell.Io
ShellRoot {
    Theme { id: theme }
    IpcHandler {
        target: "check"
        function snapshot(): string {
            var s = theme.snapshot;
            return [s.background, s.foreground, s.accent, s.baseSize, s.font].join(" ");
        }
    }
}
