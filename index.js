'use strict';
const request = require('request-promise');
const memoizee = require('memoizee');
const ACTION = process.argv[2];

class Train {
    
    constructor(options) {
        this.id = options.equipmentID;
        this.geo = {
            lat: options.lat,
            lng: options.lng
        };
        this.delayedMinutes = options.onSchedule;
        this.scheduleNumber = options.scheduleNumber;
        this.inService = !!options.inService;
        this.stops = options.stops;
        this.nextStopID = options.nextStopID;
        this.minutesToNextStops = options.minutesToNextStops;

    }
    _getStopById(id) {
        return this.stops.find((stop) => stop.id === id);
    }
    _getMinutesToNextStopById(id) {
        return this.minutesToNextStops.find((stop) => stop.stopID.toString() === id.toString());
    }
    get time() {
        return `${(this.delayedMinutes < 0) ? Math.abs(this.delayedMinutes) + ' min late' : 'On Time'}`;
    }
    get nextStop() {
        let next = this._getStopById(this.nextStopID);
        let time = this._getMinutesToNextStopById(this.nextStopID);
        return `Next stop: ${next ? next.name : 'unknown'}. ETA: ${time ? time.status : 'unknown'}`;
    }
    get status() {
        return `Train ${this.scheduleNumber} is ${this.time}. ${this.nextStop}.`;
    }
    
}

class Stop {
    constructor(options) {
        this.routeID = options.rid;
        this.id = options.id;
        this.name = options.name;
        this.geo = {
            lat: options.lat,
            lng: options.lng
        };
        this.shortName = options.shortName;
        // minutsToNextStops?
    }
}

/**
 * Altimont Corridor Express Status
 * 
 * @class ACE
 */
class ACE {
    /**
     * Creates an instance of ACE.
     * @param {object} options Options object 
     * 
     * @memberOf ACE
     */
    constructor(options) {
        this.ifttKey = options.ifttKey,
        this.ifttEvent = options.ifttEvent;
        this._serviceCache = memoizee(this._getService, {
            promise: true,
            maxAge: 3000
        });
        this.useSeed = options.useSeed || false;
        this.seed = options.seed || {};
    }
    /**
     * Retrieves the baseURL of the API service.
     * 
     * @readonly
     * @returns {string} API Url
     * @memberOf ACE
     */
    get _baseUrl() {
        return 'https://www.acerail.com/CMSWebParts/ACERail/TrainStatusService.aspx';
    }
    /**
     * Query the ACE service.
     * 
     * @param {string} service The sub-service to query ['get_vehicles', 'get_stops']
     * @returns Promise
     * 
     * @memberOf ACE
     */
    _getService(service) {
        if (this.useSeed) {
            return new Promise((resolve) => {
                resolve(this.seed[service]);
            });
        } else {
            return request({
                uri: `${this._baseUrl}?service=${service}`,
                json: true
            }).then((data) => {
                return data[service];
            });
        }

    }
    /**
     * Retrieves a list of Trains.
     * 
     * @param {Boolean} inServiceOnly Only get in service trains
     * @returns Promise.<Train[]>
     * 
     * @memberOf ACE
     */
    getTrains(inServiceOnly) {
        return this.getStops().then((stops) => {
            return this._serviceCache('get_vehicles').then((trains) => {
                if (inServiceOnly) {
                    trains = trains.filter((train) => train.inService);
                }
                return trains.map((train) => {
                    train.stops = stops;
                    return new Train(train);
                });
            });
        });
        
    }
    getStops() {
        return this._serviceCache('get_stops').then((stops) => {
            return stops.map((stop) => new Stop(stop));
        });
    }
    _postIFTT(data) {
        if (!this.ifttEvent && !this.ifttKey) {
            throw new Error('IFTT Event & Key not provided');
        }
        console.log(data);
        return request({
            uri: `https://maker.ifttt.com/trigger/${this.ifttEvent}/with/key/${this.ifttKey}`,
            method: 'POST',
            json: true,
            body: {
                value1: data
            }
        });
    }
    getStatus() {
        return this.getTrains(true).then((trains) => {
            return trains.map((train) => train.status).join('\n');
        });
    }
    sendStatus() {
        return this.getStatus().then((data) => {
            if (data && data.length) {
                return this._postIFTT(data);
            } else {
                return Promise.resolve(false);
            }
        });
    }
}

let ace = new ACE({
    ifttKey: process.env.IFTT_KEY,
    ifttEvent: process.env.IFTT_EVENT,
    seed: {
        get_vehicles: require('./seed_data/vehicles.json'),
        get_stops: require('./seed_data/stops.json')
    },
    useSeed: false
});
if (ACTION === 'status') {
    ace.getStatus().then((data) => {
        if (data && data.length) {
            console.log(data.join('\n'));
        } else {
            console.log('No trains running');
        }
    });
} else {
    ace.sendStatus()
        .then((sent) => {
            if (sent === false) {
                console.log('No trains running. Status not sent.');
            } else {
                console.log('Status Sent Successfully');
            }
        })
        .catch((err) => {
            console.error(err.toString());
        });
}