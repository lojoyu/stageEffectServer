// Assuming constants.js will be created and export these event names
const {
    EVENT_USER_CONNECT,
    EVENT_USER_DISCONNECT, // We'll define this for symmetry
    EVENT_SPEAK_CONFIG,
    EVENT_SPEAK_OVER,
    EVENT_DEBUG,
    EVENT_OSC,
    EVENT_CONTROL_DATA,
    EVENT_SPEAK,
    EVENT_SPEAK_ADVANCE,
    EVENT_PAUSE,
    EVENT_SHOW_CLIENT
} = require('./constants');

const stateManager = require('./stateManager');

// Module-level variables to store dependencies
let receiverNs, controllerNs, userNs;
let ctrlHandler, spkHandler; // These will be passed in after they are initialized

/**
 * Initializes the ConnectionManager with namespaces and handlers.
 * @param {object} recNs - Receiver namespace instance.
 * @param {object} ctrlNs - Controller namespace instance.
 * @param {object} usrNs - User namespace instance.
 * @param {object} controlHandlerInstance - Initialized instance of ControlHandler.
 * @param {object} speakHandlerInstance - Initialized instance of SpeakHandler.
 */
function initialize(recNs, ctrlNs, usrNs, controlHandlerInstance, speakHandlerInstance) {
    receiverNs = recNs;
    controllerNs = ctrlNs;
    userNs = usrNs;
    ctrlHandler = controlHandlerInstance;
    spkHandler = speakHandlerInstance;

    // Setup connection listeners for each namespace
    _setupReceiverConnections();
    _setupUserConnections();
    _setupControllerConnections();

    console.log('ConnectionManager initialized and listeners set up.');
}

/**
 * Sets up event listeners for the /receiver namespace.
 * Private helper function.
 */
function _setupReceiverConnections() {
    if (!receiverNs) {
        console.error('[ConnectionManager] Receiver namespace not initialized.');
        return;
    }
    receiverNs.on('connection', (socket) => {
        console.log(`[ConnectionManager] Receiver connected: ${socket.id}`);

        socket.on('connected', ({ uuid }) => {
            console.log(`uuid: ${uuid}`);
            if (!uuid) {
                console.warn(`[ConnectionManager] Receiver ${socket.id} 'connected' event missing UUID.`);
                socket.emit(EVENT_DEBUG, { error: 'UUID is required for connection.' });
                return;
            }
            stateManager.registerClient(socket.id, uuid);
            const clientInfo = {
                socketId: socket.id,
                uuid: uuid,
                timestamp: stateManager.getSocketUuidTimestamp(socket.id) // Get the UUID's initial timestamp
            };
            console.log(`[ConnectionManager] Receiver 'connected' processed:`, clientInfo);
            if (controllerNs) {
                controllerNs.emit(EVENT_USER_CONNECT, clientInfo);
            }
        });

        socket.on('disconnect', () => {
            console.log(`[ConnectionManager] Receiver disconnected: ${socket.id}`);
            // Assuming stateManager has a more direct way to get UUID by socket ID.
            // This avoids inefficiently looping through the registry.
            const disconnectedUuid = stateManager.getUuidBySocketId ? stateManager.getUuidBySocketId(socket.id) : 'unknown';

            stateManager.unregisterClient(socket.id);
            if (controllerNs) {
                controllerNs.emit(EVENT_USER_DISCONNECT, { socketId: socket.id, uuid: disconnectedUuid });
            }
        });

        socket.on(EVENT_SPEAK_CONFIG, (data) => {
            if (spkHandler && spkHandler.handleReceiverSpeakConfig) {
                spkHandler.handleReceiverSpeakConfig(socket.id, data);
            } else {
                console.warn(`[ConnectionManager] SpeakHandler or handleReceiverSpeakConfig not available for event: ${EVENT_SPEAK_CONFIG}`);
            }
        });

        socket.on(EVENT_SPEAK_OVER, (data) => {
            if (spkHandler && spkHandler.handleReceiverSpeakOver) {
                spkHandler.handleReceiverSpeakOver(socket.id, data);
            } else {
                console.warn(`[ConnectionManager] SpeakHandler or handleReceiverSpeakOver not available for event: ${EVENT_SPEAK_OVER}`);
            }
        });

        socket.on(EVENT_DEBUG, (data) => {
            console.log(`[ConnectionManager] Debug message from receiver ${socket.id}:`, data);
            if (controllerNs) {
                controllerNs.emit(EVENT_DEBUG, { from: `receiver/${socket.id}`, message: data });
            }
        });
    });
}

