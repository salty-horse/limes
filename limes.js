'use strict';

const CARD_WIDTH = 180;
const CARD_SPACING = 2;
const BORDER_WIDTH = 8;
const INNER_BORDER_WIDTH = 2;
const ZONE_WIDTH = CARD_WIDTH / 2 - BORDER_WIDTH - INNER_BORDER_WIDTH / 2;
const BORDER_COLOR = '#547062';
const HUT_COLOR = '#5182ad';
const HUT_WIDTH = Math.round(ZONE_WIDTH / 4);
const BUTTON_RADIUS = CARD_WIDTH * 0.15;
const CANVAS_OFFSET = BUTTON_RADIUS * 2 - 10;
const PANNING_DURATION_MILLIS = 200;


class Point {
	constructor(x, y) {
		this.x = x;
		this.y = y;
	}

	equals(other) {
		if (!other) {
			return false;
		}
		if (!(other instanceof Point)) {
			throw new Error('other must be a Point');
		}
		return this.x == other.x && this.y == other.y;
	}

	toString() {
		return '(' + this.x + ', ' + this.y + ')';
	}

	inspect() {
		return this.toString();
	}

	toImmutable() {
		return this.x + ',' + this.y;
	}

	static fromImmutable(s) {
		let p = s.split(',', 2).map(x => Number.parseInt(x));
		return new Point(p[0], p[1]);
	}
}

class PointMap {
	constructor() {
		this._map = new Map();
	}

	get size() {
		return this._map.size;
	}

	get(key) {
		return this._map.get(key.toImmutable());
	}

	has(key) {
		return this._map.has(key.toImmutable());
	}

	* keys() {
		for (let key of this._map.keys()) {
			yield Point.fromImmutable(key);
		}
	}

	set(key, value) {
		if (!(key instanceof Point)) {
			throw new Error('PointMap keys must be Points');
		}
		this._map.set(key.toImmutable(), value);
	}

	delete(key) {
		return this._map.delete(key.toImmutable());
	}

	[Symbol.iterator]() {
		let map_it = this._map[Symbol.iterator]();

		return {
			next: function() {
				let map_next = map_it.next();
				if (map_next.value !== undefined) {
					map_next.value[0] = Point.fromImmutable(map_next.value[0]);
				}
				return map_next;
			}
		}
	}
}

class PointSet {
	constructor() {
		this._set = new Set();
	}

	get size() {
		return this._set.size;
	}

	has(value) {
		return this._set.has(value.toImmutable());
	}

	add(value) {
		if (!(value instanceof Point)) {
			throw new Error('PointSet values must be Points');
		}
		this._set.add(value.toImmutable());
	}

	delete(value) {
		return this._set.delete(value.toImmutable());
	}

	* values() {
		for (let value of this._set.values()) {
			yield Point.fromImmutable(value);
		}
	}

	[Symbol.iterator]() {
		let set_it = this._set[Symbol.iterator]();

		return {
			next: function() {
				let set_next = set_it.next();
				if (set_next.value !== undefined) {
					set_next.value = Point.fromImmutable(set_next.value);
				}
				return set_next;
			}
		}
	}
}

// Offsets of each zone from card origin.
// These are used to identify zone x/y positions.
const ZONE_ORIGINS = [
	[
		BORDER_WIDTH,
		BORDER_WIDTH
	],
	[
		BORDER_WIDTH + ZONE_WIDTH + INNER_BORDER_WIDTH,
		BORDER_WIDTH
	],
	[
		BORDER_WIDTH + ZONE_WIDTH + INNER_BORDER_WIDTH,
		BORDER_WIDTH + ZONE_WIDTH + INNER_BORDER_WIDTH
	],
	[
		BORDER_WIDTH,
		BORDER_WIDTH + ZONE_WIDTH + INNER_BORDER_WIDTH
	],
]

let canvas, ctx;
let hitCanvas, hitCtx;
let newCardCanvas, newCardCtx;
let hitRegions = {};

let workerImage;
let WORKER_WIDTH;
let WORKER_HEIGHT;
let WORKER_OUTLINE_SIDE;
let WORKER_OUTLINE_ORIGIN;
let WORKER_X;
let WORKER_Y;



function getNewHitRegion(name) {
	while (true) {
		let r = 1 + Math.floor(Math.random() * 255);
		let g = 1 + Math.floor(Math.random() * 255);
		let b = 1 + Math.floor(Math.random() * 255);
		let color = `rgb(${r},${g},${b})`;
		if (!hitRegions[color]) {
			hitRegions[color] = name;
			return color;
		}
	}
}


let GameState = {
	PLACE_CARD: 1,
	ROTATE_CARD: 2,
	PLACE_OR_MOVE_WORKER: 3,
	PLACE_WORKER: 4,
	MOVE_WORKER: 5,
	GAME_OVER: 6,
}

