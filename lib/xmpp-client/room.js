var sys = require("sys"),
	xmpp = require("node-xmpp"),
	colors = require("colors"),
	events = require("events");

var NS_MUC	= "http://jabber.org/protocol/muc";

var Room = function(client, name, callback) {
	events.EventEmitter.call(this);
	this._isReady = false;
	this.client = client;
	this.room = name;
	this.to = this.room + "/" + this.client.params.nickname;
	
	var room = this;
	this.addListener("presence", function(from, stanza) {
		var jfrom = new xmpp.JID(from);
		if(name == jfrom.user + "@" + jfrom.domain) {
			var x = stanza.getChild("x", NS_MUC + "#user");
			if(x != null) {
				var item = x.getChild("item");
				if(item != null) {
					room.affiliation = item.attrs.affiliation;
					room.role = item.attrs.role;
				}
				var status = x.getChild("status");
				if(! room._isReady) {
					room._isReady = true;
					callback.call(room, (status != null) ? status.attrs.code : "200");
				}
			}
		}
	});
	
	this.presence("dnd", "Loading...");
	this.client.emit("muc:binded");
};

sys.inherits(Room, events.EventEmitter);

exports.Room = Room;

Room.prototype.presence = function(status, message)
{
	if (typeof status === "undefined")
	{
		var status	= "";
	}
	
	if (typeof message === "undefined")
	{
		var message	= "";
	}
	
	this.client.xmpp.send(new xmpp.Element("presence", {
			to: this.to
		})
		.c("priority").t("5").up()
		.c("show").t(status).up()
		.c("status").t(message).up()
		.c("x", {xmlns: NS_MUC})
		.tree()
	);
};

Room.prototype.changenick = function(newnick)
{
	this.client.params.nickname	= newnick;
	this.client.unidle();
	
	this.client.xmpp.send(new xmpp.Element("presence", {
			to: this.to.split("/")[0]+"/"+this.client.params.nickname
		})
		.c("x", {xmlns: NS_MUC})
		.tree()
	);
};

Room.prototype.message = function(message) {
	this.client.unidle();
	this.client.xmpp.send(new xmpp.Element("message", {
			to: this.room,
			type: "groupchat",
			id: this.client._iq++
		})
//		.c("nick", {xmlns: "http://jabber.org/protocol/nick"}).t(this.client.jid.username).up()
		.c("body").t(message).up()
		.tree()
		);
};
