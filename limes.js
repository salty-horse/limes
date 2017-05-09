'use strict';

var CARD_SIZE = 200;
var BORDER_WIDTH = 6;
var INNER_BORDER_WIDTH = 2;
var BORDER_COLOR = '#547062';
var HUT_COLOR = '#5182ad';
var HUT_SIZE = CARD_SIZE * 0.1;

var canvas;
var ctx;


// Rotation stuff for huts:
// zone_info[(4 - rot) % 4 + 1]
// zone_info[(5 - rot) % 4 + 1]
// zone_info[(6 - rot) % 4 + 1]
// zone_info[(7 - rot) % 4 + 1]

window.addEventListener('load', function(){
	canvas = document.getElementById('canvas');
	ctx = canvas.getContext('2d');
	//ctx.translate(0.5, 0.5);
	//drawCard(1, 0, 20, 40);
	//drawCard(1, 3, 20, CARD_SIZE + 100);


	var allCards = {
		cards: {
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
		},
	};


	var sampleMap = {
		cards: {
			'0,0': [1, 0],
			'1,0': [7, 2],
			'2,0': [6, 3],
			'3,0': [22, 0],
			'0,1': [5, 0],
			'1,1': [19, 3],
			'2,1': [12, 0],
			'3,1': [14, 0],
			'0,2': [9, 3],
			'1,2': [4, 0],
			'2,2': [23, 1],
			'3,2': [3, 1],
			'0,3': [24, 3],
			'1,3': [8, 0],
			'2,3': [10, 3],
			'3,3': [20, 2],
		},
	}

	drawMap(sampleMap, 20, 40);
	parseMap(sampleMap);
});

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
	var unscanned_coords = new Set();

	// First collect all towers, which are a territory on their own
	for (let coords of Object.keys(zoneGrid)) {
		if (zoneGrid[coords][0] == 'T') {
			territories.push(new Territory(territories.length, coords));
			console.log(`New tower territory ${coords}`);
		} else {
			unscanned_coords.add(coords);
		}
	}


	while (unscanned_coords.size) {
		let coords = unscanned_coords.keys().next().value;
		let coord_type = zoneGrid[coords][0];
		unscanned_coords.delete(coords);
		let current_territory = new Territory(territories.length, coords);
		territories.push(current_territory);
		for (let neighbor of getNeighbors(coords)) {
			if (unscanned_coords.has(neighbor)) {
				if (zoneGrid[neighbor][0] == coord_type) {
					current_territory.coords.add(neighbor);
					unscanned_coords.delete(neighbor);
				} else {
					current_territory.neighbors.add(neighbor);
				}
			} else if (zoneGrid[neighbor]) {
				current_territory.neighbors.add(neighbor);
			}
		}
	}

	for (let territory of territories) {
		let coords = Array.from(territory.coords).join('  ');
		console.log(`${territory.id}: { coords: ${coords} }`);
	}

	// TODO: Count huts around water territories
	// TODO: Collect the zones that are on the edge of the territory (for drawing borders)
	// TODO: Collect list of adjacent territories

}

function* getNeighbors(coords) {
	var [x, y] = str_to_coords(coords);
	for (var i = -1; i <= 1; i++) {
		for (var j = -1; j <= 1; j++) {
			if (i == 0 && j == 0) {
				continue
			}
			yield coord_to_str(x + i, y + j);
		}
	}
}

function Territory(id, coord) {
	this.id = id;
	this.coords = new Set();
	this.coords.add(coord)
	this.neighbors = new Set();
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

function drawMap(map, x, y) {
	for (let [coord_str, card_info] of Object.entries(map.cards)) {
		let [coord_x, coord_y] = str_to_coords(coord_str);
		drawCard(
			card_info[0],
			card_info[1],
			x + coord_x * CARD_SIZE,
			y + coord_y * CARD_SIZE
		);
	}
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
	ctx.fillText(card_str, CARD_SIZE / 2, CARD_SIZE / 2);

	ctx.restore();
}

function drawZone(zone_info, quad) {
	var zone_x = BORDER_WIDTH / 2;
	var zone_y = BORDER_WIDTH / 2;
	var zone_width = CARD_SIZE / 2 - BORDER_WIDTH / 2 - INNER_BORDER_WIDTH / 2;

	if (quad == 1) {
		zone_x += zone_width + INNER_BORDER_WIDTH;
	} else if (quad == 2) {
		zone_x += zone_width + INNER_BORDER_WIDTH;
		zone_y += zone_width + INNER_BORDER_WIDTH;
	} else if (quad == 3) {
		zone_y += zone_width + INNER_BORDER_WIDTH;
	}

	ctx.fillStyle = COLORS[zone_info[0]];
	ctx.fillRect(zone_x, zone_y, zone_width, zone_width);

	// Draw huts
	if (zone_info.length == 1)
		return;

	var center = zone_width / 2
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
			zone_x + zone_width - BORDER_WIDTH - HUT_SIZE,
			zone_y + center - HUT_SIZE / 2,
			HUT_SIZE,
			HUT_SIZE
		);
	}
	// South
	if (zone_info[3]) {
		ctx.fillRect(
			zone_x + center - HUT_SIZE / 2,
			zone_y + zone_width - BORDER_WIDTH - HUT_SIZE,
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
