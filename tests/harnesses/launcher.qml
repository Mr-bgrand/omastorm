import Quickshell
import Quickshell.Io
ShellRoot {
    IpcHandler {
        target: "probe"
        function entry(): string {
            var e = DesktopEntries.byId("omastorm")
            return e ? (e.id + "|" + e.name) : ""
        }
    }
}