// This marks the positions of all cards on the canvas
let Game = {
	addCard: function(coord, card) {
		this.cards.set(coord, card);

		// Adjust grid side

		if (coord.x < this.minX) {
			this.sizeX += this.minX - coord.x;
			this.minX = coord.x;
		}
		if (coord.y < this.minY) {
			this.sizeY += this.minY - coord.y;
			this.minY = coord.y;
		}
		if (coord.x >= this.minX + this.sizeX) {
			this.sizeX = coord.x - this.minX + 1;
		}
		if (coord.y >= this.minY + this.sizeY) {
			this.sizeY = coord.y - this.minY + 1;
		}
	},

	// This is used when undoing a card placement
	removeCard: function(coord) {
		this.cards.delete(coord);

		// Adjust grid side
		let number_coords = Array.from(this.cards.keys());
		let x_coords = number_coords.map(coords => coords.x);
		let y_coords = number_coords.map(coords => coords.y);
		this.minX = Math.min.apply(null, x_coords);
		this.minY = Math.min.apply(null, y_coords);
		this.sizeX = Math.max.apply(null, x_coords) - this.minX + 1;
		this.sizeY = Math.max.apply(null, y_coords) - this.minY + 1;
	},

	markNextCardPositions: function() {
		this.nextPositions.length = 0;
		for (let card of this.cards.keys()) {
			for (let [neighbor, ] of getNeighbors(card)) {
				if (this.cards.has(neighbor))
					continue;

				if (this.sizeX == 4 && (neighbor.x < this.minX || neighbor.x >= this.minX + this.sizeX))
					continue;

				if (this.sizeY == 4 && (neighbor.y < this.minY || neighbor.y >= this.minY + this.sizeY))
					continue;

				this.nextPositions.push(neighbor);
			}
		}

		let oldX = this.originX;
		let oldY = this.originY;

		// Calculate new grid origin
		if (this.sizeX < 4) {
			this.originX = this.minX - 1;
		} else {
			this.originX = this.minX;
		}

		if (this.sizeY < 4) {
			this.originY = this.minY - 1;
		} else {
			this.originY = this.minY;
		}

		// If the grid origin changed, start panning

		if (oldX != this.originX || oldY != this.originY) {
			Game.panSpeedX = (oldX - this.originX) / PANNING_DURATION_MILLIS;
			Game.panSpeedY = (oldY - this.originY) / PANNING_DURATION_MILLIS;

			Game.panX = (this.originX - oldX);
			Game.panY = (this.originY - oldY);
			Game.panStartX = Game.panX;
			Game.panStartY = Game.panY;

			window.requestAnimationFrame(panCanvas);
		}
	},

	newGame: function() {
		this.state = GameState.PLACE_OR_MOVE_WORKER;

		// card grid size and the minimal values - set by addCard()
		this.sizeX = 1;
		this.sizeY = 1;
		this.minX = 0;
		this.minY = 0;

		// Grid origin, accounting for future placements
		this.originX = -1;
		this.originY = -1;

		this.panX = 0;
		this.panY = 0;
		this.panStartX = 0;
		this.panStartY = 0;
		this.panStartTime = null;


		this.newCard = null;
		this.newCardPosition = new Point(0, 0);
		this.newCardRotation = 0;

		this.workerSupply = 7;

		// Zones the workers are on.
		this.workers = [];

		this.selectedTerritory = null;
		this.selectedWorker = null;

		this.cardDeck = Object.keys(CARDS);
		this.cardRNG = new Math.seedrandom('test_game');

		this.cards = new PointMap();
		this.nextPositions = [];

		this.targetTerritories = new Set();

		// Draw new card
		let ix = Math.floor(this.cardRNG() * this.cardDeck.length);
		this.addCard(new Point(0, 0), [this.cardDeck[ix], 0]);
		this.cardDeck.splice(ix, 1);
		this.update();
	},

	update: function() {
		clearHTMLButtons();

		let instruction_label = document.getElementById('instruction');

		if (this.state == GameState.PLACE_CARD) {
			if (this.newCard == null) {
				if (this.cards.size == 16) {
					this.state = GameState.GAME_OVER;
				} else {
					// Draw new card from the deck
					let ix = Math.floor(this.cardRNG() * this.cardDeck.length);
					this.newCard = this.cardDeck[ix];
					this.cardDeck.splice(ix, 1);
					this.markNextCardPositions();

					// Draw card onto mini-canvas
					drawCard(newCardCtx, this.newCard, 0, 0, 0);
					instruction_label.textContent = 'Place the card:';
					clearHTMLButtons();
				}
			}
		} else if (this.state == GameState.PLACE_OR_MOVE_WORKER) {
			let instruction_text;

			if (this.workerSupply > 0 && this.workers.length == 0) {
				instruction_text = 'Place a worker or continue';
			} else if (this.workerSupply > 0) {
				instruction_text = 'Place or move a worker or continue';
			} else {
				instruction_text = 'Move a worker or continue';
			}

			if (this.workerSupply > 0) {
				let supplyButton = document.getElementById('supply_button');
				supplyButton.classList.add('highlight');
				supplyButton.onclick = () => { actionHandler('place_worker'); };
			}

			instruction_label.textContent = instruction_text;

			if (this.cards.size != 1) {
				addHTMLButton('go_back', 'Undo card placement');
			}
			addHTMLButton('skip', this.cards.size != 16 ? 'Draw next card' : 'End game');

		} else if (this.state == GameState.PLACE_WORKER) {
			if (this.selectedTerritory) {
				instruction_label = 'Undo or continue';

				addHTMLButton('cancel', 'Undo worker placement');
				addHTMLButton('confirm', 'Draw next card');
			} else {
				instruction_label.textContent = 'Select a territory to place the worker in';

				// Mark the territories on the placed card as selectable
				for (let pos of getCardZones(this.newCardPosition)) {
					this.targetTerritories.add(this.zoneTerritories.get(pos));
				}

				addHTMLButton('cancel', 'Undo worker placement');
			}
		} else if (this.state == GameState.MOVE_WORKER) {
			if (this.selectedTerritory) {
				instruction_label = 'Undo or continue';

				addHTMLButton('cancel', 'Undo worker movement');
				addHTMLButton('confirm', 'Draw next card');
			} else {
				instruction_label.textContent = 'Select a territory to move the worker to';

				// Mark adjacent territories as selectable
				let territory = Game.territories[Game.zoneTerritories.get(Game.selectedWorker)];
				for (let ter_id of territory.neighborTerritories) {
					this.targetTerritories.add(ter_id);
				}

				addHTMLButton('cancel', 'Undo worker movement');
			}
		}

		if (this.state == GameState.GAME_OVER) {
			instruction_label.textContent = 'Game over! TODO: Score summary';
		}

		// Update HTML
		if (this.state == GameState.PLACE_CARD) {
			newCardCanvas.hidden = false;
		}

		if (this.state != GameState.PLACE_CARD && this.state != GameState.ROTATE_CARD) {
			newCardCanvas.hidden = true;
		}

		document.getElementById('supply').textContent = this.workerSupply;
	},
}


