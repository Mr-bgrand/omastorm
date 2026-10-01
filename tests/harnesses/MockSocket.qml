import QtQuick
QtObject {
    property bool connected: true
    property var commands: []
    function write(data) { commands = commands.concat([JSON.parse(data)]); }
}
