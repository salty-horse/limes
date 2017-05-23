'use strict';

const CARD_WIDTH = 180;
const CARD_SPACING = 2;
const BORDER_WIDTH = 8;
const INNER_BORDER_WIDTH = 2;
const ZONE_WIDTH = CARD_WIDTH / 2 - BORDER_WIDTH - INNER_BORDER_WIDTH / 2;
const BORDER_COLOR = '#547062';
const HUT_COLOR = '#5182ad';
const HUT_WIDTH = Math.round(ZONE_WIDTH / 4);
const CANVAS_MARGIN = 10;
const PANNING_DURATION_MILLIS = 200;
const ROTATION_DURATION_MILLIS = 150;
const PATH_MARGIN = BORDER_WIDTH / 2;
var BUTTON_RADIUS; // Set by resizeWindow


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

let hammertime;

let workerImage;
let WORKER_WIDTH;
let WORKER_HEIGHT;
let WORKER_OUTLINE_SIDE;
let WORKER_OUTLINE_ORIGIN;
let WORKER_X;
let WORKER_Y;


let alphabet = '3467890BCDFGHJKMPQRTVWXYbcdfghjkmpqrtvwxy';
function getRandomString() {
	let chars = [];
	for (let i = 0; i < 6; i++) {
		chars.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
	}
	return chars.join('');
}

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
			for (let [neighbor, ] of getNeighbors(card, /* diagonals= */Game.variantDiagonals)) {
				if (this.cards.has(neighbor))
					continue;

				if (this.sizeX == 4 && (neighbor.x < this.minX || neighbor.x >= this.minX + this.sizeX))
					continue;

				if (this.sizeY == 4 && (neighbor.y < this.minY || neighbor.y >= this.minY + this.sizeY))
					continue;

				this.nextPositions.push(neighbor);
			}
		}

		let oldX = this.futureMinX;
		let oldY = this.futureMinY;

		// Calculate new grid origin
		if (this.sizeX < 4) {
			this.futureMinX = this.minX - 1;
			Game.futureSizeX = Game.sizeX + 2;
		} else {
			this.futureMinX = this.minX;
			Game.futureSizeX = 4;
		}

		if (this.sizeY < 4) {
			this.futureMinY = this.minY - 1;
			Game.futureSizeY = Game.sizeY + 2;
		} else {
			this.futureMinY = this.minY;
			Game.futureSizeY = 4;
		}
	},

	newGame: function(seed) {
		this.state = GameState.PLACE_OR_MOVE_WORKER;

		// Card grid minimum and size values, not accounting for future placements
		this.minX = 0;
		this.minY = 0;
		this.sizeX = 0;
		this.sizeY = 0;

		// Card grid minimum and size values, accounting for future placements
		this.futureMinX = -1;
		this.futureMinY = -1;
		this.futureSizeX = 3;
		this.futureSizeY = 3;

		this.panX = 0;
		this.panY = 0;
		this.scale = 1;
		this.zoomIncludeFuture = true;
		resizeWindow();

		// Panning animation
		this.animPanX = 0;
		this.animPanY = 0;
		this.animStartPanX = 0;
		this.animStartPanY = 0;
		this.animStartTime = null;

		this.animScale = 0;
		this.scaleStartX = 0;
		this.scaleStartTime = null;

		// Card rotation animation
		this.rotateOffset = 0;
		this.rotateStartTime = null;
		this.rotationDir = null;

		this.newCard = null;
		this.newCardPosition = new Point(0, 0);
		this.newCardInfo = null;

		this.workerSupply = 7;

		this.score = 0;
		this.tempScore = 0;

		this.territories = null;
		this.zoneGrid = null;
		this.zoneTerritories = null;

		// Zones the workers are on
		this.workers = [];

		this.selectedTerritory = null;
		this.selectedWorker = null;

		// Variants
		this.variantDiagonals = document.getElementById('variant_diagonals').checked;
		this.variantFerrymen = document.getElementById('variant_ferrymen').checked;
		this.variantProfis = document.getElementById('variant_profis').checked;

		this.sharedLink = Boolean(seed);
		if (!seed) {
			seed = getRandomString();
		}

		let variantsCode = [];
		let variantsDesc = [];
		if (this.variantDiagonals) {
			variantsCode.push('D');
			variantsDesc.push('Diagonals');
		}
		if (this.variantFerrymen) {
			variantsCode.push('F');
			variantsDesc.push('Ferrymen');
		}
		if (this.variantProfis) {
			variantsCode.push('P');
			variantsDesc.push('Profis');
		}


		this.cardDeck = Object.keys(CARDS);
		this.cardRNG = new Math.seedrandom(seed);

		if (variantsCode.length > 0) {
			seed = seed + '_' + variantsCode.join('');
		}

		this.cards = new PointMap();
		this.nextPositions = [];

		this.targetTerritories = new Set();

		document.getElementById('game_id').textContent = seed;
		document.getElementById('variants').textContent = variantsDesc.join(', ');
		document.getElementById('share_link').value =
			[location.protocol, '//', location.host, location.pathname, '?' + seed].join('');


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
		// this.futureMinX = 0;
		// this.futureMinY = 0;
		// this.sizeX = 6;
		// this.sizeY = 4;
		// this.minX = 0;
		// this.minY = 0;
		// this.futureSizeX = 6;
		// this.futureSizeY = 4;
		// canvas.width = (CARD_WIDTH + CARD_SPACING) * this.futureSizeX + CANVAS_MARGIN * 2 + 10;
		// canvas.height = (CARD_WIDTH + CARD_SPACING) * this.futureSizeY + CANVAS_MARGIN * 2 + 10;
		// for (let k in allCards) {
		// 	Game.addCard(Point.fromImmutable(k), allCards[k]);
		// }

		// Draw new card
		let ix = Math.floor(this.cardRNG() * this.cardDeck.length);
		this.addCard(new Point(0, 0), [this.cardDeck[ix], 0]);
		this.cardDeck.splice(ix, 1);
		this.updateUI();
		this.updateScore();

		parseMap();
		draw();
	},

	// Updates HTML
	updateUI: function() {
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

					// Update score since we can't undo
					this.score = this.tempScore;
				}
			}
			this.zoomIncludeFuture = true;
			panAndZoomToFit();
			instruction_label.textContent = 'Place the card';
			clearHTMLButtons();

		} else if (this.state == GameState.ROTATE_CARD) {
			addHTMLButton('cancel', 'Undo');
			addHTMLButton('confirm', 'Confirm');

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
				addHTMLButton('confirm', this.cards.size != 16 ? 'Draw next card' : 'End game');
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
				addHTMLButton('confirm', this.cards.size != 16 ? 'Draw next card' : 'End game');
			} else {
				instruction_label.textContent = 'Select a territory to move the worker to';

				// Mark adjacent territories as selectable
				let territory = Game.territories[Game.zoneTerritories.get(Game.selectedWorker)];
				for (let terId of territory.neighborTerritories) {
					this.targetTerritories.add(terId);

					if (this.variantFerrymen) {
						let neighborTer = this.territories[terId];
						// If this is a water territory and has a worker, it is considered a ferryman
						if (neighborTer.type == 'W' && neighborTer.hasWorkers()) {
							for (let terId2 of neighborTer.neighborTerritories) {
								if (terId2 != territory.id) {
									this.targetTerritories.add(terId2);
								}
							}
						}
					}
				}

				addHTMLButton('cancel', 'Undo worker movement');
			}
		}

		if (this.state == GameState.GAME_OVER) {
			instruction_label.textContent = 'Game over!';
			this.score = this.tempScore;
			this.zoomIncludeFuture = true;
			panAndZoomToFit();
			// TODO: Score summary


			// Analytics

			ga('send', {
			  hitType: 'event',
			  eventCategory: 'game',
			  eventAction: 'game_over',
			  eventValue: this.score
			});

			if (this.sharedLink) {
				ga('send', 'event', 'game', 'finished_shared_game');
			}
		}

		newCardCanvas.hidden = (this.state != GameState.PLACE_CARD);

		document.getElementById('supply').textContent = this.workerSupply;
	},

	calcScore: function() {
		let score = 0;

		// Get worker count for each territory
		let worker_counts = {};
		for (let worker_pos of Game.workers) {
			let terId = this.zoneTerritories.get(worker_pos);
			if (worker_counts[terId]) {
				worker_counts[terId] += 1;
			} else {
				worker_counts[terId] = 1;
			}
		}

		// Score territories with workers, not the workers themselves
		for (let terId in worker_counts) {
			let territory = this.territories[terId];

			// Field
			if (territory.type == 'Y') {
				score += territory.zones.size;

				if (this.variantProfis) {
					// Count worker in territory, and adjacent workers, including ferrymen adjacency
					// TODO: Do territories with multiple workers count more than once?

					// Count workers in own territory
					if (worker_counts[terId]) {
						score += worker_counts[terId];
					}

					for (let neighborTerId of territory.neighborTerritories) {
						// Make sure it has workers
						if (!worker_counts[neighborTerId])
							continue;

						score += worker_counts[neighborTerId];

						let neighborTer = this.territories[neighborTerId];
						if (neighborTer.type == 'W') {
							for (let neighbor2TerId of neighborTer.neighborTerritories) {
								if (neighbor2TerId == terId || !worker_counts[neighbor2TerId])
									continue;

								score += worker_counts[neighbor2TerId];
							}
						}
					}
				}

			// Water
			} else if (territory.type == 'W') {
				score += territory.huts;

				if (this.variantProfis) {
					// Count adjacent towers
					for (let terId of territory.neighborTerritories) {
						if (this.territories[terId].type == 'T') {
							score++;
						}
					}
				}

			// Forest
			} else if (territory.type == 'F') {
				score += territory.neighborTerritories.size;

				if (this.variantProfis) {
					// Count huts in forest
					for (let zonePos of territory.zones) {
						let zoneInfo = this.zoneGrid.get(zonePos);
						if (zoneInfo[1])
							score++;
						if (zoneInfo[2])
							score++;
						if (zoneInfo[3])
							score++;
						if (zoneInfo[4])
							score++;
					}
				}

			// Tower
			} else if (territory.type == 'T') {
				// Count forest zones in all four directions until the edge or a tower
				let pos = territory.zones.values().next().value;
				for (let dir = 0; dir < 4; dir++) {
					let p = new Point(pos.x, pos.y);

					while (true) {
						if (dir == 0)
							p.y--;
						else if (dir == 1)
							p.x++;
						else if (dir == 2)
							p.y++;
						else if (dir == 3)
							p.x--;

						let zone = this.zoneGrid.get(p);
						if (zone == undefined || zone[0] == 'T')
							break;

						if (zone[0] == 'F') {
							score++;

						// Count field zones
						} else if (this.variantProfis && zone[0] == 'Y') {
							score++;
						}
					}
				}
			}
		}

		this.tempScore = score;
	},

	// Update score HTML
	updateScore: function() {
		// Update HTML
		document.getElementById('score').textContent = this.score;
		let scoreDiff = this.tempScore - this.score;
		let diffElem = document.getElementById('new_points');
		if (scoreDiff == 0) {
			diffElem.textContent = '';
		} else {
			if (scoreDiff > 0) {
				diffElem.textContent = '+' + scoreDiff;
				diffElem.classList.add('positive');
				diffElem.classList.remove('negative');
			} else {
				diffElem.textContent = scoreDiff;
				diffElem.classList.add('negative');
				diffElem.classList.remove('positive');
			}
		}

	},
}

