'use strict';

var Q = require('q');
var express = require('express');
var jsonrpc = require('multitransport-jsonrpc');
var mkdirp = require('mkdirp');

var JsonRpcServer = jsonrpc.server;
var JsonRpcServerTcp = jsonrpc.transports.server.tcp;
var JsonRpcClient = jsonrpc.client;
var JsonRpcClientTcp = jsonrpc.transports.client.tcp;

var DropboxResource = require('./resources/dropbox');

var AoProducer = require('./producers/ao');
var reduce = require('./reducers/reduce');

var Worker = function (argv) {
    var self = this;

    self.port = argv.port || 5000;
    self.resourcePort = argv.resourcePort || 9000;
    self.temporaryDirectory = argv.temporaryDirectory || ('/tmp/francine' + (Date.now() | 0));

    self.rpcServer = null;
    self.logs = [];
    self.app = null;

    self.sessions = {};
};

Worker.prototype.start = function () {
    var self = this;

    self.initializeTemporaryDirectory();

    self.initializeRpc();

    self.initializeResourceServer();

    process.on('uncaughtException', function (error) {
        self.log('Worker', error.stack);
        self.sendPong().then(function () {
            process.exit(1);
        });
    });
};

Worker.prototype.initializeTemporaryDirectory = function () {
    var self = this;

    self.log('Worker', 'Base temporary directory: ' + self.temporaryDirectory);

    mkdirp.sync(self.temporaryDirectory + '/sessions');
    mkdirp.sync(self.temporaryDirectory + '/results');
};

Worker.prototype.getTemporaryDirectory = function () {
    var self = this;

    return self.temporaryDirectory;
};

Worker.prototype.initializeRpc = function () {
    var self = this;

    self.log('Worker', 'Waiting on port ' + self.port + ' for JSON RPC request...');

    self.rpcServer = new JsonRpcServer(new JsonRpcServerTcp(self.port), {
        ping: function (info, callback) {
            self.dispatchPing(info);
            self.sendPong().done();
            callback(null, {});
        },

        run: function (task, callback) {
            self.log('Worker', 'Received task ' + task.name + ' of ' + task.type);
            var p;
            switch (task.type) {
                case 'PRODUCING':
                    p = (self.prepareResources(task).then(function () {
                        self.log('Worker', 'baz');
                        return AoProducer.produce(task, self);
                    }));
                    break;
                case 'REDUCING':
                    p = reduce(task, self);
                    break;
            }

            p.then(function () {
                self.log('Worker', 'fin');
                self.sendFinish(task);
            }).done();

            callback(null, {});
        },
    });
};

Worker.prototype.initializeResourceServer = function () {
    var self = this;

    self.app = express();

    self.app.use(express.static(self.temporaryDirectory));

    self.app.listen(self.resourcePort, function () {
        self.log('Worker', 'Waiting on Resource port ' + self.resourcePort + ' for Resource request...');
    });
};

Worker.prototype.dispatchPing = function (info) {
    var self = this;

    self.workerName = info.workerName;
    self.master = info.master;
};

Worker.prototype.log = function (from, message) {
    var self = this;

    self.logs.push({
        from: from,
        message: message
    });
    // console.log('Francine: ' + from + ': ' + message);
};

Worker.prototype.sendPong = function () {
    var self = this;
    var d = Q.defer();

    var client = new JsonRpcClient(new JsonRpcClientTcp(self.master.host, self.master.port));
    client.register('pong');
    client.pong({
        workerName: self.workerName,
        logs: self.logs
    }, function () {
        client.shutdown();
        d.resolve();
    });

    self.logs = [];

    return d.promise;
};

Worker.prototype.getMaster = function () {
    var self = this;

    return self.master;
};

Worker.prototype.getName = function () {
    var self = this;

    return self.workerName;
};

Worker.prototype.sendFinish = function (task) {
    var self = this;

    var client = new JsonRpcClient(new JsonRpcClientTcp(self.master.host, self.master.port));
    client.register('finish');
    client.finish({
        type: 'TASK',
        workerName: self.getName(),
        task: task
    }, function () {
        client.shutdown();
    });

    self.log('Worker', 'Finish task ' + task.name + ' of ' + task.type + ' sent');
};

Worker.prototype.prepareResources = function (task) {
    var self = this;
    self.log('Worker', 'Preparing resources...');

    var i;
    var resources = {};
    var files = task.session.options.resources;

    if (!files) {
        var d = Q.defer();
        self.log('Worker', 'No resource required.');
        d.resolve();
        return d.promise;
    }

    mkdirp.sync(self.temporaryDirectory + '/sessions/' + task.session.name);

    for (i = 0; i < files.length; i++) {
        var file = files[i];
        if (resources[file.type]) {
            continue;
        }

        var resource;
        switch (file.type) {
            case 'dropbox':
                resource = new DropboxResource();
                resource.initializeInWorker(self, task.tokens[file.type]);
                break;
        }

        resources[file.type] = resource;
    }

    var retrieve = function (file, index) {
        return function () {
            return resources[file.type].retrieve(file, self.temporaryDirectory + '/sessions/' + task.session.name + '/resource' + index);
        };
    };

    var q = Q(); // jshint ignore:line
    for (i = 0; i < files.length; i++) {
        q = q.then(retrieve(files[i], i));
    }

    return q;
};

module.exports = Worker;