window.addEventListener('load', function() {
	canvas = document.getElementById('canvas');
	canvas.width = canvas.height = CARD_WIDTH * 5 + CANVAS_OFFSET * 2 + 10;
	ctx = canvas.getContext('2d');

	hitCanvas = document.createElement('canvas');
	hitCanvas.width = canvas.width;
	hitCanvas.height = canvas.height;
	hitCtx = hitCanvas.getContext('2d');

	newCardCanvas = document.getElementById('new_card');
	newCardCanvas.width = CARD_WIDTH;
	newCardCanvas.height = CARD_WIDTH;
	newCardCtx = newCardCanvas.getContext('2d');

	workerImage = document.getElementById('worker_image');

	// Pre-calculate how to draw the worker on the map
	let worker_side = ZONE_WIDTH - HUT_WIDTH * 2;
	if (workerImage.naturalWidth > workerImage.naturalHeight) {
		WORKER_WIDTH = worker_side;
		WORKER_HEIGHT = Math.floor(workerImage.naturalHeight * (worker_side / workerImage.naturalWidth));
	} else if (workerImage.naturalHeight > workerImage.naturalWidth) {
		WORKER_HEIGHT = worker_side;
		WORKER_WIDTH = Math.floor(workerImage.naturalWidth * (worker_side / workerImage.naturalHeight));
	} else {
		WORKER_WIDTH = worker_side;
		WORKER_HEIGHT = worker_side;
	}

	WORKER_OUTLINE_SIDE = Math.max(WORKER_WIDTH, WORKER_HEIGHT) + 8;
	WORKER_X = Math.floor((ZONE_WIDTH - WORKER_WIDTH) / 2);
	WORKER_Y = Math.floor((ZONE_WIDTH - WORKER_HEIGHT) / 2);
	WORKER_OUTLINE_ORIGIN = Math.min(WORKER_X, WORKER_Y) - 4;

	// let allCards = {
	// 	'0,0': [1, 0],
	// 	'1,0': [2, 0],
	// 	'2,0': [3, 0],
	// 	'3,0': [4, 0],
	// 	'4,0': [5, 0],
	// 	'5,0': [6, 0],
	// 	'0,1': [7, 0],
	// 	'1,1': [8, 0],
	// 	'2,1': [9, 0],
	// 	'3,1': [10, 0],
	// 	'4,1': [11, 0],
	// 	'5,1': [12, 0],
	// 	'0,2': [13, 0],
	// 	'1,2': [14, 0],
	// 	'2,2': [15, 0],
	// 	'3,2': [16, 0],
	// 	'4,2': [17, 0],
	// 	'5,2': [18, 0],
	// 	'0,3': [19, 0],
	// 	'1,3': [20, 0],
	// 	'2,3': [21, 0],
	// 	'3,3': [22, 0],
	// 	'4,3': [23, 0],
	// 	'5,3': [24, 0],
	// };
	// Game.addCards(allCards);

	// Game.addCards({
		// '0,0': [1, 0],
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
	// });

	Game.newGame();
	parseMap();
	draw();

	canvas.addEventListener('click', function(e) {
		const rect = canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		const pixel = hitCtx.getImageData(x, y, 1, 1).data;
		const color = `rgb(${pixel[0]},${pixel[1]},${pixel[2]})`;
		const clickRegion = hitRegions[color];
		if (!clickRegion) {
			return;
		}

		actionHandler(clickRegion);
	});
});

