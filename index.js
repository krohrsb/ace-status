'use strict';
const request = require('request-promise');
const memoizee = require('memoizee');
const IFTT_KEY = process.env.IFTT_KEY;
const IFTT_EVENT = process.env.IFTT_EVENT;
const STOP_NAME = process.env.STOP_NAME;
class ACE {
    constructor(options) {
        this.baseUrl = 'https://www.acerail.com/CMSWebParts/ACERail/TrainStatusService.aspx';
        this.serviceCache = memoizee(this._getService, {
            promise: true,
            maxAge: 3000
        });
    }
    stops() {
        return this.getService('get_stops');
    }

    vehicles() {
        return this.getService('get_vehicles');
    }
    getService(service) {
        return this.serviceCache(service);
    }
    _getService(service) {
        return request({
            uri: `${this.baseUrl}?service=${service}`,
            json: true
        }).then((data) => {
            return data[service];
        });
    }
    
    getTrainsTime (stopName) {
        return this.getTrains().then((trains) => {
            return trains.map((train) => {
                let stop = train.minutesToNextStops.find((stopTime) => stopTime.name === stopName);
                if (stop) {
                     return {
                        inService: train.inService,
                        stop: stop,
                        onSchedule: train.onSchedule,
                        scheduledTime: stop.schedule,
                        train: train.scheduleNumber,
                        status: `[${train.scheduleNumber} to ${stopName}. ETA: ${(stop.status === 'On Time' ? stop.schedule : stop.status)}]`
                    };
                    
                } else {
                    return {};
                }
               
            }).filter((item) => Object.keys(item).length);
        });
    }

    getTrains() {
        return this.vehicles().then((vehicles) => {
            return this.stops().then((stops) => {
                stops = stops.reduce((map, stop) => {
                    map[stop.id] = stop;
                    return map;
                }, {});
                return vehicles.map((vehicle) => {
                    vehicle.minutesToNextStops = vehicle.minutesToNextStops.map((stop) => {
                        stop.name = stops[stop.stopID].name;
                        return stop;
                    });
                    return vehicle;
                });
            });
        });
    }
    sendStatus (status) {
        console.log('Sending status: ', status);
        return request({
            uri: `https://maker.ifttt.com/trigger/${IFTT_EVENT}/with/key/${IFTT_KEY}`,
            method: 'POST',
            json: true,
            body: {
                value1: status
            }
        });
    }
    sendLocationStatus (location) {
        var ace = this;
        return this.getTrainsTime(location).then((data) => {
            return data.map((status) => {
                return status.status;
            });
        }).then((data) => {
            return ace.sendStatus(data.join(', '));
        });
    }

}

let ace = new ACE();

ace.sendLocationStatus(STOP_NAME).then((data) => {
    console.log('Sent status for: ' + STOP_NAME);
});