window.addEventListener('DOMContentLoaded', function() {
	canvas = document.getElementById('canvas');
	ctx = canvas.getContext('2d');

	// Handled in resizeWindow.
	// TODO: Fix so the canvas doesn't resize when the page loads since newGame and resizeWindow is called on 'load'
	// canvas.width = canvas.parentElement.clientWidth - 20;
	// canvas.height = canvas.parentElement.clientHeight - 20;

	hammertime = new Hammer(canvas);
	hammertime.get('pan').set({ direction: Hammer.DIRECTION_ALL });
	hammertime.get('pinch').set({ enable: true, direction: Hammer.DIRECTION_ALL });
	
	let dragStartPanX = null;
	let dragStartPanY = null;
	let pinchStartPanX = null;
	let pinchStartPanY = null;
	let pinchStartScale = null;

	hammertime.on('pan', function(e) {
		if (Game.animStartTime != null)
			return;
		if (dragStartPanX == null) {
			dragStartPanX = Game.panX;
			dragStartPanY = Game.panY;
		}
		document.body.style.cursor = 'grabbing';
		Game.panX = dragStartPanX + e.deltaX;
		Game.panY = dragStartPanY + e.deltaY;
		Game.preventClick = true;
		window.requestAnimationFrame(draw);
	});
	
	hammertime.on('panend', function(e) {
		document.body.style.cursor = 'default';
		dragStartPanX = null;
		dragStartPanY = null;
		setTimeout(() => { Game.preventClick = false; }, 100);
		window.requestAnimationFrame(draw);
	});

	hammertime.on('pinch', function(e) {
		if (Game.animStartTime != null)
			return;
		if (pinchStartScale == null) {
			pinchStartScale = Game.scale;
			pinchStartPanX = Game.panX;
			pinchStartPanY = Game.panY;
		}

		let scaleChange = e.scale - 1;

		// TODO: Add max scale limit
		if (pinchStartScale + scaleChange <= 0.1)
			return;

		Game.panX = pinchStartPanX - (e.center.x - pinchStartPanX) / pinchStartScale * scaleChange;
		Game.panY = pinchStartPanY - (e.center.y - pinchStartPanY) / pinchStartScale * scaleChange;
		Game.scale = pinchStartScale + scaleChange;
		Game.preventClick = true;
		window.requestAnimationFrame(draw);
	});

	hammertime.on('pinchend', function(e) {
		pinchStartScale = null;
		setTimeout(() => { Game.preventClick = false; }, 100);
		window.requestAnimationFrame(draw);
	});

	canvas.addEventListener('wheel', function(e) {
		if (Game.animStartTime != null)
			return;

		const rect = canvas.getBoundingClientRect();
		const zoomPointX = e.clientX - rect.left;
		const zoomPointY = e.clientY - rect.top;

		let scaleChange;
		if (e.deltaY < 0) {
			// zoom in
			scaleChange = 0.2;
		} else {
			// zoom out
			scaleChange = -0.2;
		}

		// TODO: Add max scale limit
		if (Game.scale + scaleChange <= 0.1) {
			return;
		}

		Game.panX -= (zoomPointX - Game.panX) / Game.scale * scaleChange;
		Game.panY -= (zoomPointY - Game.panY) / Game.scale * scaleChange;
		Game.scale += scaleChange;
		window.requestAnimationFrame(draw);
	});

	hitCanvas = document.createElement('canvas');
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

	// Enable buttons

	document.getElementById('copy_button').onclick = function() {
		document.getElementById('share_link').select();
		document.execCommand('copy');
	}

	let seed = undefined;
	if (location.search) {
		seed = location.search.substring(1);

		// Extract variants
		let variantsSuffix;
		[seed, variantsSuffix] = seed.split('_', 2);
		if (variantsSuffix) {
			if (variantsSuffix.indexOf('D') >= 0) {
				document.getElementById('variant_diagonals').checked = true;
			}
			if (variantsSuffix.indexOf('F') >= 0) {
				document.getElementById('variant_ferrymen').checked = true;
			}
			if (variantsSuffix.indexOf('P') >= 0) {
				document.getElementById('variant_profis').checked = true;
			}
		}
	}

	// Remove search query from URL
	let url = [location.protocol, '//', location.host, location.pathname].join('');
	if (location.search) {
		window.history.replaceState(null, '', url);
	}

	document.getElementById('menu_button').onclick = function() {
		let menu = document.getElementById('menu');
		menu.style.display = 'block';
		document.getElementById('menu_cover').style.display = 'block';
	}

	document.getElementById('menu_cancel').onclick = hideMenu;

	document.getElementById('new_game').onclick = function() {
		if (Game.state != GameState.GAME_OVER) {
			if (!window.confirm('Are you sure you wish to start a new game?')) {
				return;
			}
		}
		hideMenu();
		Game.newGame();
	}

	// Wait on 'load' since we use seedrandom
	window.addEventListener('load', function() {
		Game.newGame(seed);
	});
});

