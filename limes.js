'use strict';

const CARD_SIZE = 180;
const BORDER_WIDTH = 2;
const INNER_BORDER_WIDTH = 2;
const ZONE_WIDTH = CARD_SIZE / 2 - BORDER_WIDTH / 2 - INNER_BORDER_WIDTH / 2;
const BORDER_COLOR = '#547062';
const HUT_COLOR = '#5182ad';
const HUT_SIZE = CARD_SIZE * 0.1;


// Offsets of each zone from card origins.
// These are used to identify zone x/y positions.
const ZONE_ORIGINS = [
	[
		BORDER_WIDTH / 2,
		BORDER_WIDTH / 2
	],
	[
		BORDER_WIDTH / 2 + ZONE_WIDTH + INNER_BORDER_WIDTH,
		BORDER_WIDTH / 2
	],
	[
		BORDER_WIDTH / 2 + ZONE_WIDTH + INNER_BORDER_WIDTH,
		BORDER_WIDTH / 2 + ZONE_WIDTH + INNER_BORDER_WIDTH
	],
	[
		BORDER_WIDTH / 2,
		BORDER_WIDTH / 2 + ZONE_WIDTH + INNER_BORDER_WIDTH
	],
]

var canvas, ctx;
var hitCanvas, hitCtx;
const hitRegions = {};

function getNewHitRegionColor() {
	while (true) {
		let r = Math.floor(Math.random() * 256);
		let g = Math.floor(Math.random() * 256);
		let b = Math.floor(Math.random() * 256);
		let color = `rgb(${r},${g},${b})`;
		if (!hitRegions[color])
			return color;
	}
}


var GameState = {
	PLACE_CARD: 1,
	ROTATE_CARD: 1,
	PLACE_OR_MOVE_WORKER: 1,
	MOVE_WORKER: 1,
	PLACE_CARD: 1,
	PLACE_CARD: 1,
}

// This marks the positions of all cards on the canvas
var CARD_MAP = {
	// These are set by draw()
	top: 0,
	left: 0,


	// card grid size and the minimal values - set by addCard()
	sizeX: 0,
	sizeY: 0,
	minX: 0,
	minY: 0,

	nextCard: 2,

	cards: {},
	nextPositions: [],

	addCard: function(coord_str, card) {
		this.cards[coord_str] = card;

		// Adjust grid side

		let [coord_x, coord_y] = str_to_coords(coord_str);

		if (coord_x < this.minX) {
			this.sizeX += this.minX - coord_x;
			this.minX = coord_x;
		}
		if (coord_y < this.minY) {
			this.sizeY += this.minY - coord_y;
			this.minY = coord_y;
		}
		if (coord_x >= this.minX + this.sizeX) {
			this.sizeX = coord_x - this.minX + 1;
		}
		if (coord_y >= this.minY + this.sizeY) {
			this.sizeY = coord_y - this.minY + 1;
		}
	},

	addCards: function(cards) {
		for (let [coord_str, card] of Object.entries(cards)) {
			this.addCard(coord_str, card);
		}
	},

	markNextCardPositions: function() {
		this.nextPositions.length = 0;
		for (let card in this.cards) {
			for (let [neighbor, ] of getNeighbors(card)) {
				if (this.cards[neighbor])
					continue;

				let [x, y] = str_to_coords(neighbor);

				if (this.sizeX == 4 && (x < this.minX || x >= this.minX + this.sizeX))
					continue;

				if (this.sizeY == 4 && (y < this.minY || y >= this.minY + this.sizeY))
					continue;

				this.nextPositions.push(neighbor);
			}
		}
	}
}


