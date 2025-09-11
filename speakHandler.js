const stateManager = require('./stateManager');
const utils = require('./utils');

const {
    EVENT_SPEAK,
    EVENT_SPEAK_OVER,
    EVENT_SPEAK_OVER_ALL, // New event: To controller when all sentences are done
    EVENT_SPEAK_CONFIG,
    SPEAK_CONFIG_CHANGE_VOICE,
    SPEAK_CONFIG_NOW_SPEAK,
    SPEAK_CONFIG_ASSIGN_VOICE,
    SPEAK_CONFIG_CHANGE_TIMEOUT,
    SPEAK_CONFIG_SHOW_USER,
    SPEAK_CONFIG_STOP_SPEAK,
    // EVENT_DEBUG, // If needed for emitting debug messages
} = require('./constants');

let clientMgr;
let receiverNs;
let controllerNs;
let speakTimeoutId = null; // 移至 speakHandler 內部管理

// --- Speak Queue ---
// A queue for 'wait' and 'append' jobs.
let speakQueue = [];

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

function _initiateSpeakSequence(payload, requestingSocket) {
    if (!clientMgr) {
        console.error('[SpeakHandler] ClientManager not initialized.');
        return;
    }
    if (!payload || typeof payload.text !== 'string') {
        console.warn('[SpeakHandler] Invalid payload for speak:', payload);
        if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: 'Speak command requires a payload with a text property.' });
        return;
    }

    const sentenceStrings = utils.txtToSentence(payload.text);
    if (!sentenceStrings || sentenceStrings.length === 0 || sentenceStrings[0] === '') {
        console.warn('[SpeakHandler] No valid sentences to speak from payload:', payload.text);
        if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: 'No valid sentences found in text.'});
        return;
    }

    // Convert sentence strings to sentence objects, each with its own parameters.
    const sentences = sentenceStrings.map(s => ({
        text: s,
        rate: payload.rate, // Can be undefined, _emitSpeakToClients will handle defaults
        pitch: payload.pitch,
    }));

    const percentage = parseFloat(payload.percentage) || 0;
    const speakTurnId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    stateManager.updateSpeakState({
        sentences,
        currentSentenceIndex: 0,
        targetClientPercentage: percentage,
        speakTurnId: speakTurnId,
        expectedAcks: 0, // Will be set after getting targets
        activeSpeakingClientsInfo: [],
        clientsInCurrentSpeakRound: [],
    });

    const targetClients = clientMgr.getSpeakTargets({
        type: percentage > 0 && percentage <= 1 ? 'percentage' : 'single', // if percentage is invalid, treat as single
        percentage: percentage,
        turnIndex: 0, // For first sentence
    });

    if (!targetClients || targetClients.length === 0) {
        console.warn('[SpeakHandler] No target clients found for speak.');
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
 * Handles simple speak requests from the controller.
 * @param {object | string} payload - The payload, expected to be an object with a `text` property, or just the text string itself.
 * @param {object} requestingSocket - The controller socket that made the request.
 */
function handleControllerInitiateSpeak(payload, requestingSocket) {
    let speakPayload;
    // The simple 'speak' event might just send a string, as in the original implementation.
    // We normalize it to the object structure that _initiateSpeakSequence expects.
    if (typeof payload === 'string') {
        speakPayload = { text: payload };
    } else if (typeof payload === 'object' && payload !== null) {
        // It could also be an object like { text: "..." }
        speakPayload = payload;
    }
    _initiateSpeakSequence(speakPayload, requestingSocket);
}

/**
 * Handles advanced speak requests from the controller (with percentage, rate, pitch).
 * @param {object} dataPayload - Object containing text, percentage, rate, pitch.
 * @param {object} requestingSocket - The controller socket that made the request.
 */
function handleControllerInitiateSpeakAdvance(dataPayload, requestingSocket) {
    const queueing = dataPayload.queueing || 'interrupt'; // Default to interrupt
    const currentSpeakState = stateManager.getSpeakState();
    const isSpeaking = currentSpeakState.speakTurnId !== null;

    // 1. INTERRUPT: Stop everything, clear queue, and start immediately.
    if (queueing === 'interrupt') {
        console.log('[SpeakHandler] Received "interrupt" command.');
        speakQueue = []; // Clear any waiting jobs
        _stopAllSpeaking(requestingSocket, false); // Stop current speech without notifying controller yet

        // Add a small delay to allow clients to process the 'stop' command before starting the new sequence.
        // This prevents a race condition where the new 'speak' is cancelled by the 'stop'.
        setTimeout(() => {
            _initiateSpeakSequence(dataPayload, requestingSocket);
        }, 50); // 50ms delay is usually sufficient and not perceptible.
        return;
    }

    // If not speaking, 'wait' and 'append' behave like 'interrupt'.
    if (!isSpeaking) {
        console.log(`[SpeakHandler] Not currently speaking, command "${queueing}" will start immediately.`);
        _initiateSpeakSequence(dataPayload, requestingSocket);
        return;
    }

    // If currently speaking, handle 'wait' and 'append'.
    if (queueing === 'append') {
        console.log('[SpeakHandler] Received "append" command.');
        const newSentences = utils.txtToSentence(dataPayload.text);
        if (newSentences && newSentences.length > 0) {
            // Get the parameters of the last sentence in the current queue to use as a default
            // for the new sentences if the 'append' command doesn't provide them.
            const lastSentence = currentSpeakState.sentences.length > 0
                ? currentSpeakState.sentences[currentSpeakState.sentences.length - 1]
                : {};

            // Create new sentence objects with their own parameters.
            const newSentenceObjects = newSentences.map(s => ({
                text: s,
                rate: dataPayload.rate !== undefined ? dataPayload.rate : lastSentence.rate,
                pitch: dataPayload.pitch !== undefined ? dataPayload.pitch : lastSentence.pitch,
            }));

            const updatedSentences = [...currentSpeakState.sentences, ...newSentenceObjects];

            stateManager.updateSpeakState({ sentences: updatedSentences });

            console.log(`[SpeakHandler] Appended ${newSentences.length} sentences. Total now: ${updatedSentences.length}`);
            if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { success: true, mode: 'append', message: 'Sentences appended with their own parameters.' });
        }
    } else if (queueing === 'wait') {
        console.log('[SpeakHandler] Received "wait" command. Job is queued.');
        // For 'wait', we discard any other waiting jobs and queue this new one.
        speakQueue = [{ payload: dataPayload, socket: requestingSocket }];
        if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { success: true, mode: 'wait', message: 'Speak job is queued and will start after the current sentence.' });
    } else {
        console.warn(`[SpeakHandler] Unknown queueing mode: ${queueing}`);
    }
}