function hideMenu() {
	document.getElementById('menu').style.display = 'none';
	document.getElementById('menu_cover').style.display = 'none';
}

window.addEventListener('resize', resizeWindow);

function getScreenMeasurements() {
	let minX, minY, sizeX, sizeY;
	if (Game.zoomIncludeFuture) {
		minX = Game.futureMinX;
		minY = Game.futureMinY;
		sizeX = Game.futureSizeX;
		sizeY = Game.futureSizeY;
	} else {
		minX = Game.minX;
		minY = Game.minY;
		sizeX = Game.sizeX;
		sizeY = Game.sizeY;
	}

	// Don't zoom in more than a 3x3 grid
	let scaleSizeX = Math.max(sizeX, 3);
	let scaleSizeY = Math.max(sizeY, 3);

	let scaleWidth = (CARD_WIDTH + CARD_SPACING) * scaleSizeX - CARD_SPACING + CANVAS_MARGIN * 2;
	let scaleHeight = (CARD_WIDTH + CARD_SPACING) * scaleSizeY - CARD_SPACING + CANVAS_MARGIN * 2;
	let width = (CARD_WIDTH + CARD_SPACING) * sizeX - CARD_SPACING + CANVAS_MARGIN * 2;
	let height = (CARD_WIDTH + CARD_SPACING) * sizeY - CARD_SPACING + CANVAS_MARGIN * 2;
	let scaleX = canvas.width / scaleWidth;
	let scaleY = canvas.height / scaleHeight;
	let scale = Math.min(scaleX, scaleY);

	let panX = (canvas.width - width * scale) / 2 + CANVAS_MARGIN * scale;
	let panY = (canvas.height - height * scale) / 2 + CANVAS_MARGIN * scale;
	panX -= (CARD_WIDTH + CARD_SPACING) * minX * scale;
	panY -= (CARD_WIDTH + CARD_SPACING) * minY * scale;

	return {
		'minX': minX,
		'minY': minY,
		'sizeX': sizeX,
		'sizeY': sizeY,
		'width': width,
		'height': height,
		'scaleX': scaleX,
		'scaleY': scaleY,
		'scale': scale,
		'panX': panX,
		'panY': panY,
	}
}

