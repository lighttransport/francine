'use strict';

var fork = require('child_process').fork;
var jsonrpc = require('multitransport-jsonrpc');

var JsonRpcClient = jsonrpc.client;
var JsonRpcClientTcp = jsonrpc.transports.client.tcp;

var LocalInstance = function () {
    var self = this;

    self.workers = {};
    self.currentPort = 5001;
};

LocalInstance.prototype.spawn = function (done) {
    var self = this;

    fork('lib/main', ['--mode=worker', '--port=' + self.currentPort], {});

    var workerName = 'worker' + self.currentPort;

    self.workers[workerName] = {
        name: workerName,
        host: 'localhost',
        port: self.currentPort
    };

    self.currentPort++;

    done();
};

LocalInstance.prototype.destroy = function (workerName, done) {
    var self = this;

    var worker = self.workers[workerName];

    delete self.workers[workerName];

    new JsonRpcClient(new JsonRpcClientTcp(worker.host, worker.port), {}, function (client) {
        client.stop();
        // Client will never return any value, so you can call done before waiting callback.
        done();
    });

};

LocalInstance.prototype.getWorkers = function () {
    var self = this;

    return self.workers;
};

module.exports = LocalInstance;
