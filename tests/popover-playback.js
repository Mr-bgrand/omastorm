.pragma library

// Replay states and record UI commands. No engine playback policy runs here.
var clients = [];
var original = [];
var sockets = [];
var fixture = null;

function begin(popover, window, factory) {
    clients = [popover, window];
    original = clients.map(client => JSON.stringify(client.state));
    fixture = JSON.parse(original[0]);
    fixture.timeline = [0, 1, 2, 3].map(index => ({
        id: "ui-playback-" + index, status: "complete",
        scanTime: "2013-05-20T20:" + (10 + index * 5) + ":00Z"
    }));
    sockets = clients.map(client => client.socket);
    clients.forEach(client => {
        client.reconnect.running = false;
        client.socket.connected = false;
        client.socket = factory.createObject(client);
    });
    frame(1, false);
}

function frame(index, playing) {
    var state = JSON.parse(JSON.stringify(fixture));
    state.frame.id = state.timeline[index].id;
    state.frame.scanTime = state.timeline[index].scanTime;
    state.playing = playing;
    clients.forEach(client => client.receive(JSON.stringify(state)));
}

function clearCommands() {
    clients.forEach(client => { client.socket.commands = []; });
}

function commands() {
    // Map housekeeping may run while a window opens. User playback commands
    // must still be exactly those produced by the control being exercised.
    var playback = command => ["play", "pause", "seek", "step"].indexOf(command.type) >= 0;
    return JSON.stringify({
        popover: clients[0].socket.commands.filter(playback),
        window: clients[1].socket.commands.filter(playback)
    });
}

function end() {
    clients.forEach((client, index) => {
        var mock = client.socket;
        client.socket = sockets[index];
        client.socket.connected = true;
        client.reconnect.running = Qt.binding(() => !client.socket.connected && !client.incompatible);
        mock.destroy();
        client.receive(original[index]);
    });
    clients = [];
}
