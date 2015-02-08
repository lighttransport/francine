'use strict';

var Q = require('q');
var jsonrpc = require('multitransport-jsonrpc');

var JsonRpcClient = jsonrpc.client;
var JsonRpcClientTcp = jsonrpc.transports.client.tcp;

var StaticInstanceManager = function (master, instance, number) {
    var self = this;

    self.master = master;
    self.instance = instance;
    self.number = number;
    self.manageInterval = 120 * 1000;
    self.pingInterval = 10 * 1000;
    self.spawnInterval = 15 * 1000;
};

StaticInstanceManager.prototype.start = function () {
    var self = this;

    Q().then(function loop () { // jshint ignore:line
        return self._manage().delay(self.manageInterval).then(loop);
    });
    setInterval(function () { self.pings(); }, self.pingInterval);
};

StaticInstanceManager.prototype._manage = function () {
    var self = this;
    var d = Q.defer();

    self.master.log('StaticInstanceManager', 'Managing instance...');

    var workers = self.instance.getWorkers();
    if (!workers) {
        self.master.log('StaticInstanceManager', 'Worker information not available.');
        setTimeout(d.resolve, 0);
        return d.promise;
    }

    var needed = self.number - Object.keys(workers).length;

    var q = Q(); // jshint ignore:line

    var spawning = function (remain) {
        return function () {
            self.master.log('StaticInstanceManager', 'Spawn a new instance. Remaining: ' + remain);
            return self.instance.spawn().delay(self.spawnInterval);
        };
    };

    for (var i = needed; i >= 0; i--) {
        q.then(spawning(i));
    }

    q.then(function () {
        self.master.log('StaticInstanceManager', 'Instance spawn finished.');
        d.resolve();
    });

    return d.promise;
};

StaticInstanceManager.prototype.pings = function () {
    var self = this;

    // self.master.log('StaticInstanceManager', 'Sending pings...');

    var workers = self.instance.getWorkers();
    for (var key in workers) {
        if (workers.hasOwnProperty(key)) {
            self.ping(workers[key]);
        }
    }
};

StaticInstanceManager.prototype.ping = function (worker) {
    var self = this;

    new JsonRpcClient(new JsonRpcClientTcp(worker.host, worker.port), {}, function (client) {
        client.ping({
            workerName: worker.name,
            master: self.instance.getMaster()
        }, function () {});
    });
};

module.exports = StaticInstanceManager;
