'use strict';

var jsonrpc = require('multitransport-jsonrpc');
var JsonRpcServer = jsonrpc.server;
var JsonRpcServerTcp = jsonrpc.transports.server.tcp;

var LocalInstance = require('./instances/local');
var StaticInstanceManager = require('./instance_managers/static');
var QueueScheduler = require('./schedulers/queue');

var initializeRestApi = require('./apis/rest');

var Master = function (argv) {
    var self = this;

    self.restPort = argv.restPort || 3000;
    self.port = argv.port || 5000;
    self.instanceType = argv.instanceType || 'local';
    self.instanceManagerType = argv.instanceManagerType || 'static';
    self.schedulerType = argv.schedulerType || 'queue';

    self.instance = null;
    self.instanceManager = null;

    self.scheduler = null;

    self.rpcServer = null;

    self.app = null;
};

Master.prototype.start = function () {
    var self = this;

    // Initialize instance type specific object
    self.initializeInstance();

    // Initialize instance manager
    self.initializeInstanceManager();

    // Initialize scheduler
    self.initializeScheduler();

    // Initialize RPC
    self.initializeRpc();

    // Initialize REST API
    self.initializeRestApi();
};

Master.prototype.getPort = function () {
    var self = this;
    return self.port;
};

Master.prototype.getRestPort = function () {
    var self = this;
    return self.restPort;
};

Master.prototype.log = function (from, message) {
    console.log('Francine: ' + from + ': ' + message);
};

Master.prototype.initializeInstance = function () {
    var self = this;

    switch (self.instanceType) {
        case 'local':
            self.instance = new LocalInstance(self);
            break;
    }

    if (!self.instance) {
        self.log('Master', 'Error: Invalid worker instance type ' + self.instanceType);
        process.exit(1);
    }

    self.log('Master', 'Worker instance type: ' + self.instanceType);
};

Master.prototype.initializeInstanceManager = function () {
    var self = this;

    switch (self.instanceManagerType) {
        case 'static':
            self.instanceManager = new StaticInstanceManager(self, self.instance, 4);
            break;
    }

    if (!self.instanceManager) {
        self.log('Master', 'Error: Invalid instance manager type ' + self.instanceManagerType);
        process.exit(1);
    }

    self.log('Master', 'Instance manager type: ' + self.instanceManagerType);

    self.instanceManager.start();
};

Master.prototype.initializeRpc = function () {
    var self = this;

    self.log('Master', 'Waiting on port ' + self.port + ' for JSON RPC request...');

    self.rpcServer = new JsonRpcServer(new JsonRpcServerTcp(self.port), {
        pong: function (info, callback) {
            // self.log('Master', 'Pong received from ' + info.workerName);
            self.dispatchPong(info);
            callback(null, {});
        },
        finish: function (info, callback) {
            self.log('Master', 'Finish received from ' + info.workerName);
            self.scheduler.dispatchFinish(info);
            callback(null, {});
        },
    });
};

Master.prototype.initializeScheduler = function () {
    var self = this;

    switch (self.schedulerType) {
        case 'queue':
            self.scheduler = new QueueScheduler(self, self.instance);
            break;
    }

    if (!self.scheduler) {
        self.log('Master', 'Error: invalid scheduler type ' + self.schedulerType);
        process.exit(1);
    }

    self.log('Master', 'Scheduler type: ' + self.schedulerType);
};

Master.prototype.initializeRestApi = function () {
    var self = this;
    self.app = initializeRestApi(self, self.scheduler);
};

Master.prototype.dispatchPong = function (info) {
    var self = this;

    info.logs.map(function (message) {
        self.log('[' + info.workerName + '] ' + message.from, message.message);
    });
};

module.exports = Master;
