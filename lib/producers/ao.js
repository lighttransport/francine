'use strict';

var Q = require('q');
var spawn = require('child_process').spawn;

var AoProducer = function (worker) {
    var self = this;
    self.worker = worker;
};

AoProducer.prototype.produce = function (task) {
    var self = this;
    var d = Q.defer();

    var output = self.worker.getTemporaryDirectory() + '/results/' + task.name;

    var spawned = spawn(__dirname + '/../../ao', [output, task.seed.toString()]);
    spawned.stdout.on('data', function (data) {
        self.worker.log('AoProducer', data.toString('utf-8'));
    });
    spawned.stderr.on('data', function (data) {
        self.worker.log('AoProducer', data.toString('utf-8'));
    });
    spawned.on('close', function (code) {
        if (code !== 0) {
            self.worker.log('AoProducer', 'Returned with non-zero code: ' + code);
            d.reject('Returned with non-zero code: ' + code);
            return;
        }

        d.resolve();
    });

    return d.promise;
};

AoProducer.prototype.deleteCache = function (sessionName) {
    // Nothing to do.
    return sessionName;
};

module.exports = AoProducer;
