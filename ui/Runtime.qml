pragma Singleton
import QtQuick
import Quickshell
import "Instance.js" as Instance

QtObject {
    readonly property var instance: Instance.settings
    readonly property bool development: !!instance.development
    readonly property string pluginId: instance.pluginId || "com.omastorm.radar"
    readonly property string root: instance.root || Quickshell.env("OMASTORM_ROOT") || Quickshell.env("HOME") + "/.config/omarchy/plugins/com.omastorm.radar"
    readonly property string runtime: instance.runtime || Quickshell.env("XDG_RUNTIME_DIR") + "/omastorm/"
    // Without XDG_RUNTIME_DIR the engine cannot start; its error still needs a log.
    readonly property string bootstrapLog: (instance.runtime || (Quickshell.env("XDG_RUNTIME_DIR") || "/tmp") + "/omastorm/") + "bootstrap.log"
    readonly property string config: instance.config || ""
    readonly property string state: instance.state || ""
}
