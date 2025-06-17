# Stage Effect Server - Refactored Structure

This document outlines a refactored structure for the `stageEffectServer` to improve modularity, maintainability, and clarity by separating concerns into distinct modules.

## I. Core Modules

The application will be reorganized into the following core modules (JavaScript files):

1.  **`server.js` (Main Entry Point & Socket.IO Setup)**
2.  **`stateManager.js` (Centralized and Structured State Management)**
3.  **`connectionManager.js` (Handles Socket Connections, Disconnections, and Basic ID Mapping)**
4.  **`controlHandler.js` (Processes Generic Control Data from the Controller Namespace)**
5.  **`speakHandler.js` (Manages All Speech-Related Logic, Events, and Flow)**
6.  **`clientManager.js` (Client Selection, Sorting, and Grouping Logic)**
7.  **`utils.js` (General Utility Functions, e.g., Text Processing)**
8.  **`constants.js` (Application-wide Constants like Event Names and Modes)**

## II. Module Details and Function Signatures

### 1. `server.js`

*   **Responsibilities**:
    *   Initialize HTTP server and Socket.IO instance with CORS configuration.
    *   Define Socket.IO namespaces (`/receiver`, `/controller`, `/user`).
    *   Import and delegate connection events for each namespace to `connectionManager.js`.
    *   Start the server.
*   **Key Setup**:
    ```javascript
    // const http = require('http');
    // const { Server } = require('socket.io');
    // const { PORT } = require('./constants');
    // const connectionManager = require('./connectionManager');
    // const stateManager = require('./stateManager'); // Potentially for initializing state

    // const server = http.createServer();
    // const io = new Server(server, { /* CORS config */ });

    // const receiverNamespace = io.of('/receiver');
    // const controllerNamespace = io.of('/controller');
    // const userNamespace = io.of('/user');

    // connectionManager.initialize(receiverNamespace, controllerNamespace, userNamespace, stateManager);

    // server.listen(PORT, () => console.log(`Listening on ${PORT}`));
    ```

### 2. `stateManager.js`

*   **Responsibilities**:
    *   Define, initialize, and manage the application's shared state, replacing the monolithic `emitInfo`.
    *   Provide clear accessor and mutator functions for different parts of the state.
*   **Proposed State Structure (Conceptual)**:
    *   `controlState`:
        *   `loopIntervalId`: Stores `setInterval` ID for control data loops.
        *   `intervalTimeMs`: Interval for emitting control data.
        *   `currentDataPayload`: The data object to be emitted.
        *   `isLoopActive`: Boolean.
        *   `currentMode`: e.g., `{ type: MODE_NORMAL, percentage: 0.5 }` or `{ type: MODE_TAKETURN, order: 1, takeTurnIndex: 0 }`.
    *   `speakState`:
        *   `sentences`: Array of strings.
        *   `currentSentenceIndex`: Number.
        *   `targetClientPercentage`: For multi-client speak.
        *   `clientsInCurrentSpeakRound`: Array of `socket.id`s.
        *   `expectedAcks`: Number of clients expected to send `speakOver`.
        *   `activeSpeakingClientsInfo`: Array of objects (e.g., `{ socketId, voice }`).
        *   `speakTimeoutId`: Stores `setTimeout` ID for speak timeouts.
        *   `timeoutDelayMs`: Base delay for speak timeout.
        *   `timeoutSpeedFactor`: Multiplier for text length in timeout calculation.
        *   `speakTurnId`: Unique ID for current speak emission, helps match `speakOver` events.
    *   `clientRegistry`:
        *   `socketToUuidTimestamp`: Maps `socket.id` to the timestamp of its `uuid`'s first connection.
        *   `uuidToInitialTimestamp`: Maps `uuid` to its very first connection timestamp (for consistent ordering).
        *   `socketToVoicePreference`: Maps `socket.id` to selected voice.
        *   `clientSortConfig`: `{ orderDefinition: null, reverse: false }` (replaces `emitInfo.sortArray` and `emitInfo.reverse` for general client sorting).