window.addEventListener('load', function(){
	canvas = document.getElementById('canvas');
	canvas.width = canvas.height = CARD_SIZE * 5 + 20;
	ctx = canvas.getContext('2d');

	hitCanvas = document.createElement('canvas');
	hitCanvas.width = canvas.width;
	hitCanvas.height = canvas.height;
	hitCtx = hitCanvas.getContext('2d');

	var allCards = {
		'0,0': [1, 0],
		'1,0': [2, 0],
		'2,0': [3, 0],
		'3,0': [4, 0],
		'4,0': [5, 0],
		'5,0': [6, 0],
		'0,1': [7, 0],
		'1,1': [8, 0],
		'2,1': [9, 0],
		'3,1': [10, 0],
		'4,1': [11, 0],
		'5,1': [12, 0],
		'0,2': [13, 0],
		'1,2': [14, 0],
		'2,2': [15, 0],
		'3,2': [16, 0],
		'4,2': [17, 0],
		'5,2': [18, 0],
		'0,3': [19, 0],
		'1,3': [20, 0],
		'2,3': [21, 0],
		'3,3': [22, 0],
		'4,3': [23, 0],
		'5,3': [24, 0],
	};

	// CARD_MAP.addCards(allCards);
	
	CARD_MAP.addCards({
		'0,0': [1, 0],
		// '1,0': [7, 2],
		// '2,0': [6, 3],
		// '3,0': [22, 0],
		// '0,1': [5, 0],
		// '1,1': [19, 3],
		// '2,1': [12, 0],
		// '3,1': [14, 0],
		// '0,2': [9, 3],
		// '1,2': [4, 0],
		// '2,2': [23, 1],
		// '3,2': [3, 1],
		// '0,3': [24, 3],
		// '1,3': [8, 0],
		// '2,3': [10, 3],
		// '3,3': [20, 2],
	});
	CARD_MAP.markNextCardPositions();

	draw();
	parseMap(CARD_MAP);

	canvas.addEventListener('click', clickHandler);
});

function clickHandler(e) {
	const rect = canvas.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;

	const pixel = hitCtx.getImageData(x, y, 1, 1).data;
	const color = `rgb(${pixel[0]},${pixel[1]},${pixel[2]})`;
	const region = hitRegions[color];
	if (!region) {
		console.log('clicked nothing');
		return;
	}

	console.log(`clicked ${region}`);

	CARD_MAP.addCard(region, [CARD_MAP.nextCard, 0]);
	CARD_MAP.nextCard++;
	CARD_MAP.markNextCardPositions();

	draw();
}

function coord_to_str(x, y) {
	return x.toString() + ',' + y.toString();
}

function str_to_coords(s) {
	return s.split(',').map(x => Number.parseInt(x));
}

function parseMap(map) {
	// Build grid of zones
	var zoneGrid = {};
	for (let [coord_str, card] of Object.entries(map.cards)) {
		let [coord_x, coord_y] = str_to_coords(coord_str);
		let [card_num, rotation] = card;

		let card_info = CARDS[card_num];
		let rot_order = ROTATION_ORDER[rotation];

		// Rotate the hut positions
		function rotateZone(zone) {
			let new_zone = [zone[0], 0, 0, 0, 0];
			for (let i = 0; i < 4; i++) {
				if (zone[1 + rot_order[i]]) {
					new_zone[1 + i] = 1;
				}
			}
			return new_zone;
		}

		zoneGrid[coord_to_str(coord_x * 2, coord_y * 2)] = rotateZone(card_info[rot_order[0]]);
		zoneGrid[coord_to_str(coord_x * 2 + 1, coord_y * 2)] = rotateZone(card_info[rot_order[1]]);
		zoneGrid[coord_to_str(coord_x * 2 + 1, coord_y * 2 + 1)] = rotateZone(card_info[rot_order[2]]);
		zoneGrid[coord_to_str(coord_x * 2, coord_y * 2 + 1)] = rotateZone(card_info[rot_order[3]]);
	}

	debugPrintZoneGrid(zoneGrid);

	// Collect zones into territories
	var territories = [];
	var zone_territories = {};
	var unscanned_coords = new Set();

	// Collect all towers, which are a territory on their own
	for (let coords of Object.keys(zoneGrid)) {
		if (zoneGrid[coords][0] == 'T') {
			let territory = new Territory(territories.length, coords, 'T');
			territories.push(territory);
			zone_territories[coords] = territory.id;
			for (let [neighbor, ] of getNeighbors(coords)) {
				if (zoneGrid[neighbor]) {
					territory.neighbors.add(neighbor);
				}
			}
		} else {
			unscanned_coords.add(coords);
		}
	}

	// Scan all non-tower zones
	while (unscanned_coords.size) {
		let coords = unscanned_coords.keys().next().value;
		unscanned_coords.delete(coords);
		let territory = new Territory(territories.length, coords, zoneGrid[coords][0]);
		territories.push(territory);
		zone_territories[coords] = territory.id;

		// Explore the new territory
		var coords_to_explore = new Set([coords]);
		while (coords_to_explore.size) {
			let coords = coords_to_explore.keys().next().value;
			coords_to_explore.delete(coords);
			for (let [neighbor, direction] of getNeighbors(coords)) {
				if (unscanned_coords.has(neighbor) && zoneGrid[neighbor][0] == territory.type) {
					territory.zones.add(neighbor);
					zone_territories[neighbor] = territory.id;
					unscanned_coords.delete(neighbor);
					coords_to_explore.add(neighbor);
				} else if (zoneGrid[neighbor]) {
					territory.neighbors.add(neighbor);

					// Count adjacent hut
					if (territory.type == 'W' && zoneGrid[neighbor][1 + Math.abs(direction + 2) % 4]) {
						territory.huts += 1;
					}

					// TODO: Mark the border position
				}
			}
		}
	}

	// TODO: Count huts around water territories
	// TODO: Collect the zones that are on the edge of the territory (for drawing borders)

	// Build list of adjacent territories
	for (let territory of territories) {
		for (let zone of territory.neighbors) {
			territory.neighborTerritories.add(zone_territories[zone]);
		}
	}

	// for (let territory of territories) {
	// 	let coords = Array.from(territory.zones).join('  ');
	// 	let neighborTerritories = Array.from(territory.neighborTerritories).join(' ');
	// 	let r = Math.floor(Math.random() * 256);
	// 	let g = Math.floor(Math.random() * 256);
	// 	let b = Math.floor(Math.random() * 256);
	// 	let color = `rgba(${r},${g},${b},0.7)`;
	// 	markCoords(territory.zones, color, territory.id);
	// 	console.log(`${territory.id}: { type: ${territory.type}, neighbors: ${neighborTerritories} huts: ${territory.huts}, coords: ${coords} }`);
	// }
}

