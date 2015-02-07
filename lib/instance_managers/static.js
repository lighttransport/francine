'use strict';

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
};

StaticInstanceManager.prototype.start = function () {
    var self = this;

    self.manage();
    self.pings();
};

StaticInstanceManager.prototype.manage = function () {
    var self = this;

    self.master.log('StaticInstanceManager', 'Managing instance...');

    (function loop (remain) {
        if (remain <= 0) {
            self.master.log('StaticInstanceManager', 'Instance spawn finished.');

            setTimeout(function () {
                self.manage();
            }, self.manageInterval);

            return;
        }

        self.master.log('StaticInstanceManager', 'Spawn a new instance. Remaining: ' + remain);

        self.instance.spawn(function () {
            loop(remain - 1);
        });
    })(self.number - Object.keys(self.instance.getWorkers()).length);
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

    setTimeout(function () {
        self.pings();
    }, self.pingInterval);
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
