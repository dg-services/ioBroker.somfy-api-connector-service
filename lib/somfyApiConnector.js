"use strict";
const FETCH = require("node-fetch");
const { URLSearchParams } = require("url");
const WEBSOCKET = require("ws");

const TOKEN_VALID_INTERVAL = 3550000;

const LAST_ERROR_CODE_STATES = {
	"START_SECONDS_TO_OVERRIDE":"START_SECONDS_TO_OVERRIDE",
	"START_DONT_OVERRIDE":"START_DONT_OVERRIDE",
	"PARK_UNTIL_NEXT_TASK":"PARK_UNTIL_NEXT_TASK",
	"PARK_UNTIL_FURTHER_NOTICE":"PARK_UNTIL_FURTHER_NOTICE"
};

const ACTIVITY_CODE_STATES = {
	"CLOSED": "CLOSED",
	"MANUAL_WATERING": "MANUAL_WATERING",
	"SCHEDULED_WATERING": "SCHEDULED_WATERING"
};

const STATE_CODE_STATES = {
	"OK":"OK",
	"WARNING":"WARNING",
	"ERROR":"ERROR",
	"UNAVAILABLE":"UNAVAILABLE"
};

const ACTIVITY_MOWER_STATES =  {
	"PAUSED":"PAUSED",
	"OK_CUTTING":"OK_CUTTING",
	"OK_CUTTING_TIMER_OVERRIDDEN":"OK_CUTTING_TIMER_OVERRIDDEN",
	"OK_SEARCHING":"OK_SEARCHING",
	"OK_LEAVING":"OK_LEAVING",
	"OK_CHARGING":"OK_CHARGING",
	"PARKED_TIMER":"PARKED_TIMER",
	"PARKED_PARK_SELECTED":"PARKED_PARK_SELECTED",
	"PARKED_AUTOTIMER":"PARKED_AUTOTIMER",
	"NONE":"NONE"
};

let websocketUp = false;

let thisAdapter;
let user;
let passwd;
let appKey;
let accessToken;
let refreshToken;
let userID;
let grantType;
let locationID;
let apiLocationID;
let locationName;
let tokenValidUntil;
let webSocketUrl;
let ws;
let adapterUpAndRunning;
let tokenExpired;


// create tree object name
function createIobrokerStateText(stateID, stateDeviceName, stateDeviceDesc, stateDeviceValue, stateRole, stateWriteable, statePossibleValues){
	thisAdapter.log.silly("createIobrokerStateText() was called");
	thisAdapter.setObjectNotExists(thisAdapter.name + "." + thisAdapter.instance + "." + stateID  + "." + stateDeviceName, {
		type: "state",
		common: {name: stateDeviceDesc,
			desc: stateDeviceDesc,
			type: "string",
			read: true,
			write: stateWriteable,
			role: stateRole,
			states: statePossibleValues
		},
		native: {}
	});
	thisAdapter.setState(thisAdapter.name + "." + thisAdapter.instance + "." + stateID + "." + stateDeviceName, { val: stateDeviceValue, ack: true });
}

async function doWebsocketPing(){
	thisAdapter.log.silly("doWebsocketPing() was called");
	if(websocketUp){
		ws.ping("Ping");
	}
}

