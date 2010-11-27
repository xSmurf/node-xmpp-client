/*
	A very simple xmpp client
	
*/

var sys = require('sys'),
	xmpp = require('node-xmpp'),
	colors = require('colors'),
	events = require('events');

var BasicClient = function(params, callback) {
	events.EventEmitter.call(this);
	this._iq = 0;
	this._iqCallback = {};
	this._iqHandler = {};
	var jabber = this;
	this.jid = new xmpp.JID(params.jid);
	this.host = (params.host == null) ? this.jid.domain : params.host;
	this.xmpp = new xmpp.Client(params);
	this.xmpp.addListener('rawStanza', function(stanza) {
		//sys.debug("RAW: "[jabber.color] + stanza.toString().white);
	});
	this.xmpp.addListener('authFail', function() {
		sys.error("[Error] Jabber : Authentication failure");
		process.exit(1);
	});
	this.xmpp.addListener('error', function(e) {
		sys.error(e);
		process.exit(1);
	});
	this.xmpp.addListener('stanza', function(stanza) {
		switch(stanza.name) {
			case 'iq':
				switch(stanza.attrs.type) {
					case 'error':
						jabber._iqCallback[stanza.attrs.id][1].apply(jabber, [stanza]);
					break;
					case 'result':
						jabber._iqCallback[stanza.attrs.id][0].apply(jabber, [stanza]);
					break;
					default:
						jabber.emit('iq', stanza);
						var q = stanza.getChild('query');
						if(q.attrs.xmlns != null && jabber._iqHandler[q.attrs.xmlns] != null) {
							jabber._iqHandler[q.attrs.xmlns].call(jabber, stanza);
						} else {
							jabber.emit('iq:unknow', stanza);
						}
					break;
				}
			break;
			case 'presence':
				if(stanza.attrs.type == 'error') {
					jabber.emit('presence:error', stanza);
				} else {
					jabber.emit('presence', stanza);
				}
			break;
			case 'message':
				jabber.emit('message', stanza);
			break;
		}
	});
	this.xmpp.addListener('online', function() {
		callback.apply(jabber);
	});
};

sys.inherits(BasicClient, events.EventEmitter);
exports.BasicClient = BasicClient;

BasicClient.prototype.message = function(to, message) {
	this.xmpp.send(new xmpp.Element('message', {
		to: to,
		type: 'chat'})
		.c('body').t(message));
};

BasicClient.prototype.presence = function(type) {
	this.xmpp.send(new xmpp.Element('presence', (type != null) ? {type: type} : {}).tree());
};

BasicClient.prototype.iq = function(to, query, callback, error) {
	error |= function(stanza) { sys.error(stanza);};
	var n = 'node' + this._iq++;
	this._iqCallback[n] = [callback, error];
	var attrs = {
		type: 'get',
		id: n
	};
	if(to != null) {
		attrs.to = to;
	};
	this.xmpp.send(new xmpp.Element('iq', attrs).cnode(query).tree());
	return n;
};

BasicClient.prototype.registerIqHandler = function(xmlns, action) {
	this._iqHandler[xmlns] = action;
};