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
const user = io.of('/user');

var emitInfo = {
	loop: null,
	intervalTime: 0,
	data: {},
	waiting: false,
	mode: {},
	taketurnId: -1,
	reverse: 1,
	sortArray: []
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
		controller.emit('userConnect', 'userConnect');
	})

	socket.on('disconnect', function() {
		delete socketToIndex[socket.id];
    	console.log(`${socket.id} disconnect!`);
	});
   
   	socket.on('speakOver', receiverOnSpeakover);

	socket.on('debug', (data) => {
		socket.emit('debug', data);
	})
})

user.on('connection', (socket) => {
	console.log('user connected');
	socket.on('osc', (data) => {
		console.log(data);
		controller.emit('osc', data);
	})
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
	socket.on('showClient', (order)=> {
		console.log("showClient...");
		socket.emit('debug', getClientsByOrder(order));
	})

	socket.on('pause', (data)=> {
		socket.emit('pause', data);
	})

	socket.on('speak', controllerOnSpeak);
	socket.on('speakAdvance', controllerOnSpeakAdvance);
	socket.on('speakConfig', controllerOnSpeakConfig);

	// socket.on('debug', (data)=>{
	// 	controller.emit('debug', data);
	// 	receiver.emit('debug', data);
	// })
})

/*********************************/
/********  controller on  ********/

function controllerOnSpeak(data) {
	//let sender = getSender(getPercentageClients(1), receiver);
	//TODO: check if used?
	emitInfo.mode.type = 'speak';
	emitInfo.data.sentences = txtToSentence(data);
	emitInfo.data.sentenceId = 0;
	emitInfo.data.percentage = 0;
	emitInfo.waitforNum = 1;
	//TODO: to allot sentence
	emitInfo.sortArray = getPercentageClients(1);
	let sender = getTaketurnSender(emitInfo.sortArray, receiver, 0);
	if (0 < emitInfo.data.sentences.length) {
		console.log('emit speak', emitInfo.data.sentences[0]);
		let data = {
			id: 0,
			text: emitInfo.data.sentences[0],
		}
		sender.emit('speak', data);
	}
	emitInfo.taketurnId = 1;
}

function controllerOnSpeakAdvance(data) {
	//TODO: check if used?
	emitInfo.mode.type = 'speak';
	emitInfo.data.sentences = txtToSentence(data.text);
	emitInfo.data.sentenceId = 0;
	if (data.percentage == 0 || !(data.percentage)) {
		controllerOnSpeak(data.text);
		return;
	}
	emitInfo.data.percentage = data.percentage;

	//TODO: to allot sentence
	emitInfo.sortArray = getPercentageClients(data.percentage);
	let sender = getSender(emitInfo.sortArray, receiver);
	console.log('---- emitInfo.waitforNum ------', emitInfo.sortArray.length);
	emitInfo.waitforNum = emitInfo.sortArray.length;
	//let sender = getTaketurnSender(emitInfo.sortArray, receiver, 0);
	if (0 < emitInfo.data.sentences.length) {
		console.log('emit speak', emitInfo.data.sentences[0]);
		let data = {
			id: 0,
			text: emitInfo.data.sentences[0],
		}
		sender.emit('speak', data);
	}
	emitInfo.taketurnId = 1;
}

function controllerOnSpeakConfig(data) {
	console.log('speak config: ', data);
	if (data == 'changeVoice') receiver.emit('speakConfig', {mode: 'changeVoice'});
}

/*********************************/
/********  receiver on  ********/

function receiverOnSpeakover (data) {
	console.log('receiver on speak over', data.id, emitInfo.waitforNum );
	//check if time out
	if (data.id+1 !== emitInfo.taketurnId) return;
	emitInfo.waitforNum -= 1;
	if (emitInfo.waitforNum != 0) return;

	emitInfo.data.sentenceId++;
	let sender = receiver;
	if (emitInfo.data.percentage == 0) {//single
		sender = getTaketurnSender(emitInfo.sortArray, receiver, emitInfo.taketurnId);
		emitInfo.waitforNum = 1;
	} else { //percentage
		console.log('next:' , emitInfo.data.percentage);
		let cliT = getPercentageClients(emitInfo.data.percentage)
		sender = getSender(cliT, receiver);
		emitInfo.waitforNum = cliT.length;
	}

	if (emitInfo.data.sentenceId < emitInfo.data.sentences.length) {
		console.log('speak', emitInfo.data.sentences[emitInfo.data.sentenceId]);
		let data = {
			id: emitInfo.taketurnId,
			text: emitInfo.data.sentences[emitInfo.data.sentenceId],
		}
		sender.emit('speak', data);
		emitInfo.taketurnId++;
	} else {
		//if no more sentence, send speakOver to controller.
		controller.emit('speakOver', 'speakOver');
		emitInfo.taketurnId = -1;
	}
	
}


/****
 * split text into sentence
 * using , . ? ! : ;
 *  @param string text
 * 	@returns array result
 ****/
function txtToSentence(text) {
	// add a period for match regexp.
	text += '.';
	let re = /[^\.,!\?\:;]+[\.,!\?\:;]+/g;
	let result = text.match(re);
	if (result === null || result == undefined) return [text];
	return result;
};