function markCoords(coords_list, color, id) {
	for (let coords of coords_list) {
		let [zone_x, zone_y] = str_to_coords(coords);
		//ctx.fillStyle = color;
		//ctx.fillRect(20 + zone_x * ZONE_WIDTH + 5, 40 + zone_y * ZONE_WIDTH + 5, ZONE_WIDTH / 2, ZONE_WIDTH / 2);


		ctx.font = "20px serif";
		ctx.textBaseline = "hanging";
		ctx.fillStyle = "black";
		ctx.fillText(id.toString(), 30 + zone_x * ZONE_WIDTH + 5, 50 + zone_y * ZONE_WIDTH + 5);
	}
}

function* getNeighbors(coords) {
	var [x, y] = str_to_coords(coords);
	yield [coord_to_str(x, y - 1), 0];
	yield [coord_to_str(x + 1, y), 1];
	yield [coord_to_str(x, y + 1), 2];
	yield [coord_to_str(x - 1, y), 3];
}

function Territory(id, zone, type) {
	this.id = id;
	this.type = type;
	this.zones = new Set();
	this.zones.add(zone)
	this.neighbors = new Set();
	this.neighborTerritories = new Set();
	this.huts = 0;
}

function debugPrintZoneGrid(zoneGrid) {
	var number_coords = Object.keys(zoneGrid).map(str_to_coords);
	var x_coords = number_coords.map(coords => coords[0]);
	var y_coords = number_coords.map(coords => coords[1]);
	var min_x = Math.min.apply(null, x_coords);
	var min_y = Math.min.apply(null, y_coords);
	var max_x = Math.max.apply(null, x_coords);
	var max_y = Math.max.apply(null, y_coords);

	for (let i = min_y; i <= max_y; i++) {
		let row = [];
		for (let j = min_x; j <= max_x; j++) {
			let val = zoneGrid[coord_to_str(j, i)];
			row.push(val ? `${val[0]}${val[1]}${val[2]}${val[3]}${val[4]}` : ' ');
		}
		console.log(row.join(' '));
	}
}

