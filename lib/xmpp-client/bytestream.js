var sys		= require("sys"),
	net		= require("net"),
	XMLNS	= require("./xmlns.js"),
	xmpp	= require("node-xmpp"),
	colors	= require("colors"),
	events	= require("events"),
	hash	= require("../../../node-hash/lib/hash");

var Bytestream	= function(server, file, to, idIq) {
	var bytestream	= this;
	this.server		= server;
	this.client		= server.client;
	this.idIq		= idIq;
	this.to			= to;
	this.sidId		= this.idIq + "_" + (new Date().getTime());
	this.sidHash	= hash.sha1(this.sidId + this.client.jid.toString() + this.to);
	this.file		= file;
	/*
	// FIXME
	if (("mimeType" in this.file) === false) {
		this.file.mimeType	= "plain/text";
	}
	
	if (("length" in this.file) === false || typeof this.file.data.length !== "undefined") {
		this.file.length	= this.file.data.length;
	}
	*/
	
	this.sendInitiate();
};

sys.inherits(Bytestream, events.EventEmitter);

exports.Bytestream = Bytestream;

Bytestream.prototype.sendInitiate	= function() {
	var self	= this;
	var jabber	= self.client;
	
	// Define the iqCallback for the negotiation stream
	jabber._iqCallback[self.idIq] = {};
	jabber._iqCallback[self.idIq].success	= function(jabber) {
		self.sendFile();
	};
	
	jabber._iqCallback[self.idIq].error		= function(error) {
		var declined	= false;
		if (typeof error !== "undefined") {
			var error	= error.getChild("error");
			
			if (typeof error.getChild("forbidden") !== "undefined") {
				self.client.message(self.to, "Ok, maybe some other time!");
				declined	= true;
			}
		}
		
		if (declined !== true) {
			console.log(error.toString());
		}
		
		delete jabber._iqCallback[self.idIq];
	};
	
	// Build and send the data negotiation request
	self.server.iq(self,
		new xmpp.Element
		("si", {xmlns: XMLNS.SI, profile: XMLNS.SI_PROFILE, id: self.sidId, "mime-type": self.file.mimeType})
			.c("file", {xmlns: XMLNS.SI_PROFILE, size: self.file.length, name: self.file.name})
				.c("desc").t((typeof self.file.desc !== "undefined" ? self.file.desc : "")).up()
				.c("range").up()
			.up()
			.c("feature", {xmlns: XMLNS.FEATURE_NEG})
				.c("x", {xmlns: XMLNS.DATA, type: "form"})
					.c("field", {type: "list-single", "var": "stream-method"})
						.c("option")
							.c("value").t(XMLNS.BYTESTREAMS)
							.up()
						.up()
					.up()
				.up()
			.up()
		.up()
		.tree()
	);
};

Bytestream.prototype.sendFile	= function() {
	var self	= this;
	var jabber	= self.client;
	
	// Define the callback for streamhost negotiation
	// This might get overwritten is the internal bytestream server is contacted by the client
	jabber._iqCallback[self.idIq] = {};
	jabber._iqCallback[self.idIq].success	= function(stanza) {
		if (typeof stanza.getChild("query") !== "undefined"
		&& typeof stanza.getChild("query").getChild("streamhost-used") !== "undefined") {
			var usedStream	= stanza.getChild("query").getChild("streamhost-used").attrs.jid.toString();
			// We connected through the local S5B
			if (usedStream	=== self.client.jid.toString()) {
				// Nothing here really, we only got this after the session is ready and this has been overwritten
				// Connected through the server's S5B proxy
			} else {
				self.sendProxy(usedStream);
			}
		}
	};
	
	jabber._iqCallback[self.idIq].error		= function(error) {
		console.log(error);
		
		delete jabber._iqCallback[self.idIq];
	};
	
	self.server.iq(self, 
		new xmpp.Element
		('query', {xmlns: XMLNS.BYTESTREAMS, sid: self.sidId})
// S5B Direct
			.c("streamhost", {jid: jabber.jid.toString(), host: self.server.host, port: self.server.port}).up()
// S5B Proxy
			.c("streamhost", {jid: self.client.params.proxyJid, host: self.client.params.proxyHost, port: self.client.params.proxyPort}).up()
		.tree()
	);
	
	self.server.addHandler(self.idIq, self.sidHash, self.file.data);
};

Bytestream.prototype.sendProxy	= function(streamProxy) {
	var self	= this;
	var jabber	= this.client;
	
	var client	= net.createConnection(7777, streamProxy);
	
	client.addListener("error", function(error) {
		console.log("Error with S5B proxy connection for "+ self.to +" "+ client.remoteAddress);
		console.log(error);
	});
	
	client.addListener("connect", function() {
		var connected	= false;
		
		client.write(new Buffer([0x05,0x01,0x00])); // CONNECT
		
		client.addListener("data", function(data) {
			if (data[0] !== 0x05) {
				return;
			}
			
			// Ack
			if (connected === false && data.length === 0x02 && data[1] === 0x00) {
				var buff	= [0x05,0x01,0x0,0x03]; // Request header
				
				buff.push(self.sidHash.length); // Announce data length
				
				// Push our sidHash in the buffer
				self.sidHash.split("").forEach(function(val) {
					buff.push(val.charCodeAt(0));
				});
				
				// DST.PORT is two bytes
				buff.push(0x00, 0x00);
				
				client.write(new Buffer(buff));
				
				connected	= true;
			} else if (connected === true && data.length == 47 && data[1] === 0x00) {
				// Request Activate
				var reqHash	= data.toString("ascii", 5, 5 + self.sidHash.length);
				
				if (reqHash === self.sidHash) {
					var iqId	= "S5B_"+ (new Date().getTime()).toString();
					
					// Register activation callback
					jabber._iqCallback[iqId] = {};
					jabber._iqCallback[iqId].success	= function(stanza) {
						if (stanza.attrs.from.toString() === streamProxy
						&& stanza.attrs.type.toString() === "result") {
							// Send data! Finally!
							if (typeof self.file.data === "function") {
								self.file.data(client);
							} else {
								client.write(self.file.data);
							}
							
							delete jabber._iqCallback[self.iqId];
						}
					};
					
					jabber._iqCallback[iqId].error		= function(error) {
						console.log("Activation error");
						console.log(error.toString());
						
						delete jabber._iqCallback[self.idIq];
					};
					
					self.server.iq(self,
						new xmpp.Element('query', {xmlns: XMLNS.BYTESTREAMS, sid: self.sidId})
							.c("activate").t(self.to)
						.up()
						.tree(),
						streamProxy,
						iqId
					);
				}
			} else {
				console.log(data);
			}
		});
		
		client.addListener("close", function(data) {
			sys.puts("Disconnected from server");
		});
	});
};

