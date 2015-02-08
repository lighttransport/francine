'use strict';

var Q = require('q');
var fork = require('child_process').fork;

var LocalInstance = function (master) {
    var self = this;

    self.master = master;
    self.workers = {};
    self.currentPort = 5001;
    self.currentResourcePort = 9000;
    self._updateTimestamp();
};

LocalInstance.prototype.getTimestamp = function () {
    var self = this;
    return self.timestamp;
};

LocalInstance.prototype._updateTimestamp = function () {
    var self = this;
    self.timestamp = new Date().getTime() | 0;
};

LocalInstance.prototype.start = function () {
    // Nothing to do.
    return;
};

LocalInstance.prototype.spawn = function () {
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

    self._updateTimestamp();

    setTimeout(function () { d.resolve(workerName); }, 0);
    return d.promise;
};

LocalInstance.prototype.destroy = function (workerName) {
    var self = this;
    var d = Q.defer();

    var worker = self.workers[workerName];

    worker.process.kill();

    delete self.workers[workerName];

    self._updateTimestamp();

    setTimeout(d.resolve, 0);
    return d.promise;
};

LocalInstance.prototype.getWorkers = function () {
    var self = this;

    return self.workers;
};

LocalInstance.prototype.getMaster = function () {
    var self = this;

    return {
        host: 'localhost',
        port: self.master.getPort()
    };
};

module.exports = LocalInstance;
