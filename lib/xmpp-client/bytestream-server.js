var sys		= require("sys"),
	net		= require("net"),
	XMLNS	= require("./xmlns.js"),
	xmpp	= require("node-xmpp"),
	colors	= require("colors"),
	events	= require("events");

var BytestreamServer	= function(client) {
	var self			= this;
	this.client		 	= client;
	this.port			= (client.params.s5bPort == null) ? 8010 : client.params.s5bPort;
	this.host			= (client.params.s5bHost == null) ? "proxy." + client.params.host : client.params.s5bHost;
	this._clients		= {};
	this._handlers		= {};
	this.tcpSocket		= net.createServer(function(stream) {self.handleConnection(stream);});
	this.tcpSocket.on("error", function(error) {
		console.log("Error with S5B server!");
		console.log(error);
	});
	
	this.tcpSocket.listen(this.port, "0.0.0.0");
};

exports.BytestreamServer = BytestreamServer;

BytestreamServer.prototype.close	= function() {
	for (ii in this._clients) {
		this._clients[ii].end();
	}
	
	this.tcpSocket.close();
};

BytestreamServer.prototype.addHandler	= function(iqId, sidHash, data, cbSuccess, cbFailure) {
	this._handlers[sidHash]	= {id: iqId, data: data, cbSuccess:cbSuccess, cbFailure:cbFailure};
};

BytestreamServer.prototype.handleConnection	= function(stream) {
	var self							= this;
	this._clients[stream.remoteAddress]	= new BytestreamHandler(stream, self);
	this._clients[stream.remoteAddress].established	= false;
	this._clients[stream.remoteAddress].transfered	= false;
	
	stream.on("error", function(error) {
		console.log("S5B stream error from "+ stream.remoteAddress);
		console.log(error);
		
		stream.end();
		delete self._clients[stream.remoteAddress];
	});
	
	stream.on("connect", this._clients[stream.remoteAddress].onConnect);
	stream.on("data", this._clients[stream.remoteAddress].onData);
	stream.on("end", this._clients[stream.remoteAddress].onEnd);
};

BytestreamServer.prototype.iq	= function(bytestream, query, to, id) {
	var self	= this;
	var jabber	= self.client;
	
	if (typeof to === "undefined") {
		var to	= bytestream.to;
	}
	
	if (typeof id === "undefined") {
		var id	= bytestream.idIq;
	}
	
	var params	= {
		type: "set",
		id: id,
		to: to
	};
	
	jabber.xmpp.send(new xmpp.Element('iq', params).cnode(query).tree());
};

var BytestreamHandler	= function(self, parent) {
	self.parent	= parent;
	self.iqId	= null;
	
	this.onConnect	= function(data) {};
	
	this.onData	= function(data) {
		// TODO: Disconnect client when BS data is entered
		// just a start
		if (data[0] !== 0x05 && data[1] > 0x0F) {
			console.log("Received erroneous data from " + self.remoteAddress);
			self.end();
		}
		
		if (self.parent._clients[self.remoteAddress].established === false
		&& data.length >= 1 && data[0] === 0x05) {
			if (data.length >= 3 && (data[1] === 0x01 || data[1] === 0x02) && data[2] === 0x00) {
				if (data[1] === 0x01 || (data.length >= 4 && data[3] === 0x02)) {
					self.parent._clients[self.remoteAddress].established = true;
					
					self.write(new Buffer([0x05,0x00])); // Ack
				}
			}
		} else if (self.parent._clients[self.remoteAddress].established === true && data.length == 47
		&& data[data.length - 1] === 0x00 && data[data.length - 2] === 0x00) {
			var reqHash	= data.toString("ascii", 5, 45);
			if ((reqHash in self.parent._handlers) === true) {
				var buff	= [0x05,0x00,0x00,0x03]; // Request header
				buff.push(reqHash.length); // Announce data length
				// Push our reqHash in the buffer
				reqHash.split("").forEach(function(val) {
					buff.push(val.charCodeAt(0));
				});
				
				// DST.PORT is two bytes
				buff.push(0x00, 0x00);
				
				// Add iq handler for receiving the target's ack
				self.iqId	= self.parent._handlers[reqHash].id;
				self.parent.client._iqCallback[self.iqId]			= {};
				self.parent.client._iqCallback[self.iqId].success	= function(data) {
					if (typeof self.parent._handlers[reqHash].data === "function") {
						self.parent._handlers[reqHash].data(self);
					} else {
						self.write(self.parent._handlers[reqHash].data);
					}
					
					self.parent._clients[self.remoteAddress].transfered	= true;
					delete self.parent.client._iqCallback[self.iqId];
				};
				
				self.parent.client._iqCallback[self.iqId].error	= function(error) {
					console.log(error);
				};
				
				self.write(new Buffer(buff));
			}
		}
	};
	
	this.onEnd	= function(data) {
		delete self.parent._clients[self.remoteAddress];
	};
};
