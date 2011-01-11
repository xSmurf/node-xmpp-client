var sys			= require('sys'),
	util		= require('util'),
	colors		= require('colors'),
	dateFormat	= require("../../../date.js").dateFormat,
	xmpp		= require('node-xmpp'),
	BasicClient	= require('./basic-client').BasicClient;

var Client = function(params, callback) {
	var jabber = this;
	var params = params;
	var xmpp = this.xmpp;
	this.roster = {};
	this.presences	= {};
	
	BasicClient.call(this, params, function() {
		this.presence("dnd", "Loading...");
		this.getRoster(function(roster) {
			if (typeof callback === "function")
			{
				callback.apply(this);
			}
			else
			{
				jabber.emit('binded', this);
			}
		});
	});
	
	this.registerIqHandler('http://jabber.org/protocol/disco#info', function(stanza) {
		jabber.sendDisco(stanza);
	});
	
	this.registerIqHandler('jabber:iq:last', function(stanza) {
		jabber.sendLast(stanza);
	});
	
	this.registerIqHandler('urn:xmpp:time', function(stanza) {
		jabber.sendTime(stanza);
	});
	
	this.registerIqHandler('jabber:iq:version', function(stanza) {
		if (typeof jabber.cbVersion === "function") {
			jabber.resultIq(stanza, jabber.cbVersion(stanza));
		} else {
			jabber.sendUnimplemented(stanza, "version");
		}
	});
};

sys.inherits(Client, BasicClient);
exports.Client = Client;

Client.prototype.getRoster = function(callback) {
	var jabber = this;
	this.iq(null, new xmpp.Element('query', {xmlns: 'jabber:iq:roster'}), function(iq) {
		iq.getChild('query', 'jabber:iq:roster').getChildren('item').forEach(function(child) {
			jabber.roster[child.attrs.jid] = {
				name: child.attrs.jid,
				subscription: child.attrs.subscription};
		});
		jabber.emit('roster', jabber.roster);
		callback.call(jabber, jabber.roster);
	});
};

Client.prototype.sendUnimplemented	= function(stanza, iqName) {
	this.resultIq(stanza, "<query xmlns=\"jabber:iq:"+ iqName +"\"/>"
		+ "<error type=\"cancel\" >"
		+ "<feature-not-implemented xmlns=\"urn:ietf:params:xml:ns:xmpp-stanzas\"/>"
		+ "</error>"
		+ "</iq>"
	);
};

Client.prototype.sendTime		= function(stanza) {
	var now	= new Date();
	var tzo	= dateFormat(now, "o").toString();
	if (tzo !== "0") {
		tzo		= tzo.substr(0, (tzo.length - 2)) + ":" + tzo.substr((tzo.toString().length - 2));
	}
	
	this.resultIq(stanza,
		"<iq xmlns=\"jabber:client\" type=\"result\" to=\""+ stanza.attrs.from +"\" from=\""+stanza.attrs.to+"\" id=\""+stanza.attrs.id+"\">"
			+"<time xmlns=\"urn:xmpp:time\">"
				+ "<tzo>"+ tzo +"</tzo>"
				+ "<utc>"+ dateFormat(now, "isoUtcDateTime") +"</utc>"
			+ "</time>"
		+ "</iq>"
	);
};

// FIXME: For some reason it seems like the result of this only arrives once you request is again?!?!
Client.prototype.sendLast	= function(stanza) {
	var last	= (new Date().getTime() - this.idle);
	if (last < 0) last = 0;
	else last	= Math.ceil(last / 1000);
	
	this.resultIq(stanza, new xmpp.Element('query', {
		xmlns: 'jabber:iq:last', seconds:last})
		.tree()
	);
};

Client.prototype.sendDisco	= function(stanza) {
	this.resultIq(stanza, new xmpp.Element('query', {xmlns: 'http://jabber.org/protocol/disco#info'})
	.c('feature', {'var': 'http://jabber.org/protocol/disco#info'}).up()
	.c('feature', {'var': 'http://jabber.org/protocol/disco#items'}).up()
	.c('feature', {'var': 'http://jabber.org/protocol/muc'}).up()
	.c('identity', {
		category: 'conference',
		type: 'text',
		name: 'Play-Specific Chatrooms'
	}).up()
	.tree()
	);
};

/*
http://xmpp.org/extensions/xep-0092.html
*/
Client.prototype.getVersion = function(jid, success, error) {
	var jabber = this;
	this.iq(jid, new xmpp.Element('query', {xmlns: 'jabber:iq:version'}), function(iq) {
		var v = iq.getChild('query', 'jabber:iq:version');
		var version = {
			name: v.getChildText('name'),
			version: v.getChildText('version'),
			os: v.getChildText('os')
		};
		success.call(jabber, version);
	}, error);
};

/*
http://xmpp.org/extensions/xep-0012.html
*/

Client.prototype.getLast = function(jid, success, error) {
	var jabber = this;
	this.iq(jid, new xmpp.Element('query', {xmlns: 'jabber:iq:last'}),
	function(iq) {
		success.call(jabber, parseInt(iq.getChild('query', 'jabber:iq:last').attrs.seconds, 10));
	},
	error
	);
};

Client.prototype.disconnect = function() {
	this.xmpp.send(new xmpp.Element('presence', {type: 'unavailable'})
		.c('status').t('Logged out')
		.tree());
	var jabber = this;
/*	Object.keys(this.rooms).forEach(function(room) {
		jabber.rooms[room].leave();
	});*/
	this.xmpp.end();
	sys.debug("disconnect from XMPP");
};
