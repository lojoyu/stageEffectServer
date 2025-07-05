const stateManager = require('./stateManager');
const {
    EVENT_CONTROL_DATA,
    EVENT_DEBUG,
    MODE_NORMAL,
    MODE_TAKETURN,
    // EVENT_SHOW_CLIENT_LIST, // Consider adding this if 'showClient' emits specific data
} = require('./constants');

let receiverNs;
let clientMgr; // This will be the initialized clientManager instance
let controlLoopId = null;

/**
 * Initializes the ControlHandler with dependencies.
 * @param {object} stateMgrInstance - Instance of StateManager (already required directly).
 * @param {object} clientManagerInstance - Initialized instance of ClientManager.
 * @param {object} recNs - Receiver namespace instance.
 */
function initialize(clientManagerInstance, recNs) {
    // stateManager is already available via direct require
    clientMgr = clientManagerInstance;
    receiverNs = recNs;
    console.log('ControlHandler initialized.');
}

/**
 * Processes control data received from the controller.
 * @param {object} data - The control data payload.
 * @param {object} requestingSocket - The socket of the controller that sent the data.
 */
function processControlData(data, requestingSocket) {
    if (!data || !data.mode) {
        console.warn('[ControlHandler] Invalid control data received: Missing mode.', data);
        if (requestingSocket) {
            requestingSocket.emit(EVENT_DEBUG, { error: "Control data must include a 'mode' object." });
        }
        return;
    }

    const { mode, ...payload } = data; // Separate mode from the rest of the payload
    const intervalTimeMs = parseInt(mode.interval, 10) || 0;

    const currentState = stateManager.getControlState();
    const newModeFromController = mode;

    // Start with the existing mode, then merge new properties from the controller.
    // This preserves properties like takeTurnIndex unless overwritten.
    const nextMode = { ...currentState.currentMode, ...newModeFromController };

    // IMPORTANT: Reset the takeTurnIndex only if the mode is changing TO taketurn
    // or if the new mode is not taketurn at all.
    if (newModeFromController.type !== MODE_TAKETURN || currentState.currentMode.type !== MODE_TAKETURN) {
        nextMode.takeTurnIndex = 0;
    }

    // Update stateManager with the new control parameters
    stateManager.updateControlState({
        currentDataPayload: payload,
        intervalTimeMs: intervalTimeMs,
        currentMode: nextMode,
        isLoopActive: intervalTimeMs > 0,
    });

    console.log(`[ControlHandler] Processed control data. Mode: ${mode.type}, Interval: ${intervalTimeMs}ms`);

    if (intervalTimeMs === 0) {
        // If interval is 0, emit once and ensure any existing loop is stopped.
        clearManagedControlLoop(); // Stop any previous loop
        emitControlDataToReceivers();
        stateManager.updateControlState({ isLoopActive: false }); // Ensure loop is marked inactive
    } else {
        // If interval > 0, start or restart the managed loop.
        managedControlLoop();
    }
}

/**
 * Manages the control data emission loop.
 * Clears any existing loop and starts a new one if intervalTimeMs > 0.
 */
function managedControlLoop() {
    clearManagedControlLoop();

    const { intervalTimeMs, isLoopActive } = stateManager.getControlState();
    if (intervalTimeMs > 0 && isLoopActive) {
        emitControlDataToReceivers(); // Emit immediately once
        controlLoopId = setInterval(() => {
            // Check if the loop should still be active before emitting
            // This allows 'pause' or other actions to stop the interval's effect
            const currentControlState = stateManager.getControlState();
            if (currentControlState.isLoopActive && currentControlState.intervalTimeMs > 0) {
                emitControlDataToReceivers();
            } else {
                clearManagedControlLoop();
            }
        }, intervalTimeMs);
        console.log(`[ControlHandler] Control loop started with interval: ${intervalTimeMs}ms, ID: ${controlLoopId}`);
    } else {
        // This case should ideally be handled by processControlData setting intervalTimeMs to 0
        // or handlePause setting isLoopActive to false.
        console.log('[ControlHandler] Control loop not started (intervalTimeMs <= 0 or isLoopActive is false).');
        stateManager.updateControlState({ isLoopActive: false });
    }
}

/**
 * Clears the managed control loop interval.
 */
function clearManagedControlLoop() {
    if (controlLoopId !== null) {
        clearInterval(controlLoopId);
        controlLoopId = null;
        console.log('[ControlHandler] Control loop cleared.');
    }
}

/**
 * Emits the current control data payload to selected receiver clients.
 */