// Handles action caused by button presses (HTML buttons or canvas)
function actionHandler(action) {
	if (Game.state == GameState.PLACE_CARD) {
		Game.newCardPosition = Point.fromImmutable(action);
		Game.state = GameState.ROTATE_CARD;

	} else if (Game.state == GameState.ROTATE_CARD) {
		if (action == 'confirm') {
			Game.addCard(Game.newCardPosition, [Game.newCard, Game.newCardRotation]);
			Game.newCardRotation = 0;
			Game.state = GameState.PLACE_OR_MOVE_WORKER;

			// Game.newCard = null;
			// Game.state = GameState.PLACE_CARD;

		} else if (action == 'cancel') {
			Game.state = GameState.PLACE_CARD;
			Game.newCardRotation = 0; // TODO: Keep rotation?
		} else if (action == 'rotate_left') {
			Game.newCardRotation = (Game.newCardRotation + 3) % 4;
		} else if (action == 'rotate_right') {
			Game.newCardRotation = (Game.newCardRotation + 1) % 4;
		}
	} else if (Game.state == GameState.PLACE_OR_MOVE_WORKER) {
		Game.selectedTerritory = null;

		if (action == 'place_worker') {
			Game.state = GameState.PLACE_WORKER;
		} else if (action == 'skip') {
			Game.state = GameState.PLACE_CARD;
			Game.newCard = null;
			Game.newCardRotation = 0;
		} else if (action == 'go_back') {
			Game.state = GameState.PLACE_CARD;
			Game.removeCard(Game.newCardPosition);
		} else {
			// Chosen a worker to move
			Game.selectedWorker = Point.fromImmutable(action);
			Game.state = GameState.MOVE_WORKER;
		}
	} else if (Game.state == GameState.PLACE_WORKER) {
		if (action == 'cancel') {
			if (Game.selectedTerritory) {
				Game.selectedTerritory = null;
				Game.workerSupply++;
				Game.workers.pop();
			}
			Game.targetTerritories.clear();
			Game.state = GameState.PLACE_OR_MOVE_WORKER;
		} else if (action == 'confirm') {
			Game.targetTerritories.clear();
			Game.selectedTerritory = null;
			Game.state = GameState.PLACE_CARD;
			Game.newCard = null;
			Game.newCardRotation = 0;
		} else {
			// A territory was chosen
			Game.selectedTerritory = Game.territories[action];
			Game.workerSupply--;
			let existingWorkerZone = findWorkerInTerritory(Game.selectedTerritory);

			// Place the worker in the territory
			if (existingWorkerZone) {
				// Reuse an existing worker position
				Game.workers.push(existingWorkerZone);
			} else {
				// Pick the first zone of the current card
				for (let pos of getCardZones(Game.newCardPosition)) {
					if (Game.selectedTerritory.zones.has(pos)) {
						Game.workers.push(pos);
						break;
					}
				}
			}
			Game.targetTerritories.clear();
		}
	} else if (Game.state == GameState.MOVE_WORKER) {
		if (action == 'cancel') {
			if (Game.selectedTerritory) {
				Game.selectedTerritory = null;
				Game.workers.pop();
				Game.workers.push(Game.selectedWorker);
			}
			Game.targetTerritories.clear();
			Game.selectedWorker = null;
			Game.state = GameState.PLACE_OR_MOVE_WORKER;
		} else if (action == 'confirm') {
			Game.targetTerritories.clear();
			Game.selectedTerritory = null;
			Game.selectedWorker = null;
			Game.state = GameState.PLACE_CARD;
			Game.newCard = null;
			Game.newCardRotation = 0;
		} else {
			// A territory was chosen
			Game.selectedTerritory = Game.territories[action];

			// Remove worker from array
			let ix = 0;
			for (; ix < Game.workers.length; ix++) {
				if (Game.workers[ix].equals(Game.selectedWorker)) {
					Game.workers.splice(ix, 1);
					break;
				}
			}

			let existingWorkerZone = findWorkerInTerritory(Game.selectedTerritory);

			// Place the worker in the territory
			if (existingWorkerZone) {
				// Reuse an existing worker position
				Game.workers.push(existingWorkerZone);
			} else {
				// Pick the top-left zone
				Game.workers.push(Game.selectedTerritory.topLeftZone);
			}
			Game.targetTerritories.clear();
		}
	}

	Game.update();
	parseMap(); // TODO: In some cases we don't need to call this
	draw();
}


function* getCardZones(card_pos) {
	yield new Point(card_pos.x * 2, card_pos.y * 2);
	yield new Point(card_pos.x * 2 + 1, card_pos.y * 2);
	yield new Point(card_pos.x * 2, card_pos.y * 2 + 1);
	yield new Point(card_pos.x * 2 + 1, card_pos.y * 2 + 1);
}

function findWorkerInTerritory(territory) {
	for (let worker_pos of Game.workers) {
		if (territory.zones.has(worker_pos)) {
			return worker_pos;
		}
	}
	return null;
}

function parseMap() {
	// Build grid of zones
	let zoneGrid = new PointMap();

	function addCardToGrid(coord, card_num, rotation) {
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

		zoneGrid.set(new Point(coord.x * 2, coord.y * 2), rotateZone(card_info[rot_order[0]]));
		zoneGrid.set(new Point(coord.x * 2 + 1, coord.y * 2), rotateZone(card_info[rot_order[1]]));
		zoneGrid.set(new Point(coord.x * 2 + 1, coord.y * 2 + 1), rotateZone(card_info[rot_order[2]]));
		zoneGrid.set(new Point(coord.x * 2, coord.y * 2 + 1), rotateZone(card_info[rot_order[3]]));
	}

	for (let [coord, [num, rotation]] of Game.cards) {
		addCardToGrid(coord, num, rotation);
	}

	if (Game.state == GameState.ROTATE_CARD) {
		addCardToGrid(Game.newCardPosition, Game.newCard, Game.newCardRotation);
	}

	debugPrintZoneGrid(zoneGrid);

	// Collect zones into territories
	Game.territories = [];
	Game.zoneTerritories = new PointMap();
	let unscanned_coords = new PointSet();

	// Collect all towers, which are a territory on their own
	for (let [coords, zone_info] of zoneGrid) {
		if (zone_info[0] == 'T') {
			let territory = new Territory(Game.territories.length, coords, 'T');
			Game.territories.push(territory);
			Game.zoneTerritories.set(coords, territory.id);
			for (let [neighbor, ] of getNeighbors(coords)) {
				if (zoneGrid.has(neighbor)) {
					territory.neighbors.add(neighbor);
				}
			}
		} else {
			unscanned_coords.add(coords);
		}
	}

	// Scan all non-tower zones
	while (unscanned_coords.size) {
		let coords = unscanned_coords.values().next().value;
		unscanned_coords.delete(coords);
		let territory = new Territory(Game.territories.length, coords, zoneGrid.get(coords)[0]);
		Game.territories.push(territory);
		Game.zoneTerritories.set(coords, territory.id);

		// Explore the new territory
		let coords_to_explore = new PointSet();
		coords_to_explore.add(coords);
		while (coords_to_explore.size) {
			let coords = coords_to_explore.values().next().value;
			coords_to_explore.delete(coords);
			for (let [neighbor, direction] of getNeighbors(coords)) {
				if (unscanned_coords.has(neighbor) && zoneGrid.get(neighbor)[0] == territory.type) {
					territory.zones.add(neighbor);
					Game.zoneTerritories.set(neighbor, territory.id);
					unscanned_coords.delete(neighbor);
					coords_to_explore.add(neighbor);
				} else if (zoneGrid.has(neighbor) && zoneGrid.get(neighbor)[0] != territory.type) {
					territory.neighbors.add(neighbor);

					// Count adjacent hut
					if (territory.type == 'W' && zoneGrid.get(neighbor)[1 + Math.abs(direction + 2) % 4]) {
						territory.huts += 1;
					}
				}
			}
		}
	}

	// Build list of adjacent territories
	for (let territory of Game.territories) {
		for (let zone of territory.neighbors) {
			territory.neighborTerritories.add(Game.zoneTerritories.get(zone));
		}
	}

	// TODO: Move this away. Only calc when need to place meeple
	calcTerritoryPaths();


	// console.log(`Territories: ${Game.territories.length}`);
	// for (let territory of Game.territories) {
	// 	let coords = Array.from(territory.zones).join('  ');
	// 	let neighborTerritories = Array.from(territory.neighborTerritories).join(' ');
	// 	console.log(`${territory.id}: { type: ${territory.type}, neighbors: ${neighborTerritories} huts: ${territory.huts}, coords: ${coords} }`);
	// }
}