*   **Key Functions**:
    *   `getControlState()`: Returns a copy or immutable view of `controlState`.
    *   `updateControlState(partialUpdate)`: Updates `controlState`.
    *   `getSpeakState()`: Returns a copy or immutable view of `speakState`.
    *   `updateSpeakState(partialUpdate)`: Updates `speakState`.
    *   `resetSpeakState()`
    *   `getClientRegistry()`: Returns client registry data.
    *   `registerClient(socketId, uuid)`
    *   `unregisterClient(socketId)`
    *   `setClientVoice(socketId, voice)`
    *   `getClientVoice(socketId)`
    *   `getUuidTimestamp(uuid)`
    *   `getSocketUuidTimestamp(socketId)`
    *   `setClientSortConfig(orderDefinition, reverse)`
    *   `getClientSortConfig()`

### 3. `connectionManager.js`

*   **Responsibilities**:
    *   Handle `connection` and `disconnect` events for all namespaces.
    *   Manage basic client registration/unregistration via `stateManager`.
    *   Route namespace-specific events to their respective handlers (`controlHandler`, `speakHandler`).
*   **Key Functions**:
    *   `initialize(receiverNs, controllerNs, userNs, stateMgr, ctrlHandler, spkHandler)`: Store references.
    *   `setupReceiverConnections()`:
        *   `receiverNs.on('connection', (socket) => { ... })`
            *   `socket.on('connected', ({ uuid }) => { stateMgr.registerClient(socket.id, uuid); controllerNs.emit(EVENT_USER_CONNECT, { /* info */ }); })`
            *   `socket.on('disconnect', () => { stateMgr.unregisterClient(socket.id); /* potentially notify controller */ })`
            *   `socket.on(EVENT_SPEAK_CONFIG, (data) => spkHandler.handleReceiverSpeakConfig(socket.id, data))`
            *   `socket.on(EVENT_SPEAK_OVER, (data) => spkHandler.handleReceiverSpeakOver(socket.id, data))`
            *   `socket.on(EVENT_DEBUG, (data) => { /* handle or emit */ })`
    *   `setupUserConnections()`:
        *   `userNs.on('connection', (socket) => { ... })`
            *   `socket.on(EVENT_OSC, (data) => controllerNs.emit(EVENT_OSC, data))`
    *   `setupControllerConnections()`:
        *   `controllerNs.on('connection', (socket) => { ... })`
            *   `socket.emit(EVENT_DEBUG, 'Controller connected')`
            *   `socket.on(EVENT_CONTROL_DATA, (data) => ctrlHandler.processControlData(data, socket))`
            *   `socket.on('showClient', (order) => ctrlHandler.handleShowClient(order, socket))`
            *   `socket.on('pause', (data) => { /* TBD, maybe ctrlHandler.handlePause(data, socket) */ })`
            *   `socket.on(EVENT_SPEAK, (data) => spkHandler.handleControllerInitiateSpeak(data, socket))`
            *   `socket.on('speakAdvance', (data) => spkHandler.handleControllerInitiateSpeakAdvance(data, socket))`
            *   `socket.on(EVENT_SPEAK_CONFIG, (data) => spkHandler.handleControllerSpeakConfig(data, socket))`

### 4. `controlHandler.js`

*   **Responsibilities**:
    *   Process `controlData` from the controller.
    *   Manage non-speak related control loops and emissions.
