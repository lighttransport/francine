'use strict';

var Q = require('q');
var fork = require('child_process').fork;

var LocalInstance = function (master) {
    var self = this;

    self.master = master;
    self.workers = {};
    self.currentPort = 5001;
    self.currentResourcePort = 9000;
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

    d.resolve(workerName);
    return d.promise;
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
        workers: self.workers
    });

    return d.promise;
};

module.exports = LocalInstance;
