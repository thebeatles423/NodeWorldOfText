var wss;
var wsSend;
module.exports.startup_internal = function(vars) {
	wss = vars.wss;
	wsSend = vars.wsSend;
}

function sendWorldStatusUpdate(worldId, userId, type, val) {
	wss.clients.forEach(function(client) {
		if(!client.sdata) return;
		if(!client.sdata.userClient) return;
		if(client.sdata.world.id != worldId) return;
		if(client.sdata.user.id != userId) return;
		wsSend(client, JSON.stringify({
			kind: "propUpdate",
			props: [
				{
					type: type,
					value: val
				}
			]
		}));
	});
}

module.exports.GET = async function(req, serve, vars, evars, params) {
	var cookies = evars.cookies;
	var user = evars.user;
	var HTML = evars.HTML;

	var db = vars.db;
	var plural = vars.plural;
	var fetchWorldMembershipsByUserId = vars.fetchWorldMembershipsByUserId;
	var fetchOwnedWorldsByUserId = vars.fetchOwnedWorldsByUserId;
	var createCSRF = vars.createCSRF;

	if(!user.authenticated) {
		return serve(null, null, {
			redirect: "/accounts/login/?next=/accounts/profile/"
		});
	}

	var world_list = [];
	var html_memberships = [];

	var ownedList = await fetchOwnedWorldsByUserId(user.id);
	for(var i = 0; i < ownedList.length; i++) {
		var owned = ownedList[i];
		var member_total = Object.keys(owned.members.map).length;
		var world_url = owned.name;
		if(world_url == "") {
			world_url = "/" + world_url;
		}
		var views = owned.views;
		world_list.push({
			public_writable: owned.writability == 0,
			public_readable: owned.readability == 0,
			whitelist_set_count: member_total,
			conf_url: "/accounts/configure/" + owned.name + "/",
			get_absolute_url: "/" + owned.name,
			url: world_url,
			member_plural: plural(member_total),
			views_plural: plural(views),
			views,
			name: owned.name,
			mem_key: owned.opts.memKey
		});
	}

	world_list.sort(function(v1, v2) {
		return v1.name.localeCompare(v2.name, "en", { sensitivity: "base" });
	});

	var memberships = await fetchWorldMembershipsByUserId(user.id);
	for(var i = 0; i < memberships.length; i++) {
		var wid = memberships[i];
		var name = await db.get("SELECT name from world where id=?", wid);
		if(name) {
			name = name.name;
		} else {
			name = "Error~" + wid;
		}
		memberships[i] = name;
	}
	memberships.sort();

	for(var i = 0; i < memberships.length; i++) {
		var wname = memberships[i];
		var display_name = wname;
		if(display_name == "") {
			display_name = "/" + display_name;
		}
		html_memberships.push({
			get_absolute_url: "/" + wname,
			url: display_name,
			name: wname
		});
	}

	var message = null;
	if(params.message) {
		message = params.message;
	}

	// do not display areas if they are empty
	if(world_list.length == 0) world_list = null;
	if(html_memberships.length == 0) html_memberships = null;

	var csrftoken = createCSRF(user.id.toString(), 0);

	var data = {
		message: message,
		csrftoken,
		worlds_owned: world_list,
		memberships: html_memberships,
		email_verified: user.is_active
	};

	serve(HTML("profile.html", data));
}

module.exports.POST = async function(req, serve, vars, evars) {
	var post_data = evars.post_data;
	var user = evars.user;

	var db = vars.db;
	var dispage = vars.dispage;
	var claimWorldByName = vars.claimWorldByName;
	var revokeMembershipByWorldName = vars.revokeMembershipByWorldName;
	var wss = vars.wss;
	var checkCSRF = vars.checkCSRF;

	if(!user.authenticated) {
		return serve(null, 403);
	}

	var csrftoken = post_data.csrfmiddlewaretoken;
	if(!checkCSRF(csrftoken, user.id.toString(), 0)) {
		return serve("CSRF verification failed - please try again. This could be the result of leaving your tab open for too long.");
	}

	var message = null;
	if(post_data.form == "claim") {
		if(user.uv_rank == 3) { // TODO: use rank table in uvias db
			return await dispage("accounts/profile", {
				message: "Guests cannot claim worlds"
			}, req, serve, vars, evars);
		} else {
			var worldname = post_data.worldname;
			if(typeof worldname != "string") {
				message = "No world name provided";
			} else {
				var status = await claimWorldByName(worldname, user);
				message = status.message;
				if(status.success) {
					sendWorldStatusUpdate(status.world.id, user.id, "isOwner", true);
				}
			}
		}
	} else if(post_data.form == "leave") { // user is leaving the world (terminating own membership)
		for(var key in post_data) {
			if(key.startsWith("leave_")) {
				var worldName = key.substr("leave_".length);
				var revoke = await revokeMembershipByWorldName(worldName, user.id);
				if(revoke && revoke[0]) {
					sendWorldStatusUpdate(revoke[1], user.id, "isMember", false);
				}
				break;
			}
		}
	}
	await dispage("accounts/profile", {
		message
	}, req, serve, vars, evars);
}