function* getNeighbors(coords) {
	yield [new Point(coords.x, coords.y - 1), 0];
	yield [new Point(coords.x + 1, coords.y), 1];
	yield [new Point(coords.x, coords.y + 1), 2];
	yield [new Point(coords.x - 1, coords.y), 3];
}

function Territory(id, zone, type) {
	this.id = id;
	this.type = type;
	this.zones = new PointSet();
	this.zones.add(zone)
	this.neighbors = new PointSet();
	this.neighborTerritories = new Set();
	this.huts = 0;
	this.path = null;
	this.topLeftZone = null;
}

function debugPrintZoneGrid(zoneGrid) {
	let number_coords = Object.keys(zoneGrid).map(Point.fromImmutable);
	let x_coords = number_coords.map(pos => pos[0]);
	let y_coords = number_coords.map(pos => pos[1]);
	let min_x = Math.min.apply(null, x_coords);
	let min_y = Math.min.apply(null, y_coords);
	let max_x = Math.max.apply(null, x_coords);
	let max_y = Math.max.apply(null, y_coords);

	for (let i = min_y; i <= max_y; i++) {
		let row = [];
		for (let j = min_x; j <= max_x; j++) {
			let val = zoneGrid[new Point(j, i).toImmutable()];
			row.push(val ? `${i},${j} ${val[0]}${val[1]}${val[2]}${val[3]}${val[4]}` : ' ');
		}
		console.log(row.join(' '));
	}
}

// Asssuming the card grid is drawn from 0,0,
// gets the positions of the 4 corners [NW, NE, SE, SW]
function getZoneCornersInCanvas(pos) {
	let cardX = Math.floor(pos.x / 2);
	let cardY = Math.floor(pos.y / 2);
	let canvasCardX = cardX * (CARD_WIDTH + CARD_SPACING);
	let canvasCardY = cardY * (CARD_WIDTH + CARD_SPACING);
	let modX = Math.abs(pos.x % 2);
	let modY = Math.abs(pos.y % 2);
	let zoneQuad;

	if (modX == 0 && modY == 0) {
		zoneQuad = 0;
	} else if (modX == 1 && modY == 0) {
		zoneQuad = 1;
	} else if (modX == 1 && modY == 1) {
		zoneQuad = 2;
	} else if (modX == 0 && modY == 1) {
		zoneQuad = 3;
	}

	let zoneOrigin = ZONE_ORIGINS[zoneQuad];
	return [
		[canvasCardX + zoneOrigin[0], canvasCardY + zoneOrigin[1]],
		[canvasCardX + zoneOrigin[0] + ZONE_WIDTH, canvasCardY + zoneOrigin[1]],
		[canvasCardX + zoneOrigin[0] + ZONE_WIDTH, canvasCardY + zoneOrigin[1] + ZONE_WIDTH],
		[canvasCardX + zoneOrigin[0], canvasCardY + zoneOrigin[1] + ZONE_WIDTH],
	];
}