function draw() {

	ctx.clearRect(0, 0, canvas.width, canvas.height);
	hitCtx.clearRect(0, 0, canvas.width, canvas.height);

	// Calculate grid boundary, leaving room for 1 new card above and to the left
	var number_coords = Object.keys(CARD_MAP.cards).map(str_to_coords);
	var x_coords = number_coords.map(coords => coords[0]);
	var y_coords = number_coords.map(coords => coords[1]);
	var min_x = Math.min.apply(null, x_coords);
	var min_y = Math.min.apply(null, y_coords);
	var max_x = Math.max.apply(null, x_coords);
	var max_y = Math.max.apply(null, y_coords);

	var top_x, top_y;
	if (max_x - min_x < 3) {
		top_x = min_x - 1;
	} else {
		top_x = min_x;
	}

	if (max_y - min_y < 3) {
		top_y = min_y - 1;
	} else {
		top_y = min_y;
	}

	ctx.save();
	hitCtx.save();
	
	ctx.translate(5, 5);
	hitCtx.translate(5, 5);

	for (let [coord_str, card_info] of Object.entries(CARD_MAP.cards)) {
		let [coord_x, coord_y] = str_to_coords(coord_str);
		drawCard(
			card_info[0],
			card_info[1],
			(coord_x - top_x) * CARD_SIZE,
			(coord_y - top_y) * CARD_SIZE
		);
	}

	// Draw future placement positions
	for (let coord_str of CARD_MAP.nextPositions) {
		let [coord_x, coord_y] = str_to_coords(coord_str);
		ctx.strokeStyle = 'red';
		ctx.lineWidth = BORDER_WIDTH;
		ctx.setLineDash([8, 4]);
		ctx.strokeRect(
			(coord_x - top_x) * CARD_SIZE + 5,
			(coord_y - top_y) * CARD_SIZE + 5,
			CARD_SIZE - 10,
			CARD_SIZE - 10,
		);

		let hitRegionColor = getNewHitRegionColor();
		hitRegions[hitRegionColor] = coord_str;
		hitCtx.fillStyle = hitRegionColor;
		hitCtx.lineWidth = BORDER_WIDTH;
		hitCtx.fillRect(
			(coord_x - top_x) * CARD_SIZE + 5,
			(coord_y - top_y) * CARD_SIZE + 5,
			CARD_SIZE - 10,
			CARD_SIZE - 10,
		);
	}
	
	hitCtx.restore();
	ctx.restore();
}

function drawCard(num, rot, x, y) {

	ctx.save();

	if (rot == 0) {
		ctx.translate(x, y);
	} else if (rot == 1) {
		ctx.translate(x + CARD_SIZE, y);
		ctx.rotate(Math.PI * 0.5);
	} else if (rot == 2) {
		ctx.translate(x + CARD_SIZE, y + CARD_SIZE);
		ctx.rotate(Math.PI);
	} else if (rot == 3) {
		ctx.translate(x, y + CARD_SIZE);
		ctx.rotate(Math.PI * 1.5);
	}

	ctx.strokeStyle = BORDER_COLOR;
	ctx.lineWidth = BORDER_WIDTH;
	ctx.strokeRect(0, 0, CARD_SIZE, CARD_SIZE);

	ctx.lineWidth = INNER_BORDER_WIDTH;
	ctx.beginPath();
	ctx.moveTo(
		BORDER_WIDTH / 2,
		CARD_SIZE / 2,
	);
	ctx.lineTo(
		CARD_SIZE - BORDER_WIDTH / 2,
		CARD_SIZE / 2
	);
	ctx.moveTo(
		CARD_SIZE / 2,
		BORDER_WIDTH / 2,
	);
	ctx.lineTo(
		CARD_SIZE / 2,
		CARD_SIZE - BORDER_WIDTH / 2
	);
	ctx.stroke();

	var card_info = CARDS[num];

	for (let i = 0; i < 4; i++) {
		drawZone(card_info[i], i);
	}

	// Draw card number

	ctx.fillStyle = BORDER_COLOR;
	var circle_x = CARD_SIZE / 2;
	var circle_y = CARD_SIZE / 2;
	var radius = CARD_SIZE * 0.1;
	ctx.beginPath();
	ctx.arc(circle_x, circle_y, radius, 0, 2 * Math.PI);
	ctx.fill();

	ctx.fillStyle = 'white';
	ctx.beginPath();
	radius = CARD_SIZE * 0.09;
	ctx.arc(circle_x, circle_y, radius, 0, 2 * Math.PI);
	ctx.fill();

	ctx.font = (CARD_SIZE * 0.1).toString() + 'px serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillStyle = 'black';
	var card_str = num.toString();
	if (num == 6 || num == 9) {
		card_str += '.';
	}
	ctx.fillText(card_str, circle_x, circle_y);

	ctx.restore();
}

