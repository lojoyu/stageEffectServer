// Import constants if needed, e.g., for initial state values or modes
const {
    MODE_NORMAL, // Example if needed for initial mode
    SPEAK_TIMEOUT_DEFAULT_DELAY_MS,
    SPEAK_TIMEOUT_DEFAULT_SPEED_FACTOR
} = require('./constants');

// Define the initial state structure
let state = {
    controlState: {
        intervalTimeMs: 0,    // Interval for emitting control data
        currentDataPayload: {}, // The data object to be emitted
        isLoopActive: false,  // Boolean //TODO: check if this is needed, or can be derived from intervalTimeMs > 0
        currentMode: { type: 'normal', percentage: 0 }, // e.g., { type: MODE_NORMAL, percentage: 0.5 } or { type: MODE_TAKETURN, order: 1, takeTurnIndex: 0 }
    },
    speakState: {
        sentences: [],              // Array of strings
        currentSentenceIndex: 0,    // Number
        targetClientPercentage: 0,  // For multi-client speak
        rate: undefined,            // Speech rate
        pitch: undefined,           // Speech pitch
        clientsInCurrentSpeakRound: [], // Array of socket.id's for the current speak emission
        expectedAcks: 0,            // Number of clients expected to send speakOver
        activeSpeakingClientsInfo: [], // Array of objects (e.g., { socketId, voice })
        timeoutDelayMs: SPEAK_TIMEOUT_DEFAULT_DELAY_MS,        // Base delay for speak timeout
        timeoutSpeedFactor: SPEAK_TIMEOUT_DEFAULT_SPEED_FACTOR,    // Multiplier for text length in timeout calculation
        speakTurnId: null,          // Unique ID for current speak emission
    },
    clientRegistry: {
        socketToUuidTimestamp: {}, // Maps socket.id to the timestamp of its uuid's first connection (this session)
        uuidToInitialTimestamp: {}, // Maps uuid to its very first connection timestamp (across sessions, if persistent storage were used, but here just first seen)
        socketToUuid: {},          // Maps socket.id directly to its uuid for efficient lookups
        socketToVoicePreference: {}, // Maps socket.id to selected voice
        clientSortConfig: { orderDefinition: null, reverse: false }, // Replaces emitInfo.sortArray and emitInfo.reverse for general client sorting
    },
};

// --- Accessor Functions ---

/**
 * Get a copy of the current control state.
 * @returns {object} A copy of the control state.
 */
const getControlState = () => {
    // Return a deep copy to prevent external modification
    //return JSON.parse(JSON.stringify(state.controlState));
    return { ...state.controlState };

};

/**
 * Get a copy of the current speak state.
 * @returns {object} A copy of the speak state.
 */
const getSpeakState = () => {
     // Return a deep copy to prevent external modification
    //return JSON.parse(JSON.stringify(state.speakState));
    return { ...state.speakState };
};

/**
 * Get a copy of the client registry data.
 * @returns {object} A copy of the client registry.
 */
const getClientRegistry = () => {
     // Return a deep copy to prevent external modification
    // return JSON.parse(JSON.stringify(state.clientRegistry));
    return { ...state.clientRegistry };
};

/**
 * Get the voice preference for a given socket ID.
 * @param {string} socketId - The ID of the socket.
 * @returns {string | undefined} The voice preference or undefined if not set.
 */
const getClientVoice = (socketId) => {
    return state.clientRegistry.socketToVoicePreference[socketId];
};

/**
 * Get the initial connection timestamp for a given UUID.
 * @param {string} uuid - The UUID of the client.
 * @returns {number | undefined} The timestamp or undefined if not registered.
 */
const getUuidTimestamp = (uuid) => {
    return state.clientRegistry.uuidToInitialTimestamp[uuid];
};

/**
 * Get the UUID's connection timestamp for a given socket ID.
 * @param {string} socketId - The ID of the socket.
 * @returns {number | undefined} The timestamp or undefined if not registered.
 */
const getSocketUuidTimestamp = (socketId) => {
    return state.clientRegistry.socketToUuidTimestamp[socketId];
};

/**
 * Get the UUID for a given socket ID.
 * @param {string} socketId - The ID of the socket.
 * @returns {string | undefined} The UUID or undefined if not registered.
 */
const getUuidBySocketId = (socketId) => {
    return state.clientRegistry.socketToUuid[socketId];
};

/**
 * Get the current client sorting configuration.
 * @returns {object} The client sort configuration.
 */
const getClientSortConfig = () => {
    // Return a copy
    return { ...state.clientRegistry.clientSortConfig };
};


// --- Mutator Functions ---

