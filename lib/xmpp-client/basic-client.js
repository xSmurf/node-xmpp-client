/*
	A very simple xmpp client
	
*/

var sys			= require('sys'),
	xmpp		= require('node-xmpp'),
	util		= require('util'),
	colors		= require('colors'),
	events		= require('events');

var BasicClient = function(params, callback) {
	events.EventEmitter.call(this);
	this.idle	= (new Date().getTime());
	this._iq = 0;
	this._iqCallback = {};
	this._iqHandler = {};
	var jabber = this;
	this.params	= params;
	var jid = new xmpp.JID(params.jid);
	this.params.host = (params.host == null) ? jid.domain : params.host;
	this.params.nickname = (params.resource == null) ? jid.user : params.resource;
	
	this.xmpp = new xmpp.Client(params);
	/*
	this.xmpp.addListener('rawStanza', function(stanza) {
		sys.debug("RAW: "[jabber.color] + stanza.toString().white);
	});
	*/
	this.xmpp.addListener('authFail', function(e) {
		jabber.emit('authFail', e);
	});
	this.xmpp.addListener('error', function(e) {
		jabber.emit('error', e);
	});
	
	this.xmpp.addListener('stanza', function(stanza) {
		switch(stanza.name) {
			case 'iq':
				switch(stanza.attrs.type) {
					case 'error':
						var q = stanza.getChild('query');
						if(q !== undefined) {
							if(q.attrs.xmlns != null && jabber._iqHandler[q.attrs.xmlns] != null) {
								return jabber._iqHandler[q.attrs.xmlns].call(jabber, stanza);
							}
						}
						
						if (typeof jabber._iqCallback[stanza.attrs.id] !== "undefined") {
							jabber._iqCallback[stanza.attrs.id].error.apply(jabber, [stanza]);
						}
					break;
					case 'result':
						if (typeof jabber._iqCallback[stanza.attrs.id] === "undefined") {
							var q = stanza.getChild('query');
							if(q !== undefined) {
								if(q.attrs.xmlns != null && jabber._iqHandler[q.attrs.xmlns] != null) {
									return jabber._iqHandler[q.attrs.xmlns].call(jabber, stanza);
								}
							}
						} else if (typeof jabber._iqCallback[stanza.attrs.id] !== "undefined") {
							jabber._iqCallback[stanza.attrs.id].success.apply(jabber, [stanza]);
						}
					break;
					default:
						jabber.emit('iq', stanza);
						var q = stanza.getChild('query');
						if(q == undefined) {
							var q = stanza.getChild('time');
							if(q !== undefined) {
								if(q.attrs.xmlns != null && jabber._iqHandler[q.attrs.xmlns] != null) {
									jabber._iqHandler[q.attrs.xmlns].call(jabber, stanza);
								} else {
									jabber.emit('iq:unknow', stanza);
								}
							} else {
								if (typeof jabber._iqCallback[stanza.attrs.id] !== "undefined") {
									jabber._iqCallback[stanza.attrs.id].success.apply(jabber, [stanza]);
								} else if(stanza.attrs.xmlns != null && jabber._iqHandler[stanza.attrs.xmlns] != null) {
									jabber._iqHandler[stanza.attrs.xmlns].call(jabber, stanza);
								} else {
									jabber.emit('iq:unknow', stanza);
								}
							}
						} else {
							if (typeof jabber._iqCallback[stanza.attrs.id] !== "undefined") {
								jabber._iqCallback[stanza.attrs.id].success.apply(jabber, [stanza]);
							} else if(q.attrs.xmlns != null && jabber._iqHandler[q.attrs.xmlns] != null) {
								jabber._iqHandler[q.attrs.xmlns].call(jabber, stanza);
							} else {
								jabber.emit('iq:unknow', stanza);
							}
						}
					break;
				}
			break;
			case 'presence':
				var newPresence	= false;
				if(stanza.attrs.type == 'error') {
					jabber.emit('presence:error', stanza);
				} else {
					// Skip self presence
					if (jabber.jid.user + "@" + jabber.jid.domain + "/" + jabber.jid.resource === stanza.attrs.from) {
						return false;
					}
					
					try {
						// This is a presences for a conference
						if (stanza.attrs.from.indexOf('conference') === -1 || stanza.attrs.from.indexOf('conference') < stanza.attrs.from.indexOf('@')) {
							var user		= stanza.attrs.from.toString();
							
							if (stanza.attrs.type === "unavailable") {
								if (typeof jabber.presences[user] !== "undefined") {
									delete jabber.presences[user];
								}
							} else {
								jabber.presences[user]	= stanza;
							}
						}
						
						jabber.emit('presence', stanza);
					} catch (err) {
						console.log("Something went wrong parsing presences: " + err.toString());
						console.log(stanza.toString());
						console.log(err.stack);
					}
				}
			break;
			case 'message':
				jabber.emit('message', stanza);
			break;
			default:
			console.log(stanza.toString());
			break;
		}
	});
	
	this.xmpp.addListener('online', function() {
		jabber.jid = this.jid;
		jabber.emit('online');
		callback.apply(jabber);
	});
};

sys.inherits(BasicClient, events.EventEmitter);
exports.BasicClient = BasicClient;

BasicClient.prototype.unidle	= function() {
	this.idle	= (new Date().getTime());
};

BasicClient.prototype.message = function(to, message) {
	this.xmpp.send(new xmpp.Element('message', {
		to: to,
		type: 'chat'})
		.c('body').t(message));
	
	this.unidle();
};

BasicClient.prototype.presence	= function(status, message)
{
	if (typeof status === "undefined")
	{
		var status	= "";
	}
	
	if (typeof message === "undefined")
	{
		var message	= "";
	}
	
	this.xmpp.send(new xmpp.Element('presence', { type: 'chat'}).
									c('show').t(status).up().
									c('status').t(message)
				);
};

BasicClient.prototype.iq = function(to, query, callback, error, type) {
	if(error == undefined) error = function(stanza) { sys.error((this.jid + " : " + stanza.toString()).red);};
	var n = 'node' + this._iq++;
	this._iqCallback[n] = {};
	this._iqCallback[n].success = callback;
	this._iqCallback[n].error = error;
	if (typeof type === "undefined") {
		var type	= "get";
	}
	
	var attrs = {
		type: type,
		id: n
	};
	if(to != null) {
		attrs.to = to;
	};
	this.xmpp.send(new xmpp.Element('iq', attrs).cnode(query).tree());
	return n;
};

/*
Answer an iq query
*/
BasicClient.prototype.resultIq = function(iqGet, result) {
	if (typeof iqGet === "undefined" || typeof result === "string") {
		this.xmpp.send(result);
	} else {
		this.xmpp.send(new xmpp.Element('iq', {
			type: 'result',
			from: iqGet.attrs.to,
			to: iqGet.attrs.from,
			id: iqGet.attrs.id
		}).cnode(result).tree());
	}
};

BasicClient.prototype.registerIqHandler = function(xmlns, action) {
	this._iqHandler[xmlns] = action;
};