// Calculates a path around each territory
function calcTerritoryPaths() {
	for (let territory of Game.territories) {
		// Size 1 territories are simple
		if (territory.zones.size == 1) {
			territory.topLeftZone = territory.zones.values().next().value;
			let zoneCorners = getZoneCornersInCanvas(territory.zones.values().next().value);
			let p = new Path2D();
			p.moveTo(zoneCorners[0][0], zoneCorners[0][1]);
			p.lineTo(zoneCorners[1][0], zoneCorners[1][1]);
			p.lineTo(zoneCorners[2][0], zoneCorners[2][1]);
			p.lineTo(zoneCorners[3][0], zoneCorners[3][1]);
			p.closePath();
			territory.path = p;

			continue;
		}

		// Find the top-left coordinate
		let number_coords = Array.from(territory.zones);
		let x_coords = number_coords.map(coords => coords.x);
		let y_coords = number_coords.map(coords => coords.y);
		let min_x = Math.min.apply(null, x_coords);
		let min_y = Math.min.apply(null, y_coords);
		let start_coord;
		for (let y = min_y; !start_coord; y++) {
			if (territory.zones.has(new Point(min_x, y))) {
				start_coord = new Point(min_x, y);
				break;
			}
		}
		territory.topLeftZone = start_coord;

		// console.log(`territory ${territory.id} start coord is ${start_coord}`);

		let startCorners = getZoneCornersInCanvas(start_coord);

		// The left side of the zone forms the initial path
		let p = new Path2D();
		territory.path = p;
		p.moveTo(startCorners[3][0], startCorners[3][1]);
		p.lineTo(startCorners[0][0], startCorners[0][1]);
		// console.log(`p.moveTo(${startCorners[3][0]}, ${startCorners[3][1]});`);
		// console.log(`p.lineTo(${startCorners[0][0]}, ${startCorners[0][1]});`);

		let direction = 1;
		let curr_coord = start_coord;
		let curr_coord_in_territory = true;

		// Start by moving left
		let next_coord = new Point(start_coord.x + 1, start_coord.y);

		do {
			// console.log(`next coord is ${next_coord}`);
			if (territory.zones.has(next_coord)) {
				if (!curr_coord_in_territory) {
					// Going from outside in.

					// Look to the right of the new zone. If it's inside the territory, mark its BACK LEFT corner
					let left_zone;
					if (direction == 0) {
						left_zone = new Point(next_coord.x + 1, next_coord.y);
					} else if (direction == 1) {
						left_zone = new Point(next_coord.x, next_coord.y + 1);
					} else if (direction == 2) {
						left_zone = new Point(next_coord.x - 1, next_coord.y);
					} else if (direction == 3) {
						left_zone = new Point(next_coord.x, next_coord.y - 1);
					}
					if (territory.zones.has(left_zone)) {
						let corners = getZoneCornersInCanvas(left_zone);
						let corner = corners[(direction + 3) % 4];
						p.lineTo(corner[0], corner[1]);
						// console.log(`p.lineTo(${corner[0]}, ${corner[1]});`);
					}

					// Add the BACK RIGHT corner of the new zone to the path.
					let corners = getZoneCornersInCanvas(next_coord);
					let corner = corners[(direction + 2) % 4];
					p.lineTo(corner[0], corner[1]);
					// console.log(`p.lineTo(${corner[0]}, ${corner[1]});`);
				} else {
					// Staying inside.
					// Add the FRONT LEFT corner of the old zone to the path
					let corners = getZoneCornersInCanvas(curr_coord);
					let corner = corners[direction];
					p.lineTo(corner[0], corner[1]);
					// console.log(`p.lineTo(${corner[0]}, ${corner[1]});`);
				}

				curr_coord_in_territory = true;

				// Turn left
				direction = (direction + 3) % 4;
			} else {
				if (curr_coord_in_territory) {
					// Going from inside out.
					// Add the FRONT LEFT corner of the current zone to the path
					let corners = getZoneCornersInCanvas(curr_coord);
					let corner = corners[direction];
					p.lineTo(corner[0], corner[1]);
					// console.log(`p.lineTo(${corner[0]}, ${corner[1]});`);
				}

				curr_coord_in_territory = false;

				// Turn right
				direction = (direction + 1) % 4;
			}

			// Move to the next coordinate
			curr_coord = next_coord;
			if (direction == 0) {
				next_coord = new Point(curr_coord.x, curr_coord.y - 1);
			} else if (direction == 1) {
				next_coord = new Point(curr_coord.x + 1, curr_coord.y);
			} else if (direction == 2) {
				next_coord = new Point(curr_coord.x, curr_coord.y + 1);
			} else if (direction == 3) {
				next_coord = new Point(curr_coord.x - 1, curr_coord.y);
			}
		} while (!start_coord.equals(curr_coord));

		p.closePath();
	}
}

function panCanvas(timestamp) {
	if (Game.panStartTime == null) {
		Game.panStartTime = timestamp;
	}

	let t = timestamp - Game.panStartTime;

	Game.panX = Game.panStartX + Game.panSpeedX * t;
	Game.panY = Game.panStartY + Game.panSpeedY * t;

	if (Game.panSpeedX > 0 && Game.panX > 0 ||
	    Game.panSpeedX < 0 && Game.panX < 0 ||
	    Game.panSpeedY > 0 && Game.panY > 0 ||
	    Game.panSpeedY < 0 && Game.panY < 0) {
		Game.panX = 0;
		Game.panY = 0;
		Game.panStartX = 0;
		Game.panStartY = 0;
		Game.panStartTime = null;
		draw();
		return;
	}

	draw();
	window.requestAnimationFrame(panCanvas);
}