function emitDataWithNextTime() {
	emitInfo.waiting = false;
	if (emitInfo.intervalTime) {
		emitInfo.waiting = true;
		//receiver.emit('controlData', emitInfo.data);
		receiverEmit();
		console.log(`wait for: ${emitInfo.intervalTime}`);
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
		let order = 1;
		if ("order" in emitInfo.mode) order = emitInfo.mode.order;
		let clients = getClientsByOrder(order);
		console.log(clients);
		//console.log(`id: ${emitInfo.taketurnId}`);
		//console.log(`send to ${clients[emitInfo.taketurnId]}`);
		// let clientAtIndex = clients[emitInfo.taketurnId];
		// if (Array.isArray(clientAtIndex)) {
		// 	clientAtIndex.forEach((e) => {
		// 		tempSender = tempSender.to(e);
		// 	})
		// } else {
		// 	tempSender = tempSender.to(clientAtIndex);
		// }
		tempSender = getTaketurnSender(clients, tempSender, emitInfo.taketurnId);
		
		emitInfo.taketurnId++;
		console.log(`id add: ${emitInfo.taketurnId} - clients len: ${clients.length}`);
		if (emitInfo.taketurnId >= clients.length) {
			console.log(`ZERO!!!`);
			console.log(clients);
			emitInfo.taketurnId = 0;
			emitInfo.intervalTime = 0;
		}
	}
	tempSender.emit('controlData', emitInfo.data);
}

function getTaketurnSender(clientsArr, sender, id) {
	let tempSender = sender;
	if (Array.isArray(id)) {
		id.forEach((e) => {
			tempSender = tempSender.to(clientsArr[e%clientsArr.length]);
		})
	} else {
		tempSender = tempSender.to(clientsArr[id%clientsArr.length]);
	}
	//console.log(sender);
	return tempSender;
}

function getSender(clientsArr, sender) {
	clientsArr.forEach((e) => {
		//console.log(`send to ${e}`);
		sender = sender.to(e);
	});
	return sender;
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

function getClientsByOrder(order) {
	emitInfo.reverse = 1;
	emitInfo.sortArray = socketToIndex;
	if (Number.isInteger(order)) {
		emitInfo.reverse = order;	
	} 
	let clients = getReceiverClients().sort(indexsort);

	if (Array.isArray(order)) {
		console.log(order);
		emitInfo.reverse = 1;
		clients.forEach((e, index) => {
			if (index < order.length)
		  		emitInfo.sortArray[e] = order[index];
		  	else 
		  		emitInfo.sortArray[e] = 0;
		})
		console.log(emitInfo.sortArray);
		clients = getReceiverClients().sort(indexsort);
	}
	else if (order == "middle") {
		
		console.log(clients);
		let mid = Math.floor (clients.length / 2);
		let count = 1;
		let newClients = [clients[mid]];
		while ((mid-count >= 0) || (mid+count < clients.length)) {
			let arr = [];
			if (mid-count >= 0) arr.push(clients[mid-count]);
			if (mid+count < clients.length) arr.push(clients[mid+count]);
			newClients.push(arr);
			count++;
		}
		return newClients;
	} 
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
	return emitInfo.sortArray[a]*emitInfo.reverse - emitInfo.sortArray[b]*emitInfo.reverse;
}

function randomsort(a, b) {
    return Math.random() > .5 ? -1 : 1;
}

server.listen(port, () => {
    console.log("Listening on %d", server.address().port);
});

///// use for develop

// const prompts = require('prompts');

// let promptTest = async () => {
// 	const response = await prompts({
// 	  type: 'text',
// 	  name: 'command',
// 	  message: 'Enter some text...',
// 	  //validate: value => value < 18 ? `Nightclub is 18+ only` : true
// 	});
// 	console.log(response.command);
// 	if (!switchCommand(response.command)) {
// 		console.log(txtToSentence(response.command));
// 	}
// 	if (response.command !== 'exit' &&  response.command !== undefined) promptTest();
// }
// promptTest();

// async function switchCommand(command) {
// 	switch(command) {
// 		case 'speak':
// 			const sentence = await prompts({
// 				type: 'text',
// 				name: 'text',
// 				message: 'Speak something...',
// 				validate: text => text === undefined ? `enter valid text!` : true
// 			});
// 			controllerOnSpeak(sentence.text);
// 			break;

// 		case 'speakAdvance':
// 			const data2 = await prompts({
// 				type: 'number',
// 				name: 'value',
// 				message: 'Enter speak percentage',
// 				validate: value => value < 0 ? `enter valid number!` : true
// 			});
// 			// const sentence2 = await prompts({
// 			// 	type: 'text',
// 			// 	name: 'text',
// 			// 	message: 'Speak something advanced...',
// 			// 	validate: text => text === undefined ? `enter valid text!` : true
// 			// });
// 			controllerOnSpeak({text:"hello, i am, QQ boy, you are, ready?", percentage:data2.value});
// 			break;

// 		case 'speakover':
			
// 			const data = await prompts({
// 				type: 'number',
// 				name: 'value',
// 				message: 'Enter speakover id',
// 				validate: value => value < 0 ? `enter valid number!` : true
// 			});
// 			receiverOnSpeakover({id: data.value});
// 			break;

// 		default:
// 			return false;
// 	}
// 	return true;
// }