/**
 * Internal function to emit speak data to specified clients and set up timeout.
 * @param {string[]} targetClientIds - Array of socket IDs to emit to.
 * @param {number} sentenceIdx - Index of the sentence to speak.
 * @private
 */
function _emitSpeakToClients(targetClientIds, sentenceIdx) {
    const currentSpeakState = stateManager.getSpeakState(); // 仍然需要獲取其他狀態
    if (speakTimeoutId) { // 使用內部變數
        clearTimeout(speakTimeoutId);
    }

    const sentenceObject = currentSpeakState.sentences[sentenceIdx];
    if (!sentenceObject || !sentenceObject.text) {
        console.error(`[SpeakHandler] Sentence index ${sentenceIdx} out of bounds.`);
        _proceedToNextSpeakSegment(); // Attempt to recover or end
        return;
    }

    const speakPayload = {
        id: currentSpeakState.speakTurnId,
        text: sentenceObject.text,
        rate: sentenceObject.rate,
        pitch: sentenceObject.pitch,
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

        console.log(`[SpeakHandler] Emitted speak (TurnID: ${currentSpeakState.speakTurnId}, Sentence: ${sentenceIdx}) to:`, targetClientIds, speakPayload);
    } else {
        console.warn('[SpeakHandler] No receiver namespace or target clients to emit speak event.');
        // If no one to speak, try to advance or reset
        _proceedToNextSpeakSegment();
        return;
    }

    const timeoutMs = utils.calculateSpeakTimeout(
        sentenceObject.text,
        sentenceObject.rate,
        currentSpeakState.timeoutDelayMs,
        currentSpeakState.timeoutSpeedFactor
    );

    const newTimeoutId = setTimeout(() => {
        _handleSpeakTimeout(currentSpeakState.speakTurnId);
    }, timeoutMs);
    speakTimeoutId = newTimeoutId; // 更新內部變數
    console.log(`[SpeakHandler] Speak timeout set for ${timeoutMs}ms (TurnID: ${currentSpeakState.speakTurnId}, Timeout ID: ${newTimeoutId})`);
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
        // Check and clear the local speakTimeoutId, not from state
        if (speakTimeoutId) {
            clearTimeout(speakTimeoutId); // 使用內部變數
            console.log(`[SpeakHandler] TurnID ${ackData.id}: All ACKs received, cleared timeout (Timeout ID: ${speakTimeoutId}).`);
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
        if (speakTimeoutId) { // 使用內部變數
            clearTimeout(speakTimeoutId);
            speakTimeoutId = null;
        }
        stateManager.updateSpeakState({ // 其他狀態仍然需要更新
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
    const currentSpeakState = stateManager.getSpeakState(); // Get state once

    // 優先檢查：佇列中是否有 'wait' 任務在等待。
    // 如果有，它會中斷當前的任務，並立即開始新任務。
    if (speakQueue.length > 0) {
        const nextJob = speakQueue.shift();
        console.log(`[SpeakHandler] 'wait' job found. Interrupting current job (TurnID: ${currentSpeakState.speakTurnId}) to start new one.`);

        // 通知控制器，前一個任務已被中斷/完成
        if (controllerNs) {
            controllerNs.emit(EVENT_SPEAK_OVER_ALL, {
                message: `Speak job interrupted by a new 'wait' command.`,
                turnId: currentSpeakState.speakTurnId
            });
        }

        // 開始新的語音序列，這個函式會重置相關狀態
        _initiateSpeakSequence(nextJob.payload, nextJob.socket);
        return; // 結束此函式，避免執行後續的舊任務邏輯
    }

    // 如果佇列為空，則繼續執行當前任務的下一句
    const nextSentenceIndex = currentSpeakState.currentSentenceIndex + 1;

    console.log(`[SpeakHandler] Proceeding to next speak segment. Next sentence index: ${nextSentenceIndex} of ${currentSpeakState.sentences.length}`);

    if (nextSentenceIndex < currentSpeakState.sentences.length) {
        const nextSpeakTurnId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        stateManager.updateSpeakState({
            speakTurnId: nextSpeakTurnId,
            activeSpeakingClientsInfo: [], // Reset for next segment
            clientsInCurrentSpeakRound: [], // Reset for next segment
            // expectedAcks will be set after getting targets
        });

        const targetClients = clientMgr.getSpeakTargets({
            // Use the state that was just updated
            type: currentSpeakState.targetClientPercentage > 0 && currentSpeakState.targetClientPercentage <= 1 ? 'percentage' : 'single',
            percentage: currentSpeakState.targetClientPercentage,
            turnIndex: nextSentenceIndex, // Or a more complex turn logic for multi-sentence
        });

        if (!targetClients || targetClients.length === 0) {
            console.warn('[SpeakHandler] No target clients for next speak segment. Ending speak session.');
            if (controllerNs) controllerNs.emit(EVENT_SPEAK_OVER_ALL, { message: 'Speak ended: No clients for next segment.', turnId: currentSpeakState.speakTurnId });
            if (receiverNs) receiverNs.emit(EVENT_SPEAK_OVER_ALL);
            stateManager.resetSpeakState();
            return;
        }
        stateManager.updateSpeakState({
            currentSentenceIndex: nextSentenceIndex, // Update index AFTER getting targets for the correct turnIndex
            expectedAcks: targetClients.length,
            clientsInCurrentSpeakRound: targetClients
        });
        _emitSpeakToClients(targetClients, nextSentenceIndex);

    } else {
        // 當前任務的所有句子都已播放完畢，且佇列中沒有等待的任務
        console.log('[SpeakHandler] All sentences and queued jobs are finished.');
        if (controllerNs) controllerNs.emit(EVENT_SPEAK_OVER_ALL, { message: 'All sentences spoken.', turnId: currentSpeakState.speakTurnId });
        stateManager.resetSpeakState();
    }
}

/**
 * Handles speak configuration commands from the controller.
 * @param {object} configData - The configuration data.
 * @param {object} requestingSocket - The controller socket.
 * @param {boolean} [notifyController=true] - Whether to send a confirmation back to the controller.
 */
function handleControllerSpeakConfig(configData, requestingSocket, notifyController = true) {
    if (!configData || !configData.mode) {
        console.warn('[SpeakHandler] Invalid speakConfig from controller:', configData);
        if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: 'Invalid configuration data.'});
        return;
    }
    console.log('[SpeakHandler] Controller speakConfig:', configData);

    switch (configData.mode) {
        case SPEAK_CONFIG_ASSIGN_VOICE:
            const { socketId, voice, lang } = configData; // socketId is now optional
            if (!voice && !lang) {
                if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: true, mode: configData.mode, message: '`voice` or `lang` is required for assignVoice.' });
                break;
            }

            // The data to be sent to the receiver and stored in the state.
            const voiceConfigPayload = { mode: SPEAK_CONFIG_CHANGE_VOICE };
            if (voice) voiceConfigPayload.voice = voice;
            if (lang) voiceConfigPayload.lang = lang;

            const voicePreference = {};
            if (voice) voicePreference.voice = voice;
            if (lang) voicePreference.lang = lang;

            if (socketId) {
                // Assign to a single, specific client
                stateManager.setClientVoice(socketId, voicePreference);
                if (receiverNs) receiverNs.to(socketId).emit(EVENT_SPEAK_CONFIG, voiceConfigPayload); // Notify receiver
                if (notifyController && requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { success: true, mode: configData.mode, message: `Voice config assigned to specific client ${socketId}.` });
            } else {
                // If no socketId, assign to all connected clients
                const allClientIds = clientMgr.getConnectedReceiverSocketIds();
                allClientIds.forEach(id => {
                    stateManager.setClientVoice(id, voicePreference);
                });
                if (receiverNs) {
                    // Broadcast the change to all receivers
                    receiverNs.emit(EVENT_SPEAK_CONFIG, voiceConfigPayload);
                }
                if (requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { success: true, mode: configData.mode, message: `Voice config assigned to all ${allClientIds.length} clients.` });
            }
            break;
        case SPEAK_CONFIG_CHANGE_TIMEOUT:
            if (typeof configData.delay === 'number' && typeof configData.speed === 'number') {
                stateManager.updateSpeakState({
                    timeoutDelayMs: configData.delay,
                    timeoutSpeedFactor: configData.speed
                });
                if (notifyController && requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { success: true, mode: configData.mode, message: 'Timeout parameters updated.' });
            } else {
                 if (notifyController && requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: true, mode: configData.mode, message: 'Invalid delay or speed for timeout.' });
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
                if (notifyController && requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { success: true, mode: configData.mode, message: 'Config broadcasted to receivers.' });
             }
            break;
        case SPEAK_CONFIG_STOP_SPEAK:
            _stopAllSpeaking(requestingSocket, notifyController);
            break;
        default:
            // If it's a config meant for receivers but initiated by controller
            if (receiverNs) {
                receiverNs.emit(EVENT_SPEAK_CONFIG, configData);
                console.log(`[SpeakHandler] Relaying speakConfig mode '${configData.mode}' to receivers.`);
                 if (notifyController && requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { success: true, mode: configData.mode, message: `Config mode ${configData.mode} broadcasted.` });
            } else {
                console.warn(`[SpeakHandler] Unhandled speakConfig mode from controller: ${configData.mode} or no receiverNs.`);
                if (notifyController && requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { error: true, mode: configData.mode, message: `Unhandled config mode: ${configData.mode}` });
            }
    }
}

/**
 * Stops all current and queued speech immediately.
 * @param {object} requestingSocket - The controller socket that made the request.
 * @param {boolean} [notifyController=true] - Whether to send a confirmation back to the controller.
 * @private
 */
function _stopAllSpeaking(requestingSocket, notifyController = true) {
    console.log('[SpeakHandler] Stop speak command received. Clearing state and notifying clients.');
    if (speakTimeoutId) {
        clearTimeout(speakTimeoutId);
        speakTimeoutId = null;
    }
    speakQueue = []; // Clear waiting jobs
    stateManager.resetSpeakState();
    if (receiverNs) receiverNs.emit(EVENT_SPEAK_CONFIG, { mode: 'stop' }); // Command clients to stop
    if (notifyController && requestingSocket) requestingSocket.emit(EVENT_SPEAK_CONFIG, { success: true, mode: 'stopSpeak', message: 'All speak sequences stopped.' });
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