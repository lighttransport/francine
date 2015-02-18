'use strict';

var Q = require('q');
var fork = require('child_process').fork;

var concatObject = require('../concat');

var LocalInstance = function (master) {
    var self = this;

    self.master = master;
    self.workers = {};
    self.currentPort = 5001;
    self.currentResourcePort = 9000;
};

LocalInstance.prototype._spawn = function () {
    var self = this;
    var d = Q.defer();

    var workerName = 'worker' + self.currentPort;

    var process = fork('lib/main',
            ['--mode=worker',
             '--port=' + self.currentPort,
             '--resourcePort=' + self.currentResourcePort,
             '--temporaryDirectory=/tmp/francine/' + workerName], {});

    self.workers[workerName] = {
        name: workerName,
        host: 'localhost',
        port: self.currentPort,
        resourcePort: self.currentResourcePort,
        process: process
    };

    self.currentPort++;
    self.currentResourcePort++;

    d.resolve(workerName);
    return d.promise;
};

LocalInstance.prototype.resize = function (size) {
    var self = this;

    var needed = size - Object.keys(self.workers).length;

    var q = Q(); // jshint ignore:line

    var spawning = function (remain) {
        return function () {
            self.master.log('LocalInstance', 'Spawn a new instance. Remaining: ' + remain);
            return self._spawn();
        };
    };

    for (var i = needed; i > 0; i--) {
        q = q.then(spawning(i));
    }

    return q;
};

LocalInstance.prototype.destroy = function (workerName) {
    var self = this;
    var d = Q.defer();

    var worker = self.workers[workerName];

    worker.process.kill();

    delete self.workers[workerName];

    d.resolve();
    return d.promise;
};

LocalInstance.prototype.getInstances = function () {
    var self = this;
    var d = Q.defer();

    d.resolve({
        master: {
            host: 'localhost',
            port: self.master.getPort()
        },
        workers: concatObject({}, self.workers)
    });

    return d.promise;
};

module.exports = LocalInstance;
