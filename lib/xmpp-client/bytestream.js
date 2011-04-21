// TODO: add timeouts to the file offers
// TODO: Check if user is online first/do proper disco
var sys			= require("sys"),
	net			= require("net"),
	XMLNS		= require("./xmlns.js"),
	xmpp		= require("node-xmpp"),
	colors		= require("colors"),
	hash		= require("../../../node-hash/lib/hash");

var Bytestream	= function(parent, file, to, idIq) {
	var bytestream	= this;
	this.parent		= parent;
	this.server		= parent.server || null;
	this.client		= parent.client;
	this.idIq		= idIq || (new Date().getTime());
	this.to			= to;
	this.sidId		= "s5b_"+ this.idIq +"_"+ (new Date().getTime());
	this.sidHash	= parent.buildHash(this.sidId, this.client.jid, this.to);
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
				jabber.message(self.to, "Ok, maybe some other time!");
				declined	= true;
			}
		}
		
		if (declined !== true) {
			console.log(error.toString());
		}
		
		delete jabber._iqCallback[self.idIq];
	};
	
	// Build and send the data negotiation request
	var params	= {
		type: "set",
		id: self.idIq,
		to: self.to
	};

	var xmlIQ	= 
	new xmpp.Element('iq', params)
		.c("si", {xmlns: XMLNS.SI, profile: XMLNS.SI_PROFILE, id: self.sidId, "mime-type": self.file.mimeType})
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
	.up()
	.tree();
	
	jabber.xmpp.send(xmlIQ);
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
			if (usedStream	=== jabber.jid.toString()) {
				// Nothing here really, we only got this after the session is ready and this has been overwritten
				// Connected through the server's S5B proxy
			} else {
				self.sendProxy(usedStream, jabber.params.proxyPort);
			}
		}
	};
	
	jabber._iqCallback[self.idIq].error		= function(error) {
		console.log(error);
		
		delete jabber._iqCallback[self.idIq];
	};
	
	var params	= {
		type: "set",
		id: self.idIq,
		to: self.to
	};

	if (self.server !== null || ("proxyHost" in self.client.params) === true) {
		var xmlIQ	= new xmpp.Element('iq', params).c('query', {xmlns: XMLNS.BYTESTREAMS, sid: self.sidId});
		
		// S5B Direct
		if (self.server !== null) {
			self.server.addHandler(self.idIq, self.sidHash, self.file.data);
			xmlIQ.c("streamhost", {jid: jabber.jid.toString(), host: self.server.host, port: self.server.port}).up();
		}
		
		// S5B Proxy
		if (("proxyHost" in self.client.params) === true) {
			var proxyParams	= {
				jid:	self.client.params.proxyJid,
				host:	self.client.params.proxyHost,
				port:	self.client.params.proxyPort
			};
			
			xmlIQ.c("streamhost", proxyParams).up();
		}
		
		jabber.xmpp.send(xmlIQ.up().tree());
	} else {
		console.log("S5B Error: no available transports");
	}
};

Bytestream.prototype.sendProxy	= function(streamProxy, streamPort) {
		var self	= this;
		var jabber	= this.client;
		
		var cbAcknowledged	= function(client, streamHost, sid) {
			var iqId	= "s5b_"+ (new Date().getTime()).toString();
			
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
					
					delete jabber._iqCallback[iqId];
				}
			};
			
			jabber._iqCallback[iqId].error		= function(error) {
				console.log("Activation error");
				console.log(error.toString());
				
				delete jabber._iqCallback[iqId];
			};
			
			var params	= {
				type: "set",
				id: iqId,
				to: streamProxy
			};

			var xmlIQ	= 
			new xmpp.Element('iq', params)
				.c('query', {xmlns: XMLNS.BYTESTREAMS, sid: self.sidId})
					.c("activate").t(self.to)
				.up()
			.up()
			.tree();
			
			jabber.xmpp.send(xmlIQ);
		};
		
		var cbFailure	= function(error) {
			console.log("Error with S5B proxy connection");
			console.log(error);
		};
		
		var streamHosts	= [{host: streamProxy, port: streamPort}];
		
		self.parent.createS5BClient(self.sidHash, streamHosts, self.sidId, cbAcknowledged, undefined, cbFailure);
};
