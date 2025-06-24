const stateManager = require('./stateManager');
const utils = require('./utils');

const {
    EVENT_SPEAK,
    EVENT_SPEAK_OVER,
    EVENT_SPEAK_OVER_ALL, // New event: To controller when all sentences are done
    EVENT_SPEAK_CONFIG,
    SPEAK_CONFIG_CHANGE_VOICE,
    SPEAK_CONFIG_NOW_SPEAK,
    SPEAK_CONFIG_CHANGE_TIMEOUT,
    SPEAK_CONFIG_SHOW_USER,
    // EVENT_DEBUG, // If needed for emitting debug messages
} = require('./constants');

let clientMgr;
let receiverNs;
let controllerNs;

/**
 * Initializes the SpeakHandler with dependencies.
 * @param {object} clientManagerInstance - Initialized instance of ClientManager.
 * @param {object} recNs - Receiver namespace instance.
 * @param {object} ctrlNs - Controller namespace instance.
 */
function initialize(clientManagerInstance, recNs, ctrlNs) {
    // stateManager is already available via direct require
    clientMgr = clientManagerInstance;
    receiverNs = recNs;
    controllerNs = ctrlNs;
    console.log('SpeakHandler initialized.');
}

/**
 * Handles simple speak requests from the controller.
 * @param {string} textPayload - The text to be spoken.
 * @param {object} requestingSocket - The controller socket that made the request.
 */
function handleControllerInitiateSpeak(textPayload, requestingSocket) {
    if (!clientMgr) {
        console.error('[SpeakHandler] ClientManager not initialized.');
        return;
    }
    if (typeof textPayload !== 'string') {
        console.warn('[SpeakHandler] Invalid textPayload for speak:', textPayload);
        //TODO: Max need to add error check
        if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: 'Speak command requires a string payload.'});
        return;
    }

    const sentences = utils.txtToSentence(textPayload);
    if (!sentences || sentences.length === 0 || sentences[0] === '') {
        console.warn('[SpeakHandler] No valid sentences to speak from payload:', textPayload);
        if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: 'No valid sentences found in text.'});
        return;
    }

    const speakTurnId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    stateManager.updateSpeakState({
        sentences,
        currentSentenceIndex: 0,
        targetClientPercentage: 0, // Single speaker mode
        rate: stateManager.getSpeakState().rate, // Preserve existing global rate if any
        pitch: stateManager.getSpeakState().pitch, // Preserve existing global pitch if any
        speakTurnId: speakTurnId,
        expectedAcks: 1, // Expect one ack for single speaker mode per sentence
        activeSpeakingClientsInfo: [],
        clientsInCurrentSpeakRound: [],
    });

    // For simple speak, target is usually the "next" in a sequence or a default
    const targetClients = clientMgr.getSpeakTargets({
        type: 'single',
        turnIndex: 0, // For the first sentence, could be a more complex turn logic
    });

    if (!targetClients || targetClients.length === 0) {
        console.warn('[SpeakHandler] No target clients found for simple speak.');
        if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: 'No clients available to speak.'});
        stateManager.resetSpeakState();
        return;
    }
    stateManager.updateSpeakState({ clientsInCurrentSpeakRound: targetClients, expectedAcks: targetClients.length });
    _emitSpeakToClients(targetClients, 0);
}

/**
 * Handles advanced speak requests from the controller (with percentage, rate, pitch).
 * @param {object} dataPayload - Object containing text, percentage, rate, pitch.
 * @param {object} requestingSocket - The controller socket that made the request.
 */
