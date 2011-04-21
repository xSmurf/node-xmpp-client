// TODO: check if mode udp and refuse connection
var sys					= require("sys"),
	net					= require("net"),
	XMLNS				= require("./xmlns.js"),
	xmpp				= require("node-xmpp"),
	colors				= require("colors"),
	events				= require("events"),
	Bytestream			= require("./bytestream").Bytestream,
	BytestreamServer	= require("./bytestream-server").BytestreamServer,
	hash				= require("../../../node-hash/lib/hash");
	
var Bytestreams	= function(client, params) {
	var self				= this;
	this.client		 		= client;
	this.incomingHandlers	= [];
	this.incomingFiles		= {};
	this.defaultParams		= {};
	this.params				= params || this.defaultParams;
	
	if (("server" in this.params) === true && this.params.server === true) {
		this.server		= new BytestreamServer(this);
	}
	
	// Register IQ handlers
	// Stream negociate start
	// TODO Send declined if there are no handlers
	this.client.registerIqHandler(XMLNS.CLIENT, function(stanza) {
		if (("xmlns:stream" in stanza.attrs) === true && stanza.attrs["xmlns:stream"] === XMLNS.STREAMS
		&& stanza.getChild("si") !== undefined && stanza.getChild("si").getChild("file") !== undefined
		&& stanza.getChild("si").getChild("feature") !== undefined
		&& stanza.getChild("si").getChild("feature").getChild("x") !== undefined) {
			if (self.incomingHandlers.length > 0) {
				self.streamNegociate(stanza);
			} else {
				self.sendDecline(stanza);
			}
			
		}
	});
	
	//  Stream negociate s5b
	this.client.registerIqHandler(XMLNS.BYTESTREAMS, function(stanza) {
		if (stanza.getChild("query") !== undefined
		&& ("xmlns:stream" in stanza.attrs) === true && stanza.attrs["xmlns:stream"] === XMLNS.STREAMS
		&& (stanza.getChild("query").attrs.sid in self.incomingFiles) === true) {
			if (self.incomingHandlers.length > 0 && Object.keys(self.incomingFiles).length > 0) {
				self.s5bNegociate(stanza);
			} else {
				self.sendError(stanza);
			}
		}
	});
	
};

exports.Bytestreams	= Bytestreams;

Bytestreams.prototype.s5bCommands	= {};
Bytestreams.prototype.s5bCommands.connect	= new Buffer([0x05,0x01,0x00]);

Bytestreams.prototype.registerIncomingHandler	= function(cb) {
	this.incomingHandlers.push(cb);
};

// Static
Bytestreams.prototype.buildHash	= function(sid, from, to) {
	return hash.sha1(sid + from.toString() + to.toString());
};

// Static
Bytestreams.prototype.buildHashResponse	= function(hash, server) {
	var cmdByte	= ( (typeof server === "undefined" || server === true) ? 0x01 : 0x00 );
	var buff	= [0x05, cmdByte, 0x00, 0x03]; // Request header
	
	buff.push(hash.length); // Announce data length
	
	// Push our reqHash in the buffer
	hash.split("").forEach(function(val) {
		buff.push(val.charCodeAt(0));
	});
	
	// DST.PORT is two bytes
	buff.push(0x00, 0x00);
	
	return new Buffer(buff);
};

// Static
Bytestreams.prototype.hashMatchData	= function(hash, data) {
	var matches	= false;
	
	if (data.length == 47 && data[1] === 0x00) {
		var reqHash	= data.toString("ascii", 5, hash.length + 5);
		
		if (reqHash === hash) {
			matches	= true;
		}
	}
	
	return matches;
};

// Static
Bytestreams.prototype.checkBytestreamSupport	= function(stanza) {
	var options		= stanza.getChild("si").getChild("feature").getChild("x").getChild("field");
	
	var supported	= false;
	for (var ii = 0, len = options.children.length; ii < len; ii++) {
		if (typeof options.children[ii] === "object"
		&& options.children[ii].getChildText("value") === XMLNS.BYTESTREAMS) {
			supported	=  true;
			break;
		}
	}
	
	return supported;
};