function drawZone(zone_info, quad) {
	var [zone_x, zone_y] = ZONE_ORIGINS[quad];

	ctx.fillStyle = COLORS[zone_info[0]];
	ctx.fillRect(zone_x, zone_y, ZONE_WIDTH, ZONE_WIDTH);

	// Draw huts
	if (zone_info.length == 1)
		return;

	var center = ZONE_WIDTH / 2
	ctx.fillStyle = HUT_COLOR;

	// North
	if (zone_info[1]) {
		ctx.fillRect(
			zone_x + center - HUT_SIZE / 2,
			zone_y + BORDER_WIDTH,
			HUT_SIZE,
			HUT_SIZE
		);
	}

	// East
	if (zone_info[2]) {
		ctx.fillRect(
			zone_x + ZONE_WIDTH - BORDER_WIDTH - HUT_SIZE,
			zone_y + center - HUT_SIZE / 2,
			HUT_SIZE,
			HUT_SIZE
		);
	}

	// South
	if (zone_info[3]) {
		ctx.fillRect(
			zone_x + center - HUT_SIZE / 2,
			zone_y + ZONE_WIDTH - BORDER_WIDTH - HUT_SIZE,
			HUT_SIZE,
			HUT_SIZE
		);
	}

	// West
	if (zone_info[4]) {
		ctx.fillRect(
			zone_x + BORDER_WIDTH,
			zone_y + center - HUT_SIZE / 2,
			HUT_SIZE,
			HUT_SIZE
		);
	}

}

// Cards have an array with 4 zones:
//   [NW, NE, SE, SW]
// Each zone is an array of the type, followed by booleans if there's a hut:
//   [TYPE, NORTH_HUT, EAST_HUT, SOUTH_HUT, WEST_HUT]
// (if an array is shorter than 5 elems, assume false)
//
// Type is:
// 'Y': field
// 'W': Water
// 'F': Forest
// 'T': Tower

var ROTATION_ORDER = {
	0: [0, 1, 2, 3],
	1: [3, 0, 1, 2],
	2: [2, 3, 0, 1],
	3: [1, 2, 3, 0],
}

var COLORS = {
	'Y': '#eab529',
	'W': '#094b99',
	'F': '#79a029',
	'T': '#989993',
}

var CARDS = {
	1 : [['F', 1], ['Y', 0, 1], ['Y'], ['F']],
	2 : [['W'], ['T'], ['W'], ['T', 1, 1]],
	3 : [['T', 0, 0, 1, 1], ['Y'], ['T', 0, 0, 0, 1], ['W']],
	4 : [['T', 0, 0, 0, 1], ['F'], ['W'], ['F', 0, 1]],
	5 : [['W'], ['Y', 0, 0, 1], ['W'], ['F', 0, 0, 1]],
	6 : [['T'], ['Y'], ['F', 0, 0, 1], ['Y', 0, 0, 0, 1]],
	7 : [['Y'], ['Y', 0, 1, 1], ['W'], ['W']],
	8 : [['T', 1], ['F', 0, 1], ['T'], ['F']],
	9 : [['T', 0, 0, 1], ['W'], ['F', 1], ['W']],
	10 : [['Y', 0, 0, 0, 1], ['F'], ['W'], ['F', 0, 1]],
	11 : [['Y', 0, 0, 0, 1], ['T'], ['Y', 0, 0, 1], ['T']],
	12 : [['F', 0, 0, 0, 1], ['W'], ['W'], ['F', 0, 1]],
	13 : [['Y'], ['Y'], ['F', 0, 1], ['F', 0, 0, 0, 1]],
	14 : [['W'], ['F', 0, 0, 1, 1], ['W'], ['F', 1]],
	15 : [['W'], ['Y', 0, 1, 0, 1], ['T'], ['Y', 1]],
	16 : [['F'], ['Y'], ['F', 0, 1], ['T', 0, 0, 0, 1]],
	17 : [['Y', 0, 0, 0, 1], ['Y', 0, 0, 1], ['W'], ['W']],
	18 : [['F', 0, 0, 0, 1], ['Y'], ['W'], ['Y', 0, 1]],
	19 : [['T', 1], ['Y'], ['T'], ['F', 0, 0, 1]],
	20 : [['W'], ['Y', 0, 0, 0, 1], ['W'], ['Y', 0, 1]],
	21 : [['T', 1], ['W'], ['T', 1], ['F']],
	22 : [['Y', 0, 1], ['W'], ['T', 0, 0, 0, 1], ['W']],
	23 : [['W'], ['W'], ['F', 0, 1], ['F', 0, 0, 1]],
	24 : [['Y', 1, 0, 0, 1], ['F'], ['Y'], ['F']],
}
