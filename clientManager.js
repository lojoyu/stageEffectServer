const stateManager = require('./stateManager');

let receiverNsInstance;
// stateManager is used directly via require

/**
 * Initializes the ClientManager with dependencies.
 * @param {object} stateMgr - Instance of StateManager (though we use the direct require).
 * @param {object} receiverNamespace - Initialized receiver namespace instance.
 */
function initialize(stateMgr, receiverNamespace) {
    // stateManager is already available via direct require.
    // The stateMgr param is kept for consistency if direct require is changed later.
    receiverNsInstance = receiverNamespace;
    console.log('ClientManager initialized.');
}

/**
 * Gets all currently connected socket IDs from the receiver namespace.
 * @returns {string[]} An array of socket IDs.
 */
function getConnectedReceiverSocketIds() {
    if (!receiverNsInstance || !receiverNsInstance.sockets) {
        console.warn('[ClientManager] Receiver namespace or sockets not available.');
        return [];
    }
    // receiverNsInstance.sockets is a Map of socket.id to socket object
    return Array.from(receiverNsInstance.sockets.keys());
}

/**
 * Gets a specified percentage of randomly selected connected receiver clients.
 * @param {number} percentage - The percentage of clients to select (0.0 to 1.0).
 * @returns {string[]} An array of selected socket IDs.
 */
function getPercentageClients(percentage) {
    const allClientIds = getConnectedReceiverSocketIds();
    if (!allClientIds.length || percentage <= 0) {
        return [];
    }
    if (percentage >= 1) {
        return [...allClientIds]; // Return all if percentage is 1 or more
    }

    // Shuffle the array (Fisher-Yates shuffle)
    const shuffled = [...allClientIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const count = Math.ceil(shuffled.length * percentage);
    return shuffled.slice(0, count);
}

/**
 * Gets clients sorted or selected based on the order specification.
 * @param {string | string[]} orderSpec - The specification for ordering/selection.
 *   - 'timestamp': Sort by connection timestamp. Uses `stateManager.clientSortConfig.reverse`.
 *   - 'custom': Sort by `stateManager.clientSortConfig.orderDefinition` (map of socketId to sortValue)
 *               and `stateManager.clientSortConfig.reverse`.
 *   - 'middle': Sorts by timestamp, then arranges in a "middle-out" pattern.
 *   - 'random': Randomly shuffles clients.
 *   - Array<string>: An explicit array of socket IDs defining the order.
 * @returns {string[] | Array<string[]>} An array of socket IDs, or an array of arrays for "middle" mode.
 */
function getClientsByOrder(orderSpec) {
    const connectedSocketIds = getConnectedReceiverSocketIds();
    if (!connectedSocketIds.length) {
        return [];
    }

    const clientRegistry = stateManager.getClientRegistry();
    const globalSortConfig = stateManager.getClientSortConfig(); // { orderDefinition, reverse }

    if (Array.isArray(orderSpec)) {
        // Direct order given, filter to ensure clients are connected
        return orderSpec.filter(id => connectedSocketIds.includes(id));
    }

    switch (orderSpec) {
        case 'random':
            // Fisher-Yates shuffle
            const shuffled = [...connectedSocketIds];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;

        case 'middle':
            const timestampSortedForMiddle = [...connectedSocketIds].sort((a, b) => {
                const valA = clientRegistry.socketToUuidTimestamp[a] || 0;
                const valB = clientRegistry.socketToUuidTimestamp[b] || 0;
                return valA - valB;
            });

            if (!timestampSortedForMiddle.length) return [];

            const midIndex = Math.floor(timestampSortedForMiddle.length / 2);
            const resultMiddle = [];
            const left = timestampSortedForMiddle.slice(0, midIndex);
            const middleElement = timestampSortedForMiddle[midIndex];
            const right = timestampSortedForMiddle.slice(midIndex + 1);

            resultMiddle.push([middleElement]); 

            left.reverse(); 

            const maxLength = Math.max(left.length, right.length);
            for (let i = 0; i < maxLength; i++) {
                const pair = [];
                if (i < left.length) pair.push(left[i]);
                if (i < right.length) pair.push(right[i]);
                if (pair.length > 0) resultMiddle.push(pair);
            }
            return resultMiddle; 

        case 'custom':
            const customDefinition = globalSortConfig.orderDefinition; 
            const customReverse = globalSortConfig.reverse;
            if (typeof customDefinition === 'object' && customDefinition !== null) {
                return [...connectedSocketIds].sort((a, b) => {
                    const valA = customDefinition[a] === undefined ? Infinity : customDefinition[a];
                    const valB = customDefinition[b] === undefined ? Infinity : customDefinition[b];
                    return (valA - valB) * (customReverse ? -1 : 1);
                });
            }
            console.warn('[ClientManager] Custom sort orderDefinition is not a valid map, falling back to timestamp sort.');

        case 'timestamp':
        default: 
            const timestampReverse = globalSortConfig.reverse;
            return [...connectedSocketIds].sort((a, b) => {
                const valA = clientRegistry.socketToUuidTimestamp[a] || 0;
                const valB = clientRegistry.socketToUuidTimestamp[b] || 0;
                return (valA - valB) * (timestampReverse ? -1 : 1);
            });
    }
}

/**
 * Gets target clients for a speak operation.
 * @param {object} options
 * @param {'single' | 'percentage'} options.type - Type of selection.
 * @param {number} [options.percentage] - Percentage if type is 'percentage'.
 * @param {number} [options.turnIndex=0] - Current turn/sentence index, used for 'single' type.
 * @param {string | string[]} [options.orderSpec='timestamp'] - Order spec for 'single' type.
 * @returns {string[]} An array of target socket IDs.
 */
function getSpeakTargets({ type, percentage, turnIndex = 0, orderSpec = 'timestamp' }) {
    const connectedSocketIds = getConnectedReceiverSocketIds();
    if (!connectedSocketIds.length) return [];

    if (type === 'percentage' && typeof percentage === 'number' && percentage > 0) {
        return getPercentageClients(percentage);
    } else if (type === 'single') {
        const orderedClients = getClientsByOrder(orderSpec); 
        if (!orderedClients || orderedClients.length === 0) return [];
        const currentTurnIndex = turnIndex % orderedClients.length;
        const selectedGroup = orderedClients[currentTurnIndex];
        if (Array.isArray(selectedGroup)) return selectedGroup.filter(id => connectedSocketIds.includes(id));
        else if (typeof selectedGroup === 'string') return connectedSocketIds.includes(selectedGroup) ? [selectedGroup] : [];
        return [];
    }
    if (connectedSocketIds.length > 0) {
        const defaultOrdered = getClientsByOrder('timestamp');
        return defaultOrdered.length > 0 ? [defaultOrdered[0]] : [];
    }
    return [];
}


module.exports = {
    initialize,
    getConnectedReceiverSocketIds,
    getPercentageClients,
    getClientsByOrder,
    getSpeakTargets,
};