/**
 * Update the control state with partial data.
 * @param {object} partialUpdate - An object containing properties to update in controlState.
 */
const updateControlState = (partialUpdate) => {
    state.controlState = { ...state.controlState, ...partialUpdate };
    // console.log('Control state updated:', state.controlState); // Optional: for debugging
};

/**
 * Update the speak state with partial data.
 * @param {object} partialUpdate - An object containing properties to update in speakState.
 */
const updateSpeakState = (partialUpdate) => {
    state.speakState = { ...state.speakState, ...partialUpdate };
    // console.log('Speak state updated:', state.speakState); // Optional: for debugging
};

/**
 * Reset the speak state to its initial values.
 */
const resetSpeakState = () => {
    state.speakState = {
        sentences: [],
        currentSentenceIndex: 0,
        targetClientPercentage: 0,
        rate: undefined,
        pitch: undefined,
        clientsInCurrentSpeakRound: [],
        expectedAcks: 0,
        activeSpeakingClientsInfo: [],
        timeoutDelayMs: state.speakState.timeoutDelayMs, // Keep custom timeout settings if any
        timeoutSpeedFactor: state.speakState.timeoutSpeedFactor, // Keep custom timeout settings if any
        speakTurnId: null,
    };
    // console.log('Speak state reset.'); // Optional: for debugging
};

/**
 * Register a new client connection.
 * @param {string} socketId - The ID of the new socket.
 * @param {string} uuid - The UUID of the client device.
 */
const registerClient = (socketId, uuid) => {
    const now = Date.now();
    // If this UUID is seen for the first time ever, record its initial timestamp
    if (!(uuid in state.clientRegistry.uuidToInitialTimestamp)) {
        state.clientRegistry.uuidToInitialTimestamp[uuid] = now;
    }
    // Record the timestamp for this specific socket connection
    state.clientRegistry.socketToUuidTimestamp[socketId] = state.clientRegistry.uuidToInitialTimestamp[uuid];
    state.clientRegistry.socketToUuid[socketId] = uuid; // Add direct mapping for efficiency
    // Initialize voice preference if not exists (or set a default)
    if (!(socketId in state.clientRegistry.socketToVoicePreference)) {
         state.clientRegistry.socketToVoicePreference[socketId] = 'default'; // Or some default voice identifier
    }
    console.log(`Client registered: socketId=${socketId}, uuid=${uuid}`); // Optional: for debugging
    // console.log('Client Registry:', state.clientRegistry); // Optional: for debugging
};

/**
 * Unregister a client connection.
 * @param {string} socketId - The ID of the socket to unregister.
 */
const unregisterClient = (socketId) => {
    // Note: We don't remove the uuidToInitialTimestamp as it tracks the first seen time
    //TODO: Make sure we don't need to remove.
    delete state.clientRegistry.socketToUuidTimestamp[socketId];
    delete state.clientRegistry.socketToUuid[socketId];
    delete state.clientRegistry.socketToVoicePreference[socketId]; // Remove voice preference for this disconnected socket
    console.log(`Client unregistered: socketId=${socketId}`); // Optional: for debugging
    // console.log('Client Registry:', state.clientRegistry); // Optional: for debugging
};

/**
 * Set the voice preference for a specific socket ID.
 * @param {string} socketId - The ID of the socket.
 * @param {string} voice - The voice preference string.
 */
const setClientVoice = (socketId, voice) => {
    if (socketId in state.clientRegistry.socketToUuidTimestamp) { // Only set if the socket is currently registered
        state.clientRegistry.socketToVoicePreference[socketId] = voice;
        console.log(`Voice preference set for ${socketId}: ${voice}`); // Optional: for debugging
    } else {
        console.warn(`Attempted to set voice for unregistered socket: ${socketId}`); // Optional: for debugging
    }
};

/**
 * Set the client sorting configuration.
 * @param {any} orderDefinition - The definition for sorting (e.g., number for reverse, array for custom order).
 * @param {boolean} reverse - Whether to reverse the sort order.
 */
const setClientSortConfig = (orderDefinition, reverse) => {
    state.clientRegistry.clientSortConfig = {
        orderDefinition: orderDefinition,
        reverse: reverse
    };
    console.log('Client sort config updated:', state.clientRegistry.clientSortConfig); // Optional: for debugging
};


// --- Export Functions ---
module.exports = {
    getControlState,
    updateControlState,
    getSpeakState,
    updateSpeakState,
    resetSpeakState,
    getClientRegistry,
    registerClient,
    unregisterClient,
    setClientVoice,
    getClientVoice,
    getUuidTimestamp,
    getSocketUuidTimestamp,
    getUuidBySocketId,
    setClientSortConfig,
    getClientSortConfig,
};