*   **Dependencies**: `stateManager`, `clientManager`, `receiverNamespace` (passed or accessible).
*   **Key Functions**:
    *   `initialize(stateMgr, clientMgr, receiverNs)`
    *   `processControlData(data, requestingSocket)`:
        *   Validates `data` (e.g., `if (!data || !data.mode)`).
        *   Updates `stateManager.controlState` (mode, payload, intervalTimeMs).
        *   If `intervalTimeMs === 0`, calls `emitControlDataToReceivers()`.
        *   Else, starts/restarts `managedControlLoop()`.
    *   `managedControlLoop()`: (Replaces `emitDataWithNextTime`)
        *   Clears existing interval `stateManager.controlState.loopIntervalId`.
        *   If `stateManager.controlState.intervalTimeMs > 0`:
            *   Calls `emitControlDataToReceivers()`.
            *   Sets new interval: `stateMgr.updateControlState({ loopIntervalId: setInterval(emitControlDataToReceivers, stateMgr.getControlState().intervalTimeMs) })`.
        *   Else, ensures loop is stopped.
    *   `emitControlDataToReceivers()`: (Core logic from `receiverEmit` for non-speak)
        *   Retrieves `currentMode` and `currentDataPayload` from `stateManager.controlState`.
        *   Uses `clientManager` to get target `socket.id`s based on `currentMode` (normal percentage, taketurn order).
        *   Updates `stateManager.controlState.currentMode.takeTurnIndex` if applicable for taketurn.
        *   If taketurn loop completes, potentially stops the loop by setting `intervalTimeMs = 0` in state.
        *   Constructs target emitter (e.g., `receiverNs.to(targetSocketIdArray)`) and emits `EVENT_CONTROL_DATA`.
    *   `handleShowClient(order, requestingSocket)`:
        *   Uses `clientManager.getClientsByOrder(order)` (which uses `stateManager` for sort config).
        *   `requestingSocket.emit(EVENT_DEBUG, /* client list */)`.

### 5. `speakHandler.js`

*   **Responsibilities**:
    *   Handle all speak-related commands from the controller.
    *   Manage sentence processing, speaker selection for speech, speech flow, and timeouts.
    *   Handle `speakOver` and `speakConfig` events from receivers.
