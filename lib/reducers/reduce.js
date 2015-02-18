'use strict';

var Q = require('q');
var fs = require('fs');
var request = require('request');
var PNG = require('pngjs').PNG;

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

var _decode = function (image) {
    var d = Q.defer();
    new PNG().parse(image, function (error, png) {
        if (error) {
            d.reject(error);
        } else {
            d.resolve(png);
        }
    });
    return d.promise;
};

var _reduce = function (images) {
    var d = Q.defer();

    Q.all(images.map(function (image) { return _decode(image); }))
    .then(function (decodeds) {
        var i;
        var length = decodeds[0].data.length;
        var weight = decodeds.length;

        var blended = new Array(length);
        for (i = 0; i < length; i++) {
            blended[i] = 0;
        }
        
        decodeds.map(function (decoded) {
            for (var i = 0; i < length; i++) {
                blended[i] += decoded.data[i];
            }
        });

        for (i = 0; i < length; i++) {
            blended[i] = (blended[i] / weight) | 0;
        }

        var png = decodeds[0];
        png.data = new Buffer(blended);
        d.resolve(png);
    });

    return d.promise;
};

var _save = function (task, worker) {
    return function (result) {
        var d = Q.defer();
        var stream = fs.createWriteStream(worker.getTemporaryDirectory() + '/results/' + task.name);
        stream.on('finish', function () {
            d.resolve();
        });
        stream.on('error', function (error) {
            d.reject(error);
        });

        result.pack();
        result.pipe(stream);

        return d.promise;
    };
};

module.exports = function (task, worker) {
    var sources = task.execution.tasks;

    // worker.log('reduce', 'Reducing tasks of [' + sources.map(function (source) { return source.taskName; }).join(',') + ']');

    return Q.all(sources.map(_retrieve))
    .then(_reduce)
    .then(_save(task, worker));
};
