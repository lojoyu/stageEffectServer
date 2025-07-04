const http = require('http');
const { Server } = require('socket.io');
const constants = require('./constants'); // Import all constants
const stateManager = require('./stateManager'); // No initialize function, state is managed internally
const clientManager = require('./clientManager');
const controlHandler = require('./controlHandler');
const speakHandler = require('./speakHandler');
const connectionManager = require('./connectionManager');


const server = http.createServer();
const io = new Server(server, {
	cors: {
	  origin: constants.CORS_ORIGIN,
	  methods: ['GET', 'POST'],
	  credentials: true
	},
  });

// Define Socket.IO namespaces
const receiverNamespace = io.of('/receiver');
const controllerNamespace = io.of('/controller');
const userNamespace = io.of('/user');

// Initialize Managers and Handlers
// stateManager is used directly via require where needed and doesn't have an init function.

// clientManager needs the receiverNamespace to access sockets.
// stateManager is required directly within clientManager.
clientManager.initialize(stateManager, receiverNamespace);

// controlHandler needs clientManager instance and receiverNamespace.
controlHandler.initialize(clientManager, receiverNamespace);

// speakHandler needs clientManager, utils, receiverNamespace, and controllerNamespace.
speakHandler.initialize(clientManager, receiverNamespace, controllerNamespace);

// connectionManager needs all namespaces and initialized handlers.
connectionManager.initialize(receiverNamespace, controllerNamespace, userNamespace, controlHandler, speakHandler);

server.listen(constants.PORT, () => {
    console.log(`Listening on port ${constants.PORT}`);
});

// Export io and server if they need to be accessed by other modules directly (though ideally not)
// module.exports = { io, server };