function draw() {

	hitRegions = {};

	ctx.clearRect(0, 0, canvas.width, canvas.height);
	hitCtx.clearRect(0, 0, canvas.width, canvas.height);

	ctx.save();
	hitCtx.save();

	ctx.translate(CANVAS_OFFSET, CANVAS_OFFSET);
	hitCtx.translate(CANVAS_OFFSET, CANVAS_OFFSET);

	ctx.translate(
		Math.floor((Game.panX - Game.originX) * (CARD_WIDTH + CARD_SPACING)),
		Math.floor((Game.panY - Game.originY) * (CARD_WIDTH + CARD_SPACING)),
	);

	// No need to take panning into account because input is disabled while panning
	hitCtx.translate(
		-Game.originX * (CARD_WIDTH + CARD_SPACING),
		-Game.originY * (CARD_WIDTH + CARD_SPACING)
	);

	// Draw placement positions
	if (Game.panX == 0 && Game.panY == 0 &&
	    (Game.state == GameState.PLACE_CARD || Game.state == GameState.ROTATE_CARD)) {
		for (let coord of Game.nextPositions) {

			if (coord.equals(Game.newCardPosition) && Game.state == GameState.ROTATE_CARD)
				continue;

			if (Game.state == GameState.PLACE_CARD) {
				ctx.strokeStyle = 'red';
			} else {
				ctx.strokeStyle = 'grey';
			}
			ctx.lineWidth = BORDER_WIDTH / 4;
			ctx.lineJoin = 'round';
			ctx.setLineDash([8, 4]);
			ctx.strokeRect(
				coord.x * (CARD_WIDTH + CARD_SPACING) + 5,
				coord.y * (CARD_WIDTH + CARD_SPACING) + 5,
				CARD_WIDTH - 10,
				CARD_WIDTH - 10
			);
			ctx.lineJoin = 'miter';

			if (Game.state == GameState.PLACE_CARD) {
				let hitRegionColor = getNewHitRegion(coord.toImmutable());
				hitCtx.fillStyle = hitRegionColor;
				hitCtx.lineWidth = BORDER_WIDTH / 4;
				hitCtx.fillRect(
					coord.x * (CARD_WIDTH + CARD_SPACING) + 5,
					coord.y * (CARD_WIDTH + CARD_SPACING) + 5,
					CARD_WIDTH - 10,
					CARD_WIDTH - 10
				);
			}
		}
	}

	ctx.setLineDash([]);

	// Draw cards

	for (let [coord, card_info] of Game.cards) {
		let x = coord.x * (CARD_WIDTH + CARD_SPACING);
		let y = coord.y * (CARD_WIDTH + CARD_SPACING);
		drawCard(
			ctx,
			card_info[0],
			card_info[1],
			x,
			y
		);
	}

	// Draw workers

	let worker_counts = {};
	for (let worker_pos of Game.workers) {
		let s = worker_pos.toImmutable();
		if (worker_counts[s]) {
			worker_counts[s] += 1;
		} else {
			worker_counts[s] = 1;
		}
	}

	for (let pos_str in worker_counts) {
		let count = worker_counts[pos_str];
		let pos = Point.fromImmutable(pos_str);
		let zoneOrigin = getZoneCornersInCanvas(pos)[0];
		ctx.drawImage(workerImage,
			zoneOrigin[0] + WORKER_X,
			zoneOrigin[1] + WORKER_Y,
			WORKER_WIDTH,
			WORKER_HEIGHT
		);
		if (count > 1) {
			ctx.font = (CARD_WIDTH * 0.1).toString() + 'px serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.shadowColor = 'grey';
			ctx.shadowBlur = 10;
			ctx.fillStyle = 'white';
			let center = Math.floor(ZONE_WIDTH / 2);
			ctx.fillText(
				count,
				zoneOrigin[0] + center,
				zoneOrigin[1] + center);
		}

		// Draw worker outlines
		if (Game.state == GameState.PLACE_OR_MOVE_WORKER) {
			ctx.strokeStyle = 'red';
			ctx.lineWidth = 4;
			ctx.lineJoin = 'round';
			ctx.setLineDash([8, 4]);
			ctx.strokeRect(
				zoneOrigin[0] + WORKER_OUTLINE_ORIGIN - 4,
				zoneOrigin[1] + WORKER_OUTLINE_ORIGIN - 4,
				WORKER_OUTLINE_SIDE + 8,
				WORKER_OUTLINE_SIDE + 8
			);
			ctx.lineJoin = 'miter';

			let hitRegionColor = getNewHitRegion(pos_str);
			hitCtx.fillStyle = hitRegionColor;
			hitCtx.lineWidth = 4;
			hitCtx.fillRect(
				zoneOrigin[0] + WORKER_OUTLINE_ORIGIN - 4,
				zoneOrigin[1] + WORKER_OUTLINE_ORIGIN - 4,
				WORKER_OUTLINE_SIDE + 8,
				WORKER_OUTLINE_SIDE + 8
			);
		}

	}
	ctx.shadowBlur = 0;


	// Draw newly-placed card

	if (Game.state == GameState.ROTATE_CARD) {
		let coord = Game.newCardPosition;
		let x = coord.x * (CARD_WIDTH + CARD_SPACING);
		let y = coord.y * (CARD_WIDTH + CARD_SPACING);
		drawCard(
			ctx,
			Game.newCard,
			Game.newCardRotation,
			x,
			y
		);

		// Draw UI elements

		ctx.save();
		hitCtx.save();

		ctx.translate(x, y);
		hitCtx.translate(x, y);

		if (Game.state == GameState.ROTATE_CARD) {
			// TODO: Replace unicode with images for better compatibility. Make sure images
			// don't hide background elements (huts)
			drawButton('confirm', CARD_WIDTH / 2, CARD_WIDTH + BUTTON_RADIUS - 3, '✓');
			drawButton('cancel', CARD_WIDTH + 10, 0, '✗');
			drawButton('rotate_right', -10, CARD_WIDTH / 2 - BUTTON_RADIUS - 10, '⟳');
			drawButton('rotate_left', -10, CARD_WIDTH / 2 + BUTTON_RADIUS + 10, '⟲');
		}

		hitCtx.restore();
		ctx.restore();
	}

	// Draw territories

	ctx.save()

	// TODO: Use scale to make the territory outlines smaller

	ctx.lineWidth = 4;
	ctx.lineJoin = 'round';
	ctx.strokeStyle = 'red';
	ctx.setLineDash([8, 4]);

	for (let terId of Game.targetTerritories) {
		let territory = Game.territories[terId];
		if (!territory.path)
			continue;
		let coords = Array.from(territory.zones).join('  ');
		ctx.stroke(territory.path);

		let hitRegionColor = getNewHitRegion(terId.toString());
		hitCtx.fillStyle = hitRegionColor;
		hitCtx.lineWidth = 4;
		hitCtx.fill(territory.path);
	}

	ctx.restore();

	hitCtx.restore();
	ctx.restore();
}

