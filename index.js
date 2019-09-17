const http = require('http');
const socketio = require('socket.io');
const port = process.env.PORT || 8000

const server = http.createServer((req, res) => {
    //res.end("")
    //res.sendFile(__dirname + '/index.html');
});
const io = socketio(server);
const receiver = io.of('/receiver');
const controller = io.of('/controller');

var emitInfo = {
	loop: null,
	intervalTime: 0,
	data: {},
	waiting: false,
	mode: {},
	taketurnId: 0
}

var connectIndex = 0;
var socketToIndex = {};
var uuidToIndex = {};

//socket.emit: send to self(sender)
//socket.broadcast.emit: send to others in same namespace
//receiver.emit(namespace.emit): send to all

receiver.on('connection', (socket, req) => {
	socket.on('connected', ({uuid}) => {
		console.log(`${socket.id} connected`);
		if (!(uuid in uuidToIndex)) {
			//uuidToIndex[uuid] = connectIndex++;
			uuidToIndex[uuid] = Date.now();
		} 
		socketToIndex[socket.id] = uuidToIndex[uuid];
		console.log(socketToIndex);
	})

	socket.on('disconnect', function() {
		delete socketToIndex[socket.id];
    	console.log(`${socket.id} disconnect!`);
   });
})

controller.on('connection', (socket) => {
	console.log("controller connected");
	controller.emit('debug', 'welcome!');

	socket.on('controlData', (data) => {
		//console.log(data.light);
		// check for mode
		if (!mode in data) {
			socket.emit('debug', "ERROR: control data don't have mode!");
			return;
		}
		var mode = data.mode;
		delete data.mode;
		emitInfo.mode = mode;
		emitInfo.data = data;
		emitInfo.intervalTime = mode.interval;

		if (mode.interval == 0) { // ONLY ONCE
			receiverEmit();
			//receiver.emit('controlData', data);
		} else if (mode.type == "normal") {
			if (!emitInfo.waiting) //if there is no timeout func running
				emitDataWithNextTime();
		} else if (mode.type == "taketurn") {
			//TODO: implement taketurn
			emitInfo.taketurnId = 0;
			//emitInfo.intervalTime = 0;
			emitDataWithNextTime();
		}
	})

	// why cannot use controller
	socket.on('showClient', ()=> {
		console.log("showClient...");
		socket.emit('debug', getClientsByOrder());
		//testSendRandom(1);
		//testSendRandom(0.5);

		//console.log(getPercentageClient(1));
		//console.log(getPercentageClient(0.5));
		// receiver.clients((error, clients) => {
		// 	if (error) throw error;
		// 	console.log(clients);
		// 	socket.emit('showClient', clients);
			
		// 	// for (let i=0; i<5; i++) {
		// 	// 	setTimeout(()=> {
		// 	// 		receiver.to(clients[0]).emit('debug', "fromMax "+i);
		// 	// 		socket.emit('debug', "fromMax "+i);
		// 	// 	}, 3000*i)
		// 	// }
		// 	//receiver.to(clients[0]).emit('debug', "fromMax");

		// });
	})
})

function emitDataWithNextTime() {
	emitInfo.waiting = false;
	if (emitInfo.intervalTime) {
		emitInfo.waiting = true;
		//receiver.emit('controlData', emitInfo.data);
		receiverEmit();
		setTimeout(emitDataWithNextTime, emitInfo.intervalTime);
	}
}

function receiverEmit() {
	let tempSender = receiver;

	if (emitInfo.mode.type == "normal") {
		if (emitInfo.mode.percentage < 1) {
			getPercentageClients(emitInfo.mode.percentage).forEach((e) => {
				tempSender = tempSender.to(e);
			});
		}
	} else { // taketurn
		var clients = getClientsByOrder();
		console.log(`id: ${emitInfo.taketurnId}`);
		console.log(`send to ${clients[emitInfo.taketurnId]}`);
		tempSender = tempSender.to(clients[emitInfo.taketurnId]);
		emitInfo.taketurnId++;
		if (emitInfo.taketurnId >= clients.length) {
			emitInfo.taketurnId = 0;
			emitInfo.intervalTime = 0;
		}
	}
	tempSender.emit('controlData', emitInfo.data);
}

function testSendRandom(percentage) {
	let tempSender = receiver;

	getPercentageClients(percentage).forEach((e) => {
		console.log(`send to ${e}`);
		tempSender = tempSender.to(e);
	});
	tempSender.emit('debug', 'sendRandom!');
}

function getPercentageClients(percentage) {
	var newClients = getReceiverClients().sort(randomsort);
    return newClients.slice(0, Math.ceil(newClients.length*percentage));
	
}


function getClientsByOrder() {
	return getReceiverClients().sort(indexsort);
}

function getReceiverClients() {
	var receiverClients = [];
	Object.keys(receiver.adapter.sids).forEach(function(key) {
	    receiverClients.push(key);
	});
	return receiverClients;
}

function indexsort(a, b) {
	return socketToIndex[a] - socketToIndex[b];
}

function randomsort(a, b) {
    return Math.random() > .5 ? -1 : 1;
}


server.listen(port, () => {
    console.log("Listening on %d", server.address().port);
});