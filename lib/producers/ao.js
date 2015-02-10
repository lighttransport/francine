'use strict';

var Q = require('q');
var spawn = require('child_process').spawn;

var AoProducer = {};

AoProducer.produce = function (task, worker) {
    var d = Q.defer();

    var output = worker.getTemporaryDirectory() + '/results/' + task.name;

    var spawned = spawn(__dirname + '/../../ao', [output]);
    spawned.stdout.on('data', function (data) {
        worker.log('AoProducer', data);
    });
    spawned.stderr.on('data', function (data) {
        worker.log('AoProducer', data);
    });
    spawned.on('close', function (code) {
        if (code !== 0) {
            worker.log('AoProducer', 'Returned with non-zero code: ' + code);
            d.reject('Returned with non-zero code: ' + code);
            return;
        }

        d.resolve();
    });

    return d.promise;
};


module.exports = AoProducer;
