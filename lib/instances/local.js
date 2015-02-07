'use strict';

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

GceInstance.prototype.start = function () {
    // Nothing to do.
    return;
};

LocalInstance.prototype.spawn = function (done) {
    var self = this;

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

    done();
};

LocalInstance.prototype.destroy = function (workerName, done) {
    var self = this;

    var worker = self.workers[workerName];

    worker.process.kill();

    delete self.workers[workerName];

    self._updateTimestamp();

    done();
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