Bytestreams.prototype.sendFile	= function(file, to, idIq) {
	return new Bytestream(this, file, to, idIq);
};

Bytestreams.prototype.streamSendResponse	= function(stanza, fileSID) {
	if (this.checkBytestreamSupport(stanza) === true) {
		this.client.xmpp.send(
			new xmpp.Element('iq', {type: "result", to: stanza.attrs.from.toString(), id: stanza.attrs.id})
				.c("si", {xmlns: XMLNS.SI})
					.c("feature", {xmlns: XMLNS.FEATURE_NEG})
						.c("x", {xmlns: XMLNS.DATA, type: "submit"})
							.c("field", {"var": "stream-method"})
								.c("value").t(XMLNS.BYTESTREAMS)
							.up()
						.up()
					.up()
				.up()
			.up()
			.tree()
		);
	} else {
		delete this.incomingFiles[fileSID];
		
		this.client.xmpp.send(
			new xmpp.Element('iq', {type: "error", to: stanza.attrs.from.toString(), id: stanza.attrs.id})
				.c("error", {code: 400, type: "cancel"})
					.c("bad-request", {xmlns: XMLNS.STANZAS}).up()
					.c("no-valid-streams", {xmlns: XMLNS.SI}).up()
				.up()
			.up()
			.tree()
		);
	}
};

Bytestreams.prototype.streamNegociate	= function(stanza) {
	var fileStanza	= stanza.getChild("si").getChild("file").attrs;
	fileStanza.mime	= stanza.getChild("si").attrs["mime-type"] || null;
	var fileSID		= stanza.getChild("si").attrs.id;

	var fileWanted	= false;
	for (ii in this.incomingHandlers) {
		var fileHandler	= this.incomingHandlers[ii](fileSID, fileStanza, stanza);
		
		if (typeof fileHandler === "function") {
			if ((fileSID in this.incomingFiles) === false) {
				this.incomingFiles[fileSID]		= fileStanza;
				this.incomingFiles[fileSID].cb	= [];
			}
			
			this.incomingFiles[fileSID].cb.push(fileHandler);
			
			fileWanted	= true;
		}
	}
	
	if (fileWanted === true) {
		this.streamSendResponse(stanza, fileSID);
	} else {
		this.sendDecline(stanza);
	}
};

Bytestreams.prototype.s5bNegociate	= function(stanza) {
	var self		= this;
	var fileSID		= stanza.getChild("query").attrs.sid;
	var streamHosts	= [];
	var streamJIDs	= {};

	for (var ii = 0, len = stanza.getChild("query").children.length; ii < len; ii++) {
		if (typeof stanza.getChild("query").children[ii] === "object") {
			if (stanza.getChild("query").children[ii].name === "fast") {
				// Not handled
			} else if (stanza.getChild("query").children[ii].name === "streamhost") {
				var streamHost	= stanza.getChild("query").children[ii].attrs;
				
				if (stanza.getChild("query").children[ii].getChild("proxy")) {
					streamHost.proxy	= true;
				}
				
				if ((streamHost.jid in streamJIDs) !== true) {
					streamJIDs[streamHost.jid]	= true;
					streamHosts.push(streamHost);
				}
			}
		}
	}
	
	if (streamHosts.length === 0) {
		this.sendError(stanza);
	} else {
		this.prepareS5BConnection(stanza, fileSID, streamHosts);
	}
};

Bytestreams.prototype.sendError	= function(stanza) {
	this.client.xmpp.send(
		new xmpp.Element("iq", {to: stanza.attrs.from, id: stanza.attrs.id, type: "error"})
			.c("error", {type: "auth"})
				.c("not-acceptable", {xmlns: XMLNS.STANZAS})
			.up()
		.up()
		.tree()
	);
};