function handleControllerInitiateSpeakAdvance(dataPayload, requestingSocket) {
    if (!clientMgr) {
        console.error('[SpeakHandler] ClientManager not initialized.');
        return;
    }
    if (!dataPayload || typeof dataPayload.text !== 'string') {
        console.warn('[SpeakHandler] Invalid dataPayload for speakAdvance:', dataPayload);
        if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: 'SpeakAdvance requires a text property.'});
        return;
    }

    const sentences = utils.txtToSentence(dataPayload.text);
     if (!sentences || sentences.length === 0 || sentences[0] === '') {
        console.warn('[SpeakHandler] No valid sentences to speak from payload:', dataPayload.text);
        if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: 'No valid sentences found in text.'});
        return;
    }

    const percentage = parseFloat(dataPayload.percentage) || 0;
    const speakTurnId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    stateManager.updateSpeakState({
        sentences,
        currentSentenceIndex: 0,
        targetClientPercentage: percentage,
        rate: dataPayload.rate, // Can be undefined, _emitSpeakToClients will handle
        pitch: dataPayload.pitch, // Can be undefined
        speakTurnId: speakTurnId,
        expectedAcks: 0, // Will be set after getting targets
        activeSpeakingClientsInfo: [],
        clientsInCurrentSpeakRound: [],
    });

    const targetClients = clientMgr.getSpeakTargets({
        type: percentage > 0 && percentage <= 1 ? 'percentage' : 'single', // if percentage is invalid, treat as single
        percentage: percentage,
        // sortArray: dataPayload.sortArray, // If clientManager supports custom sort for speak targets
        turnIndex: 0, // For first sentence
    });

    if (!targetClients || targetClients.length === 0) {
        console.warn('[SpeakHandler] No target clients found for speakAdvance.');
        if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: 'No clients available to speak.'});
        stateManager.resetSpeakState();
        return;
    }

    stateManager.updateSpeakState({
        expectedAcks: targetClients.length,
        clientsInCurrentSpeakRound: targetClients
    });
    _emitSpeakToClients(targetClients, 0);
}

/**
 * Internal function to emit speak data to specified clients and set up timeout.
 * @param {string[]} targetClientIds - Array of socket IDs to emit to.
 * @param {number} sentenceIdx - Index of the sentence to speak.
 * @private
 */
function _emitSpeakToClients(targetClientIds, sentenceIdx) {
    const currentSpeakState = stateManager.getSpeakState();
    if (currentSpeakState.speakTimeoutId) {
        clearTimeout(currentSpeakState.speakTimeoutId);
        stateManager.updateSpeakState({ speakTimeoutId: null });
    }

    const textToSpeak = currentSpeakState.sentences[sentenceIdx];
    if (!textToSpeak) {
        console.error(`[SpeakHandler] Sentence index ${sentenceIdx} out of bounds.`);
        _proceedToNextSpeakSegment(); // Attempt to recover or end
        return;
    }

    const speakPayload = {
        id: currentSpeakState.speakTurnId,
        text: textToSpeak,
        rate: currentSpeakState.rate,
        pitch: currentSpeakState.pitch,
        // voice: client-specific voice could be added here if needed, but usually handled by client
    };

    const activeSpeakers = targetClientIds.map(id => ({
        socketId: id,
        voice: stateManager.getClientVoice(id) || 'default'
    }));
    stateManager.updateSpeakState({ activeSpeakingClientsInfo: activeSpeakers });

    if (receiverNs && targetClientIds.length > 0) {
        receiverNs.to(targetClientIds).emit(EVENT_SPEAK, speakPayload);
        // Inform controller and other receivers about who is speaking
        const nowSpeakPayload = { mode: SPEAK_CONFIG_NOW_SPEAK, data: activeSpeakers, turnId: currentSpeakState.speakTurnId };
        receiverNs.emit(EVENT_SPEAK_CONFIG, nowSpeakPayload);
        if (controllerNs) controllerNs.emit(EVENT_SPEAK_CONFIG, nowSpeakPayload);

        console.log(`[SpeakHandler] Emitted speak (TurnID: ${currentSpeakState.speakTurnId}, Sentence: ${sentenceIdx}) to:`, targetClientIds, speakPayload.text);
    } else {
        console.warn('[SpeakHandler] No receiver namespace or target clients to emit speak event.');
        // If no one to speak, try to advance or reset
        _proceedToNextSpeakSegment();
        return;
    }

    const timeoutMs = utils.calculateSpeakTimeout(
        textToSpeak,
        currentSpeakState.rate,
        currentSpeakState.timeoutDelayMs,
        currentSpeakState.timeoutSpeedFactor
    );

    const newTimeoutId = setTimeout(() => {
        _handleSpeakTimeout(currentSpeakState.speakTurnId);
    }, timeoutMs);
    stateManager.updateSpeakState({ speakTimeoutId: newTimeoutId });
    console.log(`[SpeakHandler] Speak timeout set for ${timeoutMs}ms (TurnID: ${currentSpeakState.speakTurnId})`);
}

/**
 * Handles 'speakOver' event from a receiver.
 * @param {string} socketId - The socket ID of the receiver that finished speaking.
 * @param {object} ackData - Data from receiver, should contain `id` matching `speakTurnId`.
 */