//Process WebSocket recieving data
function processData(dataToProcess){
	thisAdapter.log.silly("processData() was called with processData: " + dataToProcess);

	let detailDeviceID = "";
	let modDeviceID = "";

	switch(dataToProcess.type){
		case "LOCATION":
			thisAdapter.log.debug("function processData: Found LOCATION skip");
			break;

		case "DEVICE":
			thisAdapter.log.debug("function processData: Found DEVICE skip");
			break;

		case "VALVE_SET":
			thisAdapter.log.debug("function processData: Found VALVE_SET skip");
			break;

		case "VALVE":
			thisAdapter.log.debug("function processData: Found VALVE process");
			if(String(dataToProcess.attributes.state.value) == "UNAVAILABLE"){
				//Verarbeitung abbrechen, da Ventil nicht am System
				break;
			}
			detailDeviceID = dataToProcess.id;
			modDeviceID = detailDeviceID.replace(/:/i, ".");

			thisAdapter.setObjectNotExists(locationID + "." + modDeviceID, {
				type: "channel",
				role: "",
				common: {
					name: "Device: Ventil: " + String(dataToProcess.attributes.name.value)
				},
				native: {}
			});

			createIobrokerStateText(locationID + "." + modDeviceID, "Name", "Device Name", String(dataToProcess.attributes.name.value), "text", false);
			createIobrokerStateText(locationID + "." + modDeviceID, "Activity", "Device Activity", String(dataToProcess.attributes.activity.value), "text", false, ACTIVITY_CODE_STATES);
			createIobrokerStateText(locationID + "." + modDeviceID, "State", "Device State", String(dataToProcess.attributes.state.value), "text", false, STATE_CODE_STATES);
			createIobrokerStateText(locationID + "." + modDeviceID, "LastErrorCode", "Device LastErrorCode", String(dataToProcess.attributes.lastErrorCode.value), "text", false, LAST_ERROR_CODE_STATES);
			break;

		case "MOWER":
			detailDeviceID = dataToProcess.id;
			thisAdapter.log.debug("function processData: Found MOWER process");

			createIobrokerStateText(locationID + "." + detailDeviceID, "State", "Device State",String(dataToProcess.attributes.state.value), "text", false);
			createIobrokerStateText(locationID + "." + detailDeviceID, "Activity", "Device Activity", String(dataToProcess.attributes.activity.value), "text", true, ACTIVITY_MOWER_STATES);
			createIobrokerStateText(locationID + "." + detailDeviceID, "operatingHours", "Device operatingHours in hours", Number.parseInt(dataToProcess.attributes.operatingHours.value), "value", false);

			if(typeof dataToProcess.attributes.lastErrorCode != "undefined"  ){
				createIobrokerStateText(locationID + "." + detailDeviceID, "LastErrorCode", "Device LastErrorCode", String(dataToProcess.attributes.lastErrorCode.value), "text", false);
			} else {
				createIobrokerStateText(locationID + "." + detailDeviceID, "LastErrorCode", "Device LastErrorCode", "NONE", "text", false);
			}
			break;
		case "COMMON":
			detailDeviceID = dataToProcess.id;
			thisAdapter.log.debug("function processData: Found COMMON process");

			thisAdapter.setObjectNotExists(locationID + "." + detailDeviceID, {
				type: "device",
				role: "",
				common: {
					// @ts-ignore
					name: `Device: ${dataToProcess.attributes.modelType.value}`
				},
				native: {}
			});

			createIobrokerStateText(locationID + "." + detailDeviceID, "ModelType", "Device Model Type", String(dataToProcess.attributes.modelType.value), "text", false);
			createIobrokerStateText(locationID + "." + detailDeviceID, "Name", "Device Name", String(dataToProcess.attributes.name.value), "text", false);
			createIobrokerStateText(locationID + "." + detailDeviceID, "BatteryState", "Device Battery State", String(dataToProcess.attributes.batteryState.value), "text", false);
			createIobrokerStateText(locationID + "." + detailDeviceID, "RfLinkLevel", "Device RF Link Level", String(dataToProcess.attributes.rfLinkLevel.value), "text", false);
			createIobrokerStateText(locationID + "." + detailDeviceID, "RfLinkState", "Device RF Link State", String(dataToProcess.attributes.rfLinkState.value), "text", false);
			createIobrokerStateText(locationID + "." + detailDeviceID, "DeviceSerial", "Device Serial", String(dataToProcess.attributes.serial.value), "text", false);
			// Batteriestatus nur wenn das Gerät auch eine Batterie hat
			if (String(dataToProcess.attributes.batteryState.value) != "NO_BATTERY"){
				createIobrokerStateText(locationID + "." + detailDeviceID, "BatteryLevel", "Device Battery Level %", String(dataToProcess.attributes.batteryLevel.value), "text", false);
			}
			break;

		default:
			thisAdapter.log.debug("function processData: Unkown TYPE");
			break;
	}

	return;
}

async function fctGetAccessToken() {
	thisAdapter.log.silly("fctGetAccessToken() was called");

	user 		 = thisAdapter.config.user;
	passwd 		 = thisAdapter.config.passwd;
	appKey 		 = thisAdapter.config.appKey;
	grantType 	 = "password";
	const url = "https://accounts.somfy.com/oauth/oauth/v2/token";

	thisAdapter.log.debug("config User: " + user);
	thisAdapter.log.debug("config Password: " + passwd);
	thisAdapter.log.debug("config AppKey: " + appKey);
	thisAdapter.log.debug("grantType: " + grantType);

	const params = new URLSearchParams();
	params.set("client_id", appKey);
	params.set("grant_type", grantType);
	params.set("username", user);
	params.set("password", passwd);

	try{
		// @ts-ignore
		await FETCH(url,
			{
				method: "post",
				body: params,
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"accept": "application/json"
				},
				responseType: "json"
			})
			.then((response) => {
				if(response.status == 200){
					return response.clone().json().catch(() => response.text());
				} else {
					thisAdapter.log.error("Response Status "+ response.status + " "+ response.statusText );
					throw "Bad Reply from API";
				}
			})
			.then(myData => {
				accessToken = myData.access_token;
				refreshToken = myData.refresh_token;
				userID = myData.user_id;

				tokenValidUntil = new Date(new Date().getTime() + TOKEN_VALID_INTERVAL );

				thisAdapter.log.debug("Access Token: " + accessToken);
				thisAdapter.log.debug("Refresh Token: " + refreshToken);
				thisAdapter.log.debug("UserID: " + userID);
				thisAdapter.log.debug("Response: " + JSON.stringify(myData));
				thisAdapter.log.debug("Aktuelle Uhrzeit: "+Date() + " Token Valid Until: " + tokenValidUntil);
				tokenExpired = false;
			});
	} catch(error){
		thisAdapter.log.error("Error: " + error);
		throw "Login failed";
	}
}