Bytestreams.prototype.sendDecline	= function(stanza) {
	this.client.xmpp.send(
		new xmpp.Element("iq", {to: stanza.attrs.from, id: stanza.attrs.id, type: "error"})
			.c("error", {type: "cancel", code: 403})
				.c("forbidden", {xmlns: XMLNS.STANZAS}).up()
				.c("text", {xmlns: XMLNS.STANZAS}).t("Offer Declined").up()
			.up()
		.up()
		.tree()
	);
};

Bytestreams.prototype.prepareS5BConnection	= function(stanza, fileSID, streamHosts) {
	var self							= this;
	self.incomingFiles[fileSID].sid		= fileSID;
	self.incomingFiles[fileSID].hash	= this.buildHash(fileSID, stanza.attrs.from, this.client.jid.toString());

	var cbFailure	= function(error, sid) {
		delete self.incomingFiles[sid];
		
		self.client.xmpp.send(
			new xmpp.Element("iq", {to: stanza.attrs.from, from: stanza.attrs.to, id: stanza.attrs.id, type: "error"})
				.c("error", {type: "cancel"})
					.c("item-not-found", {xmlns: XMLNS.STANZAS})
				.up()
			.up()
			.tree()
		);
	};
	
	var cbAcknowledged	= function(client, streamHost, sid) {
		self.client.xmpp.send(
			new xmpp.Element("iq", {id: stanza.attrs.id, to: stanza.attrs.from, type: "result"})
				.c("query", {xmlns: XMLNS.BYTESTREAMS, sid: fileSID})
					.c("streamhost-used", {jid: streamHost.jid})
				.up()
			.tree()
		);
	};
	
	var cbSuccess	= function(sid, data) {
		for (ii in self.incomingFiles[sid].cb) {
			self.incomingFiles[sid].cb[ii](self.incomingFiles[sid], data);
		}

		delete self.incomingFiles[sid];
	};
	
	// TODO iterate all the possible streamhost and support proxy server negociation
	self.createS5BClient(self.incomingFiles[fileSID].hash, streamHosts, fileSID, cbAcknowledged, cbSuccess, cbFailure, self.incomingFiles[fileSID].size);
};

// Static
Bytestreams.prototype.createS5BClient	= function(hash, streamHosts, sid, cbAcknowledged, cbSuccess, cbFailure, fileLen, ii) {
	var iiStream	= ii || 0;

	var client	= net.createConnection(streamHosts[iiStream].port, streamHosts[iiStream].host.replace("127.0.0.1", "10.0.0.174"));
	
	client.addListener("error", function(error) {
		if (++iiStream < streamHosts.length) {
			Bytestreams.prototype.createS5BClient(hash, streamHosts, sid, cbAcknowledged, cbSuccess, cbFailure, fileLen, iiStream);
		} else {
			cbFailure(error, sid);
		}
	});
	
	client.addListener("connect", function() {
		var connected		= false;
		var acknowledged	= false;
		var done			= false;
		if (typeof fileLen !== "undefined") {
			var bufferData		= null;
		}
		
		client.write(Bytestreams.prototype.s5bCommands.connect);
		
		client.addListener("end", function() {
			done = true;

			if (typeof cbSuccess === "function") {
				cbSuccess(sid, bufferData);

				client.end();
			}
		});
		
		client.addListener("data", function(data) {
			// Ack
			if (acknowledged === false && data.length === 0x02 && data[1] === 0x00) {
				client.write(Bytestreams.prototype.buildHashResponse(hash));
				
				acknowledged	= true;
			} else if (connected === false && acknowledged === true) {
				if (Bytestreams.prototype.hashMatchData(hash, data) === true) {
					connected	= true;
					
					cbAcknowledged(client, streamHosts[iiStream], sid);
				} else {
					cbFailure("hash", data);
				}
			} else if (typeof fileLen !== "undefined" && connected === true && done !== true) {
				var newBuff	= new Buffer((bufferData === null ? 0 : bufferData.length) + data.length);
				if (bufferData !== null) {
					bufferData.copy(newBuff, 0, 0);
				}
				
				data.copy(newBuff, (bufferData === null ? 0 : bufferData.length), 0);
				bufferData	= newBuff;
			}
		});
	});
};
