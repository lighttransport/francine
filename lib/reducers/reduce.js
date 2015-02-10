'use strict';

var Q = require('q');
var fs = require('fs');
var request = require('request');
var blend = require('blend');

var _retrieve = function (source) {
    var d = Q.defer();

    var uri = 'http://' + source.worker.host + ':' + source.worker.resourcePort + '/results/' + source.taskName;

    request({
        uri: uri,
        encoding: null
    }, function (error, response, body) {
        if (error) {
            d.reject(error);
        } else {
            d.resolve(body);
        }
    });

    return d.promise;
};

var _reduce = function (images) {
    var d = Q.defer();

    blend(images, function (error, result) {
        if (error) {
            d.reject(error);
        } else {
            d.resolve(result);
        }
    });

    return d.promise;
};

var _save = function (task, worker) {
    return function (result) {
        var d = Q.defer();
        fs.writeFile(worker.getTemporaryDirectory() + '/results/' + task.name, result, function (error) {
            if (error) {
                d.reject(error);
            } else {
                d.resolve();
            }
        });
        return d.promise;
    };
};

module.exports = function (task, worker) {
    var sources = task.execution.tasks;

    worker.log('reduce', 'Reducing tasks of [' + sources.map(function (source) { return source.taskName; }).join(',') + ']');

    return Q.all(sources.map(_retrieve))
    .then(_reduce)
    .then(_save(task, worker));
};