function handleReceiverSpeakOver(socketId, ackData) {
    const currentSpeakState = stateManager.getSpeakState();
    console.log(`[SpeakHandler] Received speakOver from ${socketId} for TurnID: ${ackData ? ackData.id : 'N/A'}. Current TurnID: ${currentSpeakState.speakTurnId}`);

    if (!ackData || ackData.id !== currentSpeakState.speakTurnId) {
        console.warn(`[SpeakHandler] Mismatched speakOver event from ${socketId}. Expected TurnID: ${currentSpeakState.speakTurnId}, Got: ${ackData ? ackData.id : 'N/A'}`);
        return; // Mismatched event, ignore
    }

    // Optional: Verify if this socketId was expected to speak in this round
    // if (!currentSpeakState.clientsInCurrentSpeakRound.includes(socketId)) {
    //     console.warn(`[SpeakHandler] Received speakOver from unexpected client ${socketId} for TurnID ${ackData.id}`);
    //     return;
    // }

    const newExpectedAcks = Math.max(0, currentSpeakState.expectedAcks - 1);
    stateManager.updateSpeakState({ expectedAcks: newExpectedAcks });
    console.log(`[SpeakHandler] TurnID ${ackData.id}: Expected ACKs remaining: ${newExpectedAcks}`);


    if (newExpectedAcks <= 0) {
        if (currentSpeakState.speakTimeoutId) {
            clearTimeout(currentSpeakState.speakTimeoutId);
            stateManager.updateSpeakState({ speakTimeoutId: null });
            console.log(`[SpeakHandler] TurnID ${ackData.id}: All ACKs received, cleared timeout.`);
        }
        _proceedToNextSpeakSegment();
    }
}

/**
 * Handles the scenario where a speak action times out.
 * @param {string} timedOutTurnId - The speakTurnId that timed out.
 * @private
 */
function _handleSpeakTimeout(timedOutTurnId) {
    const currentSpeakState = stateManager.getSpeakState();
    console.warn(`[SpeakHandler] Speak timeout for TurnID: ${timedOutTurnId}. Current TurnID: ${currentSpeakState.speakTurnId}`);

    if (timedOutTurnId === currentSpeakState.speakTurnId) {
        stateManager.updateSpeakState({
            speakTimeoutId: null,
            expectedAcks: 0 // Force proceed by setting acks to 0
        });
        console.log(`[SpeakHandler] TurnID ${timedOutTurnId}: Timeout triggered. Proceeding to next segment.`);
        _proceedToNextSpeakSegment();
    } else {
        console.log(`[SpeakHandler] TurnID ${timedOutTurnId}: Stale timeout, current turn is ${currentSpeakState.speakTurnId}. Ignoring.`);
    }
}

/**
 * Proceeds to the next sentence or ends the speak session.
 * @private
 */
function _proceedToNextSpeakSegment() {
    const currentSpeakState = stateManager.getSpeakState();
    const nextSentenceIndex = currentSpeakState.currentSentenceIndex + 1;

    console.log(`[SpeakHandler] Proceeding to next speak segment. Next sentence index: ${nextSentenceIndex} of ${currentSpeakState.sentences.length}`);

    if (nextSentenceIndex < currentSpeakState.sentences.length) {
        const nextSpeakTurnId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        stateManager.updateSpeakState({
            currentSentenceIndex: nextSentenceIndex,
            speakTurnId: nextSpeakTurnId,
            activeSpeakingClientsInfo: [], // Reset for next segment
            clientsInCurrentSpeakRound: [], // Reset for next segment
            // expectedAcks will be set after getting targets
        });

        const targetClients = clientMgr.getSpeakTargets({
            type: currentSpeakState.targetClientPercentage > 0 && currentSpeakState.targetClientPercentage <= 1 ? 'percentage' : 'single',
            percentage: currentSpeakState.targetClientPercentage,
            turnIndex: nextSentenceIndex, // Or a more complex turn logic for multi-sentence
        });

        if (!targetClients || targetClients.length === 0) {
            console.warn('[SpeakHandler] No target clients for next speak segment. Ending speak session.');
            if (controllerNs) controllerNs.emit(EVENT_SPEAK_OVER_ALL, { message: 'Speak ended: No clients for next segment.', turnId: currentSpeakState.speakTurnId });
            stateManager.resetSpeakState();
            return;
        }
        stateManager.updateSpeakState({
            expectedAcks: targetClients.length,
            clientsInCurrentSpeakRound: targetClients
        });
        _emitSpeakToClients(targetClients, nextSentenceIndex);

    } else {
        console.log('[SpeakHandler] All sentences spoken.');
        if (controllerNs) controllerNs.emit(EVENT_SPEAK_OVER_ALL, { message: 'All sentences spoken.', turnId: currentSpeakState.speakTurnId });
        stateManager.resetSpeakState();
    }
}