/**
 * Sets up event listeners for the /user namespace.
 * Private helper function.
 */
function _setupUserConnections() {
    if (!userNs) {
        console.error('[ConnectionManager] User namespace not initialized.');
        return;
    }
    userNs.on('connection', (socket) => {
        console.log(`[ConnectionManager] User connected: ${socket.id}`);

        socket.on(EVENT_OSC, (data) => {
            // console.log(`[ConnectionManager] OSC message from user ${socket.id}:`, data);
            if (controllerNs) {
                controllerNs.emit(EVENT_OSC, data);
            }
        });

        socket.on('disconnect', () => {
            console.log(`[ConnectionManager] User disconnected: ${socket.id}`);
        });
    });
}

/**
 * Sets up event listeners for the /controller namespace.
 * Private helper function.
 */
function _setupControllerConnections() {
    if (!controllerNs) {
        console.error('[ConnectionManager] Controller namespace not initialized.');
        return;
    }
    controllerNs.on('connection', (socket) => {
        console.log(`[ConnectionManager] Controller connected: ${socket.id}`);
        socket.emit(EVENT_DEBUG, 'Controller connected to server.');

        socket.on(EVENT_CONTROL_DATA, (data) => {
            if (ctrlHandler && ctrlHandler.processControlData) {
                ctrlHandler.processControlData(data, socket);
            } else {
                console.warn(`[ConnectionManager] ControlHandler or processControlData not available for event: ${EVENT_CONTROL_DATA}`);
            }
        });

        socket.on(EVENT_SHOW_CLIENT, (order) => {
            if (ctrlHandler && ctrlHandler.handleShowClient) {
                ctrlHandler.handleShowClient(order, socket);
            } else {
                console.warn(`[ConnectionManager] ControlHandler or handleShowClient not available for event: '${EVENT_SHOW_CLIENT}'`);
            }
        });

        socket.on(EVENT_PAUSE, (data) => {
            console.log(`[ConnectionManager] Pause event received from controller ${socket.id}:`, data);
            if (ctrlHandler && ctrlHandler.handlePause) {
                ctrlHandler.handlePause(data, socket);
            } else {
                socket.emit(EVENT_DEBUG, { message: 'Pause event received, handler TBD.', data });
                console.warn(`[ConnectionManager] ControlHandler or handlePause not available for event: 'pause'`);
            }
        });

        socket.on(EVENT_SPEAK, (data) => {
            if (spkHandler && spkHandler.handleControllerInitiateSpeak) {
                spkHandler.handleControllerInitiateSpeak(data, socket);
            } else {
                console.warn(`[ConnectionManager] SpeakHandler or handleControllerInitiateSpeak not available for event: ${EVENT_SPEAK}`);
            }
        });

        socket.on(EVENT_SPEAK_ADVANCE, (data) => {
            if (spkHandler && spkHandler.handleControllerInitiateSpeakAdvance) {
                spkHandler.handleControllerInitiateSpeakAdvance(data, socket);
            } else {
                console.warn(`[ConnectionManager] SpeakHandler or handleControllerInitiateSpeakAdvance not available for event: 'speakAdvance'`);
            }
        });

        socket.on(EVENT_SPEAK_CONFIG, (data) => {
            if (spkHandler && spkHandler.handleControllerSpeakConfig) {
                spkHandler.handleControllerSpeakConfig(data, socket);
            } else {
                console.warn(`[ConnectionManager] SpeakHandler or handleControllerSpeakConfig not available for event: ${EVENT_SPEAK_CONFIG}`);
            }
        });

        socket.on('disconnect', () => {
            console.log(`[ConnectionManager] Controller disconnected: ${socket.id}`);
        });
    });
}

module.exports = {
    initialize,
};