function drawCard(ctx, num, rot, x, y) {

	ctx.save();

	if (rot == 0) {
		ctx.translate(x, y);
	} else if (rot == 1) {
		ctx.translate(x + CARD_WIDTH, y);
		ctx.rotate(Math.PI * 0.5);
	} else if (rot == 2) {
		ctx.translate(x + CARD_WIDTH, y + CARD_WIDTH);
		ctx.rotate(Math.PI);
	} else if (rot == 3) {
		ctx.translate(x, y + CARD_WIDTH);
		ctx.rotate(Math.PI * 1.5);
	}

	// Draw border
	ctx.strokeStyle = BORDER_COLOR;
	ctx.lineJoin = 'round';
	ctx.lineWidth = BORDER_WIDTH;
	ctx.strokeRect(BORDER_WIDTH / 2, BORDER_WIDTH / 2, CARD_WIDTH - BORDER_WIDTH, CARD_WIDTH - BORDER_WIDTH);
	ctx.lineJoin = 'miter';

	// Horizontal divider
	ctx.lineWidth = INNER_BORDER_WIDTH;
	ctx.beginPath();
	ctx.moveTo(
		BORDER_WIDTH / 2,
		CARD_WIDTH / 2
	);
	ctx.lineTo(
		CARD_WIDTH - BORDER_WIDTH / 2,
		CARD_WIDTH / 2
	);

	// Vertical divider
	ctx.moveTo(
		CARD_WIDTH / 2,
		BORDER_WIDTH / 2
	);
	ctx.lineTo(
		CARD_WIDTH / 2,
		CARD_WIDTH - BORDER_WIDTH / 2
	);
	ctx.stroke();

	let card_info = CARDS[num];

	for (let i = 0; i < 4; i++) {
		drawZone(ctx, card_info[i], i);
	}

	// Draw card number

	let circle_x = CARD_WIDTH / 2;
	let circle_y = CARD_WIDTH / 2;

	drawCircle(ctx, circle_x, circle_y, CARD_WIDTH * 0.1, BORDER_COLOR);
	drawCircle(ctx, circle_x, circle_y, CARD_WIDTH * 0.09, 'white');

	ctx.font = (CARD_WIDTH * 0.1).toString() + 'px serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillStyle = 'black';
	let card_str = num.toString();
	if (num == 6 || num == 9) {
		card_str += '.';
	}
	ctx.fillText(card_str, circle_x, circle_y);

	ctx.restore();
}

function drawButton(name, x, y, text) {
	drawCircle(ctx, x, y, BUTTON_RADIUS, 'rgba(0,0,0,0.4)');
	drawCircle(ctx, x, y, BUTTON_RADIUS * 0.9, 'rgba(255,255,255,0.4)');

	let hitRegionColor = getNewHitRegion(name);
	drawCircle(hitCtx, x, y, BUTTON_RADIUS, hitRegionColor);

	if (text) {
		ctx.font = BUTTON_RADIUS.toString() + 'px serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = 'black';
		ctx.fillText(text, x, y);
	}
}

function drawCircle(ctx, x, y, radius, color) {
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, 2 * Math.PI);
	ctx.fill();
}

function drawZone(ctx, zone_info, quad) {
	let [zone_x, zone_y] = ZONE_ORIGINS[quad];

	ctx.fillStyle = COLORS[zone_info[0]];
	ctx.fillRect(zone_x, zone_y, ZONE_WIDTH, ZONE_WIDTH);

	// Draw huts
	if (zone_info.length == 1)
		return;

	ctx.save();

	ctx.translate(zone_x, zone_y);

	let center = Math.round(ZONE_WIDTH / 2);
	ctx.lineWidth = 1;
	ctx.strokeStyle = 'black';
	ctx.fillStyle = HUT_COLOR;

	let x, y;

	// North
	if (zone_info[1]) {
		x = center - HUT_WIDTH / 2;
		y = INNER_BORDER_WIDTH;
		ctx.fillRect(x, y, HUT_WIDTH, HUT_WIDTH);
		ctx.strokeRect(x + 0.5, y + 0.5, HUT_WIDTH - 1, HUT_WIDTH - 1);
	}

	// East
	if (zone_info[2]) {
		x = ZONE_WIDTH - INNER_BORDER_WIDTH - HUT_WIDTH;
		y = center - HUT_WIDTH / 2;
		ctx.fillRect(x, y, HUT_WIDTH, HUT_WIDTH);
		ctx.strokeRect(x + 0.5, y + 0.5, HUT_WIDTH - 1, HUT_WIDTH - 1);
	}

	// South
	if (zone_info[3]) {
		x = center - HUT_WIDTH / 2;
		y = ZONE_WIDTH - INNER_BORDER_WIDTH - HUT_WIDTH;
		ctx.fillRect(x, y, HUT_WIDTH, HUT_WIDTH);
		ctx.strokeRect(x + 0.5, y + 0.5, HUT_WIDTH - 1, HUT_WIDTH - 1);
	}

	// West
	if (zone_info[4]) {
		x = INNER_BORDER_WIDTH;
		y = center - HUT_WIDTH / 2;
		ctx.fillRect(x, y, HUT_WIDTH, HUT_WIDTH);
		ctx.strokeRect(x + 0.5, y + 0.5, HUT_WIDTH - 1, HUT_WIDTH - 1);
	}

	ctx.restore();
}

function clearHTMLButtons() {
	let elem = document.getElementById('buttons');
	while (elem.firstChild) {
		elem.removeChild(elem.firstChild);
	}
	let supplyButton = document.getElementById('supply_button');
	supplyButton.classList.remove('highlight');
	supplyButton.onclick = null;
}

function addHTMLButton(name, label) {
	let container = document.getElementById('buttons');
	let li = document.createElement('li');
	let button = document.createElement('button');
	button.type = 'button';
	button.textContent = label;
	button.onclick = () => { actionHandler(name); };
	li.appendChild(button);
	container.appendChild(li);
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

let ROTATION_ORDER = {
	0: [0, 1, 2, 3],
	1: [3, 0, 1, 2],
	2: [2, 3, 0, 1],
	3: [1, 2, 3, 0],
}

let COLORS = {
	'Y': '#eab529',
	'W': '#094b99',
	'F': '#79a029',
	'T': '#989993',
}

let CARDS = {
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