function resizeWindow() {
	BUTTON_RADIUS = window.innerHeight / 10;

	canvas.width = canvas.parentElement.clientWidth;
	canvas.height = canvas.parentElement.clientHeight - 20;

	let m = getScreenMeasurements();

	Game.scale = m.scale;
	Game.panX = m.panX;
	Game.panY = m.panY;
	window.requestAnimationFrame(draw);
}

// Handles action caused by button presses (HTML buttons or canvas)
function actionHandler(action) {
	if (Game.preventClick)
		return;

	let mapChanged = true;
	let scoreChanged = true;

	if (Game.state == GameState.PLACE_CARD) {
		Game.newCardPosition = Point.fromImmutable(action);
		Game.state = GameState.ROTATE_CARD;
		Game.newCardInfo = [Game.newCard, 0];
		Game.addCard(Game.newCardPosition, Game.newCardInfo);
		Game.zoomIncludeFuture = false;
		panAndZoomToFit();

	} else if (Game.state == GameState.ROTATE_CARD) {
		if (action == 'confirm') {
			Game.state = GameState.PLACE_OR_MOVE_WORKER;
			mapChanged = false;
			scoreChanged = false;
		} else if (action == 'cancel') {
			Game.state = GameState.PLACE_CARD;
			Game.removeCard(Game.newCardPosition);
		} else if (action == 'rotate_left') {
			Game.newCardInfo[1] = (Game.newCardInfo[1] + 3) % 4;
			Game.rotationDir = 1;
			window.requestAnimationFrame(animateCardRotation);
		} else if (action == 'rotate_right') {
			Game.newCardInfo[1] = (Game.newCardInfo[1] + 1) % 4;
			Game.rotationDir = -1;
			window.requestAnimationFrame(animateCardRotation);
		}
	} else if (Game.state == GameState.PLACE_OR_MOVE_WORKER) {
		Game.selectedTerritory = null;

		if (action == 'place_worker') {
			Game.state = GameState.PLACE_WORKER;
			mapChanged = false;
			scoreChanged = false;
		} else if (action == 'skip') {
			Game.state = GameState.PLACE_CARD;
			Game.newCard = null;
			mapChanged = false;
			scoreChanged = false;
		} else if (action == 'go_back') {
			Game.state = GameState.PLACE_CARD;
			Game.removeCard(Game.newCardPosition);
		} else {
			// Chosen a worker to move
			Game.selectedWorker = Point.fromImmutable(action);
			Game.state = GameState.MOVE_WORKER;
			mapChanged = false;
			scoreChanged = false;
		}
	} else if (Game.state == GameState.PLACE_WORKER) {
		mapChanged = false;
		if (action == 'cancel') {
			if (Game.selectedTerritory) {
				Game.selectedTerritory = null;
				Game.workerSupply++;
				Game.workers.pop();
			} else {
				scoreChanged = false;
			}
			Game.targetTerritories.clear();
			Game.state = GameState.PLACE_OR_MOVE_WORKER;
		} else if (action == 'confirm') {
			Game.targetTerritories.clear();
			Game.selectedTerritory = null;
			Game.state = GameState.PLACE_CARD;
			Game.newCard = null;
			scoreChanged = false;
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
		mapChanged = false;
		if (action == 'cancel') {
			if (Game.selectedTerritory) {
				Game.selectedTerritory = null;
				Game.workers.pop();
				Game.workers.push(Game.selectedWorker);
			} else {
				scoreChanged = false;
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
			scoreChanged = false;
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

	Game.updateUI();

	if (mapChanged) {
		parseMap();
	}

	if (scoreChanged) {
		Game.calcScore();
	}

	Game.updateScore();

	// If there's any animation in progress, let it handle drawing
	if (Game.animPanX != 0 || Game.animPanY != 0 || Game.rotateOffset)
		return;

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
	Game.zoneGrid = zoneGrid;

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
}

function* getNeighbors(coords, diagonals = false) {
	yield [new Point(coords.x, coords.y - 1), 0];
	yield [new Point(coords.x + 1, coords.y), 1];
	yield [new Point(coords.x, coords.y + 1), 2];
	yield [new Point(coords.x - 1, coords.y), 3];

	if (diagonals) {
		yield [new Point(coords.x + 1, coords.y - 1), 0];
		yield [new Point(coords.x + 1, coords.y + 1), 0];
		yield [new Point(coords.x - 1, coords.y + 1), 0];
		yield [new Point(coords.x - 1, coords.y - 1), 0];
	}
}

class Territory {
	constructor(id, zone, type) {
		this.id = id;
		this.type = type;
		this.zones = new PointSet();
		this.zones.add(zone)
		this.neighbors = new PointSet();
		this.neighborTerritories = new Set();
		this.huts = 0;
		this._path = null;
		this._topLeftZone = null;
	}

	hasWorkers() {
		for (let worker_pos of Game.workers) {
			if (Game.zoneTerritories.get(worker_pos) == this.id) {
				return true;
			}
		}
		return false;
	}

	get topLeftZone() {
		if (this._topLeftZone)
			return this._topLeftZone;

		if (this.zones.size == 1) {
			this._topLeftZone = this.zones.values().next().value;
			return this._topLeftZone;
		}

		let number_coords = Array.from(this.zones);
		let x_coords = number_coords.map(coords => coords.x);
		let y_coords = number_coords.map(coords => coords.y);
		let min_x = Math.min.apply(null, x_coords);
		let min_y = Math.min.apply(null, y_coords);
		let start_coord;
		for (let y = min_y; !start_coord; y++) {
			if (this.zones.has(new Point(min_x, y))) {
				start_coord = new Point(min_x, y);
				break;
			}
		}
		this._topLeftZone = start_coord;
		return this._topLeftZone;
	}

	get path() {
		if (this._path)
			return this._path;

		// Size 1 territories are simple
		if (this.zones.size == 1) {
			let zoneCorners = getZoneCornersInCanvas(this.zones.values().next().value, PATH_MARGIN);
			let p = new Path2D();
			this._path = p;
			p.moveTo(zoneCorners[0][0], zoneCorners[0][1]);
			p.lineTo(zoneCorners[1][0], zoneCorners[1][1]);
			p.lineTo(zoneCorners[2][0], zoneCorners[2][1]);
			p.lineTo(zoneCorners[3][0], zoneCorners[3][1]);
			p.closePath();

			return p;
		}

		let start_coord = this.topLeftZone;

		let startCorners = getZoneCornersInCanvas(start_coord, PATH_MARGIN);

		// The left side of the zone forms the initial path
		let p = new Path2D();
		this._path = p;
		p.moveTo(startCorners[3][0], startCorners[3][1]);
		p.lineTo(startCorners[0][0], startCorners[0][1]);

		let direction = 1;
		let curr_coord = start_coord;
		let curr_coord_in_territory = true;

		// Start by moving left
		let next_coord = new Point(start_coord.x + 1, start_coord.y);

		do {
			if (this.zones.has(next_coord)) {
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
					if (this.zones.has(left_zone)) {
						let corners = getZoneCornersInCanvas(left_zone, PATH_MARGIN);
						let corner = corners[(direction + 3) % 4];
						p.lineTo(corner[0], corner[1]);
					}

					// Add the BACK RIGHT corner of the new zone to the path.
					let corners = getZoneCornersInCanvas(next_coord, PATH_MARGIN);
					let corner = corners[(direction + 2) % 4];
					p.lineTo(corner[0], corner[1]);
				} else {
					// Staying inside.
					// Add the FRONT LEFT corner of the old zone to the path
					let corners = getZoneCornersInCanvas(curr_coord, PATH_MARGIN);
					let corner = corners[direction];
					p.lineTo(corner[0], corner[1]);
				}

				curr_coord_in_territory = true;

				// Turn left
				direction = (direction + 3) % 4;
			} else {
				if (curr_coord_in_territory) {
					// Going from inside out.
					// Add the FRONT LEFT corner of the current zone to the path
					let corners = getZoneCornersInCanvas(curr_coord, PATH_MARGIN);
					let corner = corners[direction];
					p.lineTo(corner[0], corner[1]);
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

		return p;
	}
}

// Asssuming the card grid is drawn from 0,0,
// gets the positions of the 4 corners [NW, NE, SE, SW]
function getZoneCornersInCanvas(pos, margin = 0) {
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
		[canvasCardX + zoneOrigin[0] + margin, canvasCardY + zoneOrigin[1] + margin],
		[canvasCardX + zoneOrigin[0] + ZONE_WIDTH - margin, canvasCardY + zoneOrigin[1] + margin],
		[canvasCardX + zoneOrigin[0] + ZONE_WIDTH - margin, canvasCardY + zoneOrigin[1] + ZONE_WIDTH - margin],
		[canvasCardX + zoneOrigin[0] + margin, canvasCardY + zoneOrigin[1] + ZONE_WIDTH - margin],
	];
}

function panAndZoomToFit() {

	let m = getScreenMeasurements();

	if (m.scale != Game.scale || m.panX != Game.panX || m.panY != Game.panY) {
		Game.animSpeedScale = (m.scale - Game.scale) / PANNING_DURATION_MILLIS;
		Game.animScale = Game.animStartScale = Game.scale - m.scale;
		Game.scale = m.scale;

		Game.animSpeedPanX = (m.panX - Game.panX) / PANNING_DURATION_MILLIS;
		Game.animSpeedPanY = (m.panY - Game.panY) / PANNING_DURATION_MILLIS;
		Game.animPanX = Game.animStartPanX = Game.panX - m.panX;
		Game.animPanY = Game.animStartPanY = Game.panY - m.panY;
		Game.panX = m.panX;
		Game.panY = m.panY;
		window.requestAnimationFrame(animatePanAndZoom);
	}
}

function animatePanAndZoom(timestamp) {
	if (Game.animStartTime == null) {
		Game.animStartTime = timestamp;
	}

	let t = timestamp - Game.animStartTime;

	Game.animScale = Game.animStartScale + Game.animSpeedScale * t;
	Game.animPanX = Game.animStartPanX + Game.animSpeedPanX * t;
	Game.animPanY = Game.animStartPanY + Game.animSpeedPanY * t;

	if (Game.animSpeedScale > 0 && Game.animScale >= 0 ||
	    Game.animSpeedScale < 0 && Game.animScale <= 0 ||
	    Game.animSpeedPanX > 0 && Game.animPanX > 0 ||
	    Game.animSpeedPanX < 0 && Game.animPanX < 0 ||
	    Game.animSpeedPanY > 0 && Game.animPanY > 0 ||
	    Game.animSpeedPanY < 0 && Game.animPanY < 0) {
		
		Game.animScale = 0;
		Game.animPanX = 0;
		Game.animPanY = 0;
		Game.animStartTime = null;
		draw();
		return;
	}

	draw();
	window.requestAnimationFrame(animatePanAndZoom);
}

function animateCardRotation(timestamp) {
	if (Game.rotateStartTime == null) {
		Game.rotateStartTime = timestamp;
	}

	let t = timestamp - Game.rotateStartTime;

	// Rotate right: from -0.5 up to 0
	// Rotate left: from 0.5 down to 0

	Game.rotateOffset = 0.5 - (0.5 / ROTATION_DURATION_MILLIS) * t;

	if (Game.rotateOffset <= 0) {
	    Game.rotateOffset = 0;
		Game.rotateStartTime = null;

		draw();
		return;
	}

	Game.rotateOffset *= Game.rotationDir;

	draw();
	window.requestAnimationFrame(animateCardRotation);
}

function draw() {
	hitRegions = {};

	ctx.clearRect(0, 0, canvas.width, canvas.height);
	hitCanvas.width = canvas.width;
	hitCanvas.height = canvas.height;

	ctx.save();
	hitCtx.save();

	ctx.translate(Game.panX + Game.animPanX, Game.panY + Game.animPanY);
	ctx.scale(Game.scale + Game.animScale, Game.scale + Game.animScale);

	// No need to take animation into account because input is disabled while animating
	hitCtx.translate(Game.panX, Game.panY);
	hitCtx.scale(Game.scale, Game.scale);

	// The canvas's 0,0 is now the top left corner of the first card (pos 0,0)

	// Draw placement positions
	if (Game.state == GameState.PLACE_CARD || Game.state == GameState.ROTATE_CARD) {
		for (let coord of Game.nextPositions) {

			if ( Game.state == GameState.ROTATE_CARD && coord.equals(Game.newCardPosition))
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

			if (Game.state == GameState.PLACE_CARD && Game.animStartTime == null) {
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
		// Skip newly-placed card, which we draw later
		if (Game.state == GameState.ROTATE_CARD && coord.equals(Game.newCardPosition))
			continue;

		let x = coord.x * (CARD_WIDTH + CARD_SPACING);
		let y = coord.y * (CARD_WIDTH + CARD_SPACING);
		drawCard(
			ctx,
			card_info[0],
			card_info[1],
			x,
			y,
			/* rotateOffset= */0,
			/* highlight= */coord.equals(Game.newCardPosition)
		);
	}

	// Draw workers

	// Get worker count for each territory
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
			ctx.font = Math.floor(CARD_WIDTH * 0.1) + 'px serif';
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
			Game.newCardInfo[1],
			x,
			y,
			Game.rotateOffset,
			/* highlight= */true
		);
	}

	// Draw territories

	if (Game.targetTerritories.size > 0) {
		ctx.lineWidth = 4;
		ctx.lineJoin = 'round';
		ctx.strokeStyle = 'red';
		ctx.setLineDash([8, 4]);

		for (let terId of Game.targetTerritories) {
			let territory = Game.territories[terId];
			if (!territory.path)
				continue;
			ctx.stroke(territory.path);

			let hitRegionColor = getNewHitRegion(terId.toString());
			hitCtx.fillStyle = hitRegionColor;
			hitCtx.lineWidth = 4;
			hitCtx.fill(territory.path);
		}
	}

	hitCtx.restore();
	ctx.restore();

	// Draw rotation buttons on the left edge of the canvas

	if (Game.state == GameState.ROTATE_CARD && Game.rotateOffset == 0) {
		// (These arrow shapes are better, but are not supported in iOS: ⟳ ⟲)
		drawButton('rotate_right', BUTTON_RADIUS + 10, canvas.height / 3, '↷');
		drawButton('rotate_left', BUTTON_RADIUS + 10, canvas.height * 2 / 3, '↶');
	}
}

function drawCard(ctx, num, rot, x, y, rotateOffset, highlight) {

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

	if (rotateOffset !== undefined && rotateOffset != 0) {
		ctx.translate(CARD_WIDTH / 2, CARD_WIDTH / 2);
		ctx.rotate(Math.PI * rotateOffset);
		ctx.translate(-CARD_WIDTH / 2, -CARD_WIDTH / 2);
	}

	// Draw highlight
	if (highlight && Game.state == GameState.ROTATE_CARD) {
		ctx.strokeStyle = 'orange';
		ctx.lineWidth = 4;
		ctx.lineJoin = 'round';
		ctx.setLineDash([8, 4]);
		ctx.strokeRect(
			BORDER_WIDTH / 2 - 4,
			BORDER_WIDTH / 2 - 4,
			CARD_WIDTH - BORDER_WIDTH + 8,
			CARD_WIDTH - BORDER_WIDTH + 8
		);
		ctx.lineJoin = 'miter';
		ctx.setLineDash([]);
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

	ctx.font = Math.floor(CARD_WIDTH * 0.1).toString() + 'px serif';
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

	ctx.fillStyle = ZONE_COLORS[zone_info[0]];
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

let ZONE_COLORS = {
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