async function fctRefreshToken(){
	thisAdapter.log.silly("fctRefreshToken() was called");

	grantType 	 = "refresh_token";

	const params = new URLSearchParams();
	params.set("grant_type", "refresh_token");
	params.set("client_id", appKey);
	params.set("refresh_token", refreshToken);

	thisAdapter.log.debug("Client ID: " + appKey);
	thisAdapter.log.debug("Refresh Token: " + refreshToken);
	thisAdapter.log.debug("grantType: " + grantType);
	const url = "https://api.authentication.husqvarnagroup.dev/v1/oauth2/token";

	try{
		// @ts-ignore
		await FETCH(url,
			{
				method: "post",
				body: params,
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"accept": "application/json"
				},
				responseType: "json"
			})
			.then((response) => {
				if(response.status == 200){
					return response.clone().json().catch(() => response.text());
				} else {
					thisAdapter.log.error("Response Status "+ response.status + " "+ response.statusText );
					throw "Bad Reply from API";
				}
			})
			.then(myData => {

				accessToken = myData.access_token;
				refreshToken = myData.refresh_token;
				tokenValidUntil = new Date(new Date().getTime() + TOKEN_VALID_INTERVAL );

				thisAdapter.log.debug("Access Token: " + accessToken);
				thisAdapter.log.debug("Refresh Token: " + refreshToken);
				thisAdapter.log.debug("Response: " + JSON.stringify(myData));
				thisAdapter.log.debug("Aktuelle Uhrzeit: "+Date() + " Token Valid Until: " + tokenValidUntil);
				tokenExpired = false;
			});
	} catch(error){
		thisAdapter.log.error("Error: " + error);
		throw "Token Refresh failed";
	}
}

async function fctGetLocation() {
	thisAdapter.log.silly("fctGetLocation() was called");

	grantType 	 = "refresh_token";

	thisAdapter.log.debug("Client ID: " + userID);
	thisAdapter.log.debug("Access Token: " + accessToken);
	const url = "https://api.smart.somfy.dev/v1/locations";


	const myHeaders = {
		"Authorization": "Bearer "+accessToken,
		"Authorization-Provider": "husqvarna",
		"X-Api-Key": appKey,
		"accept": "application/vnd.api+json"
	};

	thisAdapter.log.debug("Headers: " + JSON.stringify(myHeaders));

	try{
		// @ts-ignore
		await FETCH(url,
			{
				method: "GET",
				headers: myHeaders,
				responseType: "json"
			})
			.then((response) => {
				if(response.status == 200){
					return response.clone().json().catch(() => response.text());
				} else {
					thisAdapter.log.error("Response Status "+ response.status + " "+ response.statusText );
					throw "Bad Reply from API";
				}
			//adapter.log.debug('Response: ' + response.status);
			//return response.clone().json().catch(() => response.text())
			})
			.then(myData => {

				apiLocationID = myData.data[0].id;
				locationID = apiLocationID;
				locationName = myData.data[0].attributes.name;
				const locationType = myData.data[0].type;

				//adapter.log.debug('Response: ' + JSON.stringify(myData));
				thisAdapter.log.debug("Location ID: " + locationID);
				thisAdapter.log.debug("Location Type: " + locationType);
				thisAdapter.log.debug("Location Name: " + locationName);

				thisAdapter.log.debug("Adapter Name: " + thisAdapter.name);
				thisAdapter.log.debug("Adapter Instance: " + thisAdapter.instance);

				// create Channel locationID
				thisAdapter.setObjectNotExists(thisAdapter.name + "." + thisAdapter.instance + "." + locationID, {
					type: "folder",
					common: {
						name: `Location: ${locationName}`,  desc: `Location: ${locationName}`
					},
					native: {}
				});

				thisAdapter.setState(thisAdapter.name + "." + thisAdapter.instance + "." + locationID, { val: "Hier steht was", ack: true });

			});
	} catch(error){
		thisAdapter.log.error("Error: " + error);
		throw "getLocation failed";
	}
}