function emitControlDataToReceivers() {
    if (!receiverNs) {
        console.error('[ControlHandler] Receiver namespace not available for emitting data.');
        return;
    }
    if (!clientMgr) {
        console.error('[ControlHandler] ClientManager not available for selecting clients.');
        // Fallback: emit to all if clientManager is missing (not ideal)
        // receiverNs.emit(EVENT_CONTROL_DATA, stateManager.getControlState().currentDataPayload);
        return;
    }

    const controlState = stateManager.getControlState();
    const { currentDataPayload, currentMode } = controlState;
    let targetSocketIds = [];

    if (currentMode.type === MODE_NORMAL) {
        if (currentMode.percentage > 0 && currentMode.percentage < 1) {
            targetSocketIds = clientMgr.getPercentageClients(currentMode.percentage);
        } else {
            // Percentage 0 or 1 (or undefined) means all clients in normal mode
            targetSocketIds = clientMgr.getConnectedReceiverSocketIds();
        }
    } else if (currentMode.type === MODE_TAKETURN) {
        const orderedClients = clientMgr.getClientsByOrder(currentMode.order); // order can be sort config
        if (orderedClients && orderedClients.length > 0) {
            let currentIndex = currentMode.takeTurnIndex || 0;
            if (currentIndex >= orderedClients.length) {
                currentIndex = 0; // Loop back
            }
            const clientAtIndex = orderedClients[currentIndex];

            if (Array.isArray(clientAtIndex)) { // For "middle" out, which might return an array of IDs for a step
                targetSocketIds = clientAtIndex;
            } else {
                targetSocketIds = [clientAtIndex];
            }

            // Update takeTurnIndex for the next emission
            let nextIndex = currentIndex + 1;
            if (nextIndex >= orderedClients.length) {
                console.log('[ControlHandler] Take-turn loop completed one cycle.');
                // Option: Stop the loop after one full cycle if intervalTime was for one cycle
                // For continuous taketurn, just reset index.
                // If intervalTimeMs was meant for a single cycle, the controller should send intervalTimeMs=0 next.
                // For now, we just loop the index.
                // To stop after one cycle:
                // clearManagedControlLoop();
                // stateManager.updateControlState({ intervalTimeMs: 0, isLoopActive: false, currentMode: { ...currentMode, takeTurnIndex: 0 } });
                // return; // Exit early if stopping
                nextIndex = 0; // Loop back for continuous taketurn
            }
            stateManager.updateControlState({ currentMode: { ...currentMode, takeTurnIndex: nextIndex } });
        } else {
            console.warn('[ControlHandler] Take-turn mode: No clients found or order invalid.');
        }
    } else {
        console.warn(`[ControlHandler] Unknown control mode: ${currentMode.type}. Emitting to all.`);
        targetSocketIds = clientMgr.getConnectedReceiverSocketIds();
    }

    if (targetSocketIds && targetSocketIds.length > 0) {
        // Socket.IO's `to()` method accepts an array of socket IDs.
        receiverNs.to(targetSocketIds).emit(EVENT_CONTROL_DATA, currentDataPayload);
        console.log(`[ControlHandler] Emitted control data to ${targetSocketIds.length} clients:`, targetSocketIds, currentDataPayload);
    } else {
        console.log('[ControlHandler] No target clients selected for control data emission.');
    }
}

/**
 * Handles the 'showClient' event from the controller.
 * Emits a list of clients (based on order) back to the requesting controller.
 * @param {any} order - The ordering criteria.
 * @param {object} requestingSocket - The controller socket that made the request.
 */
function handleShowClient(order, requestingSocket) {
    if (!clientMgr) {
        console.error('[ControlHandler] ClientManager not available for handleShowClient.');
        if (requestingSocket) {
            requestingSocket.emit(EVENT_DEBUG, { error: 'ClientManager not available.' });
        }
        return;
    }
    if (!requestingSocket) {
        console.error('[ControlHandler] Requesting socket not available for handleShowClient.');
        return;
    }

    const clients = clientMgr.getClientsByOrder(order); // Assumes getClientsByOrder returns socket IDs or relevant info
    const clientRegistry = stateManager.getClientRegistry();

    const clientDetails = clients.map(socketId => {
        const uuidTimestamp = clientRegistry.socketToUuidTimestamp[socketId];
        let uuid = 'N/A';
        // Find UUID from uuidToInitialTimestamp using the timestamp
        for (const u in clientRegistry.uuidToInitialTimestamp) {
            if (clientRegistry.uuidToInitialTimestamp[u] === uuidTimestamp) {
                uuid = u;
                break;
            }
        }
        return {
            socketId,
            uuid,
            orderTimestamp: uuidTimestamp, // This is the timestamp used for sorting
            voice: clientRegistry.socketToVoicePreference[socketId] || 'default'
        };
    });

    console.log(`[ControlHandler] Showing clients for order '${order}':`, clientDetails);
    // Consider using a specific event name like EVENT_SHOW_CLIENT_LIST if the payload is structured
    requestingSocket.emit(EVENT_DEBUG, { command: 'showClient', order, clients: clientDetails });
}

/**
 * Handles the 'pause' event from the controller.
 * Stops any active control data loop.
 * @param {object} data - The data received with the pause event (currently unused).
 * @param {object} requestingSocket - The controller socket that made the request.
 */
function handlePause(data, requestingSocket) {
    console.log('[ControlHandler] Pause event received. Stopping control loop.', data);
    clearManagedControlLoop();
    stateManager.updateControlState({ isLoopActive: false }); // Explicitly mark as inactive

    if (requestingSocket) {
        // Echo back or send a confirmation
        // In index.js, it was: socket.emit('pause', data);
        // We can make it more informative.
        requestingSocket.emit(EVENT_DEBUG, { message: 'Control loop paused.', originalData: data });
        // Or if 'pause' is a defined event for controller UI:
        // requestingSocket.emit(EVENT_PAUSE, { status: 'paused', details: 'Control loop stopped by controller.' });
    }
    // Optionally, notify receivers if they need to know about a global pause state
    // receiverNs.emit('systemPause', { active: false });
}


module.exports = {
    initialize,
    processControlData,
    // managedControlLoop, // Not typically called externally
    // emitControlDataToReceivers, // Not typically called externally
    handleShowClient,
    handlePause,
};