*   **Dependencies**: `stateManager`, `clientManager`, `utils`, `receiverNamespace`, `controllerNamespace`.
*   **Key Functions**:
    *   `initialize(stateMgr, clientMgr, utilsLib, receiverNs, controllerNs)`
    *   `handleControllerInitiateSpeak(textPayload, requestingSocket)`: (Replaces `controllerOnSpeak`)
        *   `sentences = utilsLib.txtToSentence(textPayload)`.
        *   `stateMgr.updateSpeakState({ sentences, currentSentenceIndex: 0, targetClientPercentage: 0, speakTurnId: Date.now() /* or other unique id */, expectedAcks: 1 })`.
        *   `targetClients = clientMgr.getSpeakTargets({ type: 'single', turnIndex: stateMgr.getSpeakState().currentSentenceIndex /* or a dedicated speak turn counter */ })`.
        *   `_emitSpeakToClients(targetClients, 0)`.
    *   `handleControllerInitiateSpeakAdvance(dataPayload, requestingSocket)`: (Replaces `controllerOnSpeakAdvance`)
        *   `sentences = utilsLib.txtToSentence(dataPayload.text)`.
        *   `stateMgr.updateSpeakState({ sentences, currentSentenceIndex: 0, targetClientPercentage: dataPayload.percentage, rate: dataPayload.rate, pitch: dataPayload.pitch, speakTurnId: Date.now(), expectedAcks: /* calculated based on targets */ })`.
        *   `targetClients = clientMgr.getSpeakTargets({ type: 'percentage', percentage: dataPayload.percentage })`.
        *   `stateMgr.updateSpeakState({ expectedAcks: targetClients.length })`.
        *   `_emitSpeakToClients(targetClients, 0)`.
    *   `_emitSpeakToClients(targetClientIds, sentenceIdx)`: (Replaces core of `emitSpeak` and parts of `nextSpeak`)
        *   Clears existing `stateMgr.getSpeakState().speakTimeoutId`.
        *   `currentSpeakState = stateMgr.getSpeakState()`.
        *   `textToSpeak = currentSpeakState.sentences[sentenceIdx]`.
        *   `speakPayload = { id: currentSpeakState.speakTurnId, text: textToSpeak, rate: currentSpeakState.rate, pitch: currentSpeakState.pitch }`.
        *   `activeSpeakers = targetClientIds.map(id => ({ socketId: id, voice: stateMgr.getClientVoice(id) }))`.
        *   `stateMgr.updateSpeakState({ activeSpeakingClientsInfo: activeSpeakers })`.
        *   `receiverNs.to(targetClientIds).emit(EVENT_SPEAK, speakPayload)`.
        *   `receiverNs.emit(EVENT_SPEAK_CONFIG, { mode: SPEAK_CONFIG_NOW_SPEAK, data: activeSpeakers })`.
        *   `controllerNs.emit(EVENT_SPEAK_CONFIG, { mode: SPEAK_CONFIG_NOW_SPEAK, data: activeSpeakers })`.
        *   `timeoutMs = utilsLib.calculateSpeakTimeout(textToSpeak, currentSpeakState.rate, currentSpeakState.timeoutDelayMs, currentSpeakState.timeoutSpeedFactor)`.
        *   `newTimeoutId = setTimeout(() => _handleSpeakTimeout(currentSpeakState.speakTurnId), timeoutMs)`.
        *   `stateMgr.updateSpeakState({ speakTimeoutId: newTimeoutId })`.
    *   `handleReceiverSpeakOver(socketId, ackData)`: (Replaces `receiverOnSpeakover`)
        *   `currentSpeakState = stateMgr.getSpeakState()`.
        *   If `ackData.id !== currentSpeakState.speakTurnId`, return (mismatched event).
        *   `newExpectedAcks = currentSpeakState.expectedAcks - 1`.
        *   `stateMgr.updateSpeakState({ expectedAcks: newExpectedAcks })`.
        *   If `newExpectedAcks <= 0`, clear `currentSpeakState.speakTimeoutId` and call `_proceedToNextSpeakSegment()`.
    *   `_handleSpeakTimeout(timedOutTurnId)`: (Replaces `speakTimeout`)
        *   `currentSpeakState = stateMgr.getSpeakState()`.
        *   If `timedOutTurnId === currentSpeakState.speakTurnId`:
            *   `stateMgr.updateSpeakState({ speakTimeoutId: null, expectedAcks: 0 /* force proceed */ })`.
            *   `_proceedToNextSpeakSegment()`.
    *   `_proceedToNextSpeakSegment()`: (Replaces parts of `nextSpeak`)
        *   `currentSpeakState = stateMgr.getSpeakState()`.
        *   `nextSentenceIndex = currentSpeakState.currentSentenceIndex + 1`.
        *   If `nextSentenceIndex < currentSpeakState.sentences.length`:
            *   `stateMgr.updateSpeakState({ currentSentenceIndex: nextSentenceIndex, speakTurnId: Date.now(), activeSpeakingClientsInfo: [] })`.
            *   `targetClients = clientMgr.getSpeakTargets({ type: currentSpeakState.targetClientPercentage > 0 ? 'percentage' : 'single', percentage: currentSpeakState.targetClientPercentage, turnIndex: nextSentenceIndex })`.
            *   `stateMgr.updateSpeakState({ expectedAcks: targetClients.length })`.
            *   `_emitSpeakToClients(targetClients, nextSentenceIndex)`.
        *   Else (all sentences spoken):
            *   `controllerNs.emit(EVENT_SPEAK_OVER_ALL, { message: 'All sentences spoken.' })`.
            *   `stateMgr.resetSpeakState()`.
    *   `handleControllerSpeakConfig(configData, requestingSocket)`: (Replaces `controllerOnSpeakConfig`)
        *   If `configData.mode === SPEAK_CONFIG_CHANGE_TIMEOUT`: update `stateManager.speakState.timeoutDelayMs`, `timeoutSpeedFactor`.
        *   If `configData.mode === SPEAK_CONFIG_SHOW_USER`: `requestingSocket.emit(EVENT_SPEAK_CONFIG, { mode: SPEAK_CONFIG_SHOW_USER, data: stateMgr.getClientRegistry().socketToVoicePreference })`.
        *   Else (e.g., `changeVoiceAll`): `receiverNs.emit(EVENT_SPEAK_CONFIG, configData)`.
    *   `handleReceiverSpeakConfig(socketId, configData)`: (Replaces `receiverOnSpeakConfig`)
        *   If `configData.mode === SPEAK_CONFIG_CHANGE_VOICE`: `stateMgr.setClientVoice(socketId, configData.voice)`.

### 6. `clientManager.js`

*   **Responsibilities**:
    *   Provide functions to get and filter connected receiver clients based on various criteria.
*   **Dependencies**: `stateManager`, `receiverNamespace.sockets`.
*   **Key Functions**:
    *   `initialize(stateMgr, receiverNs)`
    *   `getConnectedReceiverSocketIds()`: Returns array of `socket.id`s from `receiverNs.sockets`.
    *   `getPercentageClients(percentage)`:
        *   Gets all receiver IDs, shuffles them randomly.
        *   Returns the top `percentage` of IDs.
    *   `getClientsByOrder(orderSpec)`: (Replaces `getClientsByOrder`)
        *   Uses `stateManager.getClientRegistry().socketToUuidTimestamp` and `stateManager.getClientRegistry().uuidToInitialTimestamp` for sorting.
        *   Uses `stateManager.getClientSortConfig()` for custom order arrays or reverse.
        *   Implements "middle" out logic if `orderSpec === 'middle'`.
        *   Returns sorted array of `socket.id`s (or array of arrays for "middle").
    *   `getSpeakTargets({ type, percentage, turnIndex })`:
        *   If `type === 'single'`: Uses `getClientsByOrder()` and `turnIndex % clients.length` to pick one.
        *   If `type === 'percentage'`: Uses `getPercentageClients(percentage)`.
        *   Returns array of `socket.id`s.

### 7. `utils.js`

*   **Responsibilities**: Contain generic, reusable helper functions.
*   **Key Functions**:
    *   `txtToSentence(text)`:
        *   Splits text into sentences using `/[^.,!?:]+[.,!?:;]*/g`.
        *   Robustly handles `null` or empty `text.match()` results (return `['']` or `[]`).
        *   Correctly removes trailing punctuation from the last sentence.
    *   `calculateSpeakTimeout(text, rate, baseDelayMs, speedFactor)`:
        *   `duration = text.length * speedFactor`.
        *   If `rate`, `duration /= rate`.
        *   Returns `duration + baseDelayMs`.

### 8. `constants.js`

*   **Responsibilities**: Define application-wide string constants.
*   **Example Content**:
    ```javascript
    // server.js
    export const PORT = process.env.PORT || 8000;
    export const CORS_ORIGIN = 'http://localhost:5173';

    // Event Names
    export const EVENT_CONTROL_DATA = 'controlData';
    export const EVENT_SPEAK = 'speak';
    export const EVENT_SPEAK_OVER = 'speakOver'; // From receiver for one segment
    export const EVENT_SPEAK_OVER_ALL = 'speakOverAll'; // To controller when all sentences done
    export const EVENT_SPEAK_CONFIG = 'speakConfig';
    export const EVENT_USER_CONNECT = 'userConnect';
    export const EVENT_DEBUG = 'debug';
    export const EVENT_OSC = 'osc';
    // ... other events

    // Modes
    export const MODE_NORMAL = 'normal';
    export const MODE_TAKETURN = 'taketurn';
    // export const MODE_SPEAK = 'speak'; // This is more of a state/handler than a control mode

    // Speak Config Sub-modes
    export const SPEAK_CONFIG_CHANGE_VOICE = 'changeVoice';
    export const SPEAK_CONFIG_NOW_SPEAK = 'nowSpeak';
    export const SPEAK_CONFIG_CHANGE_TIMEOUT = 'changeTimeout';
    export const SPEAK_CONFIG_SHOW_USER = 'showUser';
    ```

## III. Key Benefits of This Structure

*   **Improved State Management**: `stateManager.js` provides a single source of truth with clear interfaces, avoiding widespread mutation of a global `emitInfo`.
*   **Modularity & Separation of Concerns**: Each file has a distinct responsibility, making the codebase easier to understand, test, and maintain.
*   **Reduced Coupling**: Modules interact through well-defined interfaces (function calls, state manager), reducing hidden dependencies.
*   **Enhanced Testability**: Smaller, focused modules are easier to unit test.
*   **Scalability**: Easier to add new features or modify existing ones without impacting unrelated parts of the system.
*   **Clarity**: Explicitly passing dependencies (like `stateManager` or namespaces) to modules makes data flow more transparent.

This refactoring represents a significant architectural change but should lead to a more robust and manageable application in the long run.