async function fctGetWebSocketInfo() {
	thisAdapter.log.silly("fctGetWebSocketInfo() was called");

	thisAdapter.log.debug("Client ID: " + userID);
	thisAdapter.log.debug("Access Token: " + accessToken);
	const url = "https://api.smart.somfy.dev/v1/websocket";

	const myData = {
		"data": {
			"type": "WEBSOCKET",
			"id": "request-123",
			"attributes": {
				"locationId": locationID
			}
		}
	};

	const myHeaders = {
		"Authorization": "Bearer "+accessToken,
		"Authorization-Provider": "husqvarna",
		"X-Api-Key": appKey,
		"Content-Type": "application/vnd.api+json",
	};

	try{
		// @ts-ignore
		await FETCH(url,
			{
				method: "POST",
				headers: myHeaders,
				body: JSON.stringify(myData),
				responseType: "json"
			})
			.then((response) => {
				if(response.status == 201){
					return response.clone().json().catch(() => response.text());
				} else {
					thisAdapter.log.error("Response Status "+ response.status + " "+ response.statusText );
					throw "Bad Reply from API";
				}
			//adapter.log.debug('Response: ' + response.status);
			//return response.clone().json().catch(() => response.text())
			})
			.then(myData => {
				webSocketUrl = myData.data.attributes.url;
				thisAdapter.log.debug("Url: " + webSocketUrl);
			});
	} catch(error){
		thisAdapter.log.error("Error: " + error);
		throw "getLocation failed";
	}
}

//Ping Websocket to keep connection open
async function fctGetWebsocket(){
	thisAdapter.log.silly("fctGetWebsocket() was called");

	ws = new WEBSOCKET(webSocketUrl, {
		origin: "https://api.smart.somfy.dev"
	});
	ws.on("open", function open() {
		thisAdapter.log.info("somfyWebsocket connected");
		websocketUp = true;
		setInterval(doWebsocketPing, 90000);
		//ws.send(Date.now());
	});
	ws.on("close", function close(code, reason) {
		websocketUp = false;
		thisAdapter.log.debug("somfyWebsocket disconnected: Code: " + code + " Reason: " + reason );
		//deal with error codes
		switch(code){
			case 1000:
				tokenExpired = true;
				break;
			case 1005:
				break;
			default:
				throw ("WebSocket wurde geschlossen, Adapter funktionslos");
		}
	});
	ws.on("error", function error(data) {
		thisAdapter.log.error("somfyWebsocket Error: " + data);
		throw ("Websocket lieg auf Fehler!");
	});
	ws.on("ping", function ping(data) {
		thisAdapter.log.silly("somfyWebsocket Ping: " + data);
	});
	ws.on("pong", function pong(data) {
		thisAdapter.log.silly("somfyWebsocket Pong: " + data);
	});
	ws.on("message", function incoming(data) {
		thisAdapter.log.debug("Erhaltene Daten" + data);
		// @ts-ignore
		processData(JSON.parse(data));
	});
}

async function fctCheckIfStillConnected(){
	thisAdapter.log.silly("fctCheckIfStillConnected() was called");
	try{
		if(adapterUpAndRunning){
			if (!websocketUp){
				if(tokenExpired){
					await fctRefreshToken();
				}
				await fctGetWebSocketInfo();
				await fctGetWebsocket();
			}
		}
	}
	catch(error){
		thisAdapter.log.error("Error: " + error);
		throw error;
	}
}

class somfyApiConnector{

	constructor(inAdapter) {
		thisAdapter = inAdapter;
		thisAdapter.log.debug("Class somfyApiConnector is ready to go");
	}

	async login(){
		thisAdapter.log.silly("somfyApiConnector.login() function was called");
		adapterUpAndRunning = true;
		try{
			await fctGetAccessToken();
			//await fctGetLocation();
			//await fctGetWebSocketInfo();
			//await fctGetWebsocket();

			//setInterval(fctCheckIfStillConnected, 30000);

		} catch(error){
			thisAdapter.log.error(error);
			throw "Alles Mist! Ich bin raus!";
		}
	}

	async logout() {
		thisAdapter.log.silly("somfyApiConnector.logout() function was called");
		adapterUpAndRunning = false;

		//Websocket schließen
		ws.close();

		//Vom somfy-Backend abmelden
		const url = "https://api.authentication.husqvarnagroup.dev/v1/token/"+accessToken;
		try{
			// @ts-ignore
			await FETCH(url,
				{
					method: "DELETE",
					headers: {
						"X-Api-Key": appKey,
						"Authorization-Provider": "husqvarna",
						"Content-Type": "application/x-www-form-urlencoded",
						"accept": "application/json"
					},
					responseType: "json"
				})
				.then((response) => {
					if(response.status == "204"){
						thisAdapter.log.debug("Logoff successfull");
					} else {
						thisAdapter.log.debug("Logoff failed" + JSON.stringify(response));
						throw "Logoff failed";
					}

				});
		} catch(error){
			thisAdapter.log.error("Error: " + error);
		}
	}
}

module.exports = somfyApiConnector;