/**
 * Handles speak configuration commands from the controller.
 * @param {object} configData - The configuration data.
 * @param {object} requestingSocket - The controller socket.
 */
function handleControllerSpeakConfig(configData, requestingSocket) {
    if (!configData || !configData.mode) {
        console.warn('[SpeakHandler] Invalid speakConfig from controller:', configData);
        if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: 'Invalid configuration data.'});
        return;
    }
    console.log('[SpeakHandler] Controller speakConfig:', configData);

    switch (configData.mode) {
        case SPEAK_CONFIG_CHANGE_TIMEOUT:
            if (typeof configData.delay === 'number' && typeof configData.speed === 'number') {
                stateManager.updateSpeakState({
                    timeoutDelayMs: configData.delay,
                    timeoutSpeedFactor: configData.speed
                });
                if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { success: true, mode: configData.mode, message: 'Timeout parameters updated.' });
            } else {
                 if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: true, mode: configData.mode, message: 'Invalid delay or speed for timeout.' });
            }
            break;
        case SPEAK_CONFIG_SHOW_USER:
            if (requestingSocket) {
                requestingSocket.emit(EVENT_SPEAK_CONFIG, {
                    mode: SPEAK_CONFIG_SHOW_USER,
                    data: stateManager.getClientRegistry().socketToVoicePreference
                });
            }
            break;
        // For modes that should be broadcast to receivers (e.g., global voice change by controller)
        case SPEAK_CONFIG_CHANGE_VOICE: // Example: Controller wants to set a default voice for all
             if (receiverNs) {
                receiverNs.emit(EVENT_SPEAK_CONFIG, configData); // Broadcast to all receivers
                if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { success: true, mode: configData.mode, message: 'Config broadcasted to receivers.' });
             }
            break;
        default:
            // If it's a config meant for receivers but initiated by controller
            if (receiverNs) {
                receiverNs.emit(EVENT_SPEAK_CONFIG, configData);
                console.log(`[SpeakHandler] Relaying speakConfig mode '${configData.mode}' to receivers.`);
                 if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { success: true, mode: configData.mode, message: `Config mode ${configData.mode} broadcasted.` });
            } else {
                console.warn(`[SpeakHandler] Unhandled speakConfig mode from controller: ${configData.mode} or no receiverNs.`);
                if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: true, mode: configData.mode, message: `Unhandled config mode: ${configData.mode}` });
            }
    }
}

/**
 * Handles speak configuration events from a receiver.
 * @param {string} socketId - The socket ID of the receiver.
 * @param {object} configData - The configuration data.
 */
function handleReceiverSpeakConfig(socketId, configData) {
    if (!configData || !configData.mode) {
        console.warn(`[SpeakHandler] Invalid speakConfig from receiver ${socketId}:`, configData);
        return;
    }
    console.log(`[SpeakHandler] Receiver ${socketId} speakConfig:`, configData);

    switch (configData.mode) {
        case SPEAK_CONFIG_CHANGE_VOICE:
            if (typeof configData.voice === 'object' && configData.voice !== null) {
                stateManager.setClientVoice(socketId, configData.voice);
                // Optionally, notify controller or other clients
                // if (controllerNs) controllerNs.emit(EVENT_SPEAK_CONFIG, { mode: 'userVoiceChanged', socketId, voice: configData.voice });
            } else {
                 console.warn(`[SpeakHandler] Invalid voice data for ${SPEAK_CONFIG_CHANGE_VOICE} from ${socketId}:`, configData.voice);
            }
            break;
        default:
            console.warn(`[SpeakHandler] Unhandled speakConfig mode from receiver ${socketId}: ${configData.mode}`);
    }
}

module.exports = {
    initialize,
    handleControllerInitiateSpeak,
    handleControllerInitiateSpeakAdvance,
    handleReceiverSpeakOver,
    handleControllerSpeakConfig,
    handleReceiverSpeakConfig,
    // _emitSpeakToClients, // Internal, not exported
    // _handleSpeakTimeout, // Internal
    // _proceedToNextSpeakSegment, // Internal
};