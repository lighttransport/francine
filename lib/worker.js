'use strict';

var Q = require('q');
var express = require('express');
var jsonrpc = require('multitransport-jsonrpc');
var mkdirp = require('mkdirp');
var fs = require('fs');
var rimraf = require('rimraf');

var JsonRpcServer = jsonrpc.server;
var JsonRpcServerTcp = jsonrpc.transports.server.tcp;
var JsonRpcClient = jsonrpc.client;
var JsonRpcClientTcp = jsonrpc.transports.client.tcp;

var InternalResource = require('./resources/internal');
var DropboxResource = require('./resources/dropbox');

var AoProducer = require('./producers/ao');
var PngReducer = require('./reducers/png');

var Worker = function (argv) {
    var self = this;

    self.port = argv.port || 5000;
    self.resourcePort = argv.resourcePort || 9000;
    self.temporaryDirectory = argv.temporaryDirectory || ('/tmp/francine' + (Date.now() | 0));

    self.rpcServer = null;
    self.logs = [];
    self.app = null;

    self.sessions = {};

    self.producers = null;
    self.reducers = null;
};

Worker.prototype.start = function () {
    var self = this;

    self._initializeTemporaryDirectory();

    self._initializeResourceServer();

    self._initializeRpc();

    self._initializeProducers();

    self._initializeReducers();

    process.on('uncaughtException', function (error) {
        self.log('Worker', error.stack);
        self.sendPong().then(function () {
            process.exit(1);
        });
    });
};

//
// Getters
//

Worker.prototype.getTemporaryDirectory = function () {
    var self = this;

    return self.temporaryDirectory;
};

Worker.prototype.getMaster = function () {
    var self = this;

    return self.master;
};

Worker.prototype.getName = function () {
    var self = this;

    return self.workerName;
};

//
// Logger
//

Worker.prototype.log = function (from, message) {
    var self = this;

    self.logs.push({
        from: from,
        message: message
    });
    // console.log('Francine: ' + from + ': ' + message);
};

//
// Initializers
//

Worker.prototype._initializeTemporaryDirectory = function () {
    var self = this;

    self.log('Worker', 'Base temporary directory: ' + self.temporaryDirectory);

    mkdirp.sync(self.temporaryDirectory + '/sessions');
    mkdirp.sync(self.temporaryDirectory + '/executions');
    mkdirp.sync(self.temporaryDirectory + '/results');
};

Worker.prototype._initializeRpc = function () {
    var self = this;

    self.log('Worker', 'Waiting on port ' + self.port + ' for JSON RPC request...');

    self.rpcServer = new JsonRpcServer(new JsonRpcServerTcp(self.port), {
        ping: function (info, callback) {
            self.dispatchPing(info);
            self.sendPong().done();
            callback(null, {});
        },

        run: function (task, callback) {
            // self.log('Worker', 'Received task ' + task.name + ' of ' + task.type);
            var startTime = Date.now();

            var p;
            switch (task.type) {
                case 'PRODUCING':
                    var startFetchingTime = Date.now();
                    p = self._prepareResources(task)
                    .then(function () {
                        self._sendFinishFetching(task, Date.now() - startFetchingTime);
                        return self._linkResources(task);
                    })
                    .then(function () {
                        startTime = Date.now();
                        return self.producers[task.session.options.producer].produce(task);
                    })
                    .then(function () {
                        return self._unlinkResources(task);
                    });
                    break;
                case 'REDUCING':
                    p = self.reducers[task.session.options.reducer].reduce(task);
                    break;
            }

            p.then(function () {
                self._sendFinishTask(task, Date.now() - startTime);
            }).done();

            callback(null, {});
        },

        deleteCache: function (info, callback) {
            self._deleteResources(info.sessionName);
            self.producers[self.sessions[info.sessionName].options.producer].deleteCache(info.sessionName);
            delete self.sessions[info.sessionName];
            callback(null, {});
        },
    });
};

Worker.prototype._initializeResourceServer = function () {
    var self = this;

    self.app = express();

    self.app.use(express.static(self.temporaryDirectory));

    self.app.listen(self.resourcePort, function () {
        self.log('Worker', 'Waiting on Resource port ' + self.resourcePort + ' for Resource request...');
    });
};

Worker.prototype._initializeProducers = function () {
    var self = this;
    self.producers = {};
    self.producers.ao = new AoProducer(self);
};

Worker.prototype._initializeReducers = function () {
    var self = this;
    self.reducers = {};
    self.reducers.png = new PngReducer(self);
};

//
// Ping / Pong management
//

Worker.prototype.dispatchPing = function (info) {
    var self = this;

    self.workerName = info.workerName;
    self.master = info.master;
};

Worker.prototype.sendPong = function () {
    var self = this;
    var d = Q.defer();

    var client = new JsonRpcClient(new JsonRpcClientTcp(self.master.host, self.master.port));
    client.register('pong');
    client.pong({
        workerName: self.workerName,
        logs: self.logs,
        cachedSessions: Object.keys(self.sessions)
    }, function () {
        client.shutdown();
        d.resolve();
    });

    self.logs = [];

    return d.promise;
};

//
// Finish senders
//

Worker.prototype._sendFinishTask = function (task, elapsedTime) {
    var self = this;

    var client = new JsonRpcClient(new JsonRpcClientTcp(self.master.host, self.master.port, { timeout: 10, retries: 0 }));
    client.register('finish');
    client.finish({
        type: 'TASK',
        workerName: self.getName(),
        task: task,
        elapsedTime: elapsedTime
    }, function () {
        client.shutdown();
    });

    // self.log('Worker', 'Finish task ' + task.name + ' of ' + task.type + ' sent');
};

Worker.prototype._sendFinishFetching = function (task, elapsedTime) {
    var self = this;

    var client = new JsonRpcClient(new JsonRpcClientTcp(self.master.host, self.master.port));
    client.register('finish');
    client.finish({
        type: 'FETCHING',
        workerName: self.getName(),
        taskName: task.name,
        executionName: task.execution.name,
        cachedSessions: Object.keys(self.sessions),
        elapsedTime: elapsedTime
    }, function () {
        client.shutdown();
    });
};

//
// Resource preparation
//

Worker.prototype._prepareResources = function (task) {
    var self = this;
    var d;

    if (self.sessions[task.session.name]) {
        // self.log('Worker', 'Session cache available.');
        d = Q.defer();
        d.resolve();
        return d.promise;
    }

    // self.log('Worker', 'Preparing resources...');

    var files = task.session.options.resources;

    if (!files) {
        // self.log('Worker', 'No resource required.');
        d = Q.defer();
        d.resolve();
        return d.promise;
    }

    mkdirp.sync(self.temporaryDirectory + '/sessions/' + task.session.name);

    var i;
    var resources = {};

    if (task.source) {
        for (i = 0; i < files.length; i++) {
            files[i].type = 'internal';
            files[i].index = i;
        }
    }

    for (i = 0; i < files.length; i++) {
        var file = files[i];
        if (resources[file.type]) {
            continue;
        }

        var resource;
        switch (file.type) {
            case 'internal':
                resource = new InternalResource(self, task.session, task.source);
                break;
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

    return q.then(function () {
        var d = Q.defer();
        self.sessions[task.session.name] = task.session;
        d.resolve();
        return d.promise;
    });
};

Worker.prototype._deleteResources = function (sessionName) {
    var self = this;
    var d = Q.defer();

    rimraf(self.temporaryDirectory + '/sessions/' + sessionName, function (error) {
        if (error) {
            d.reject(error);
        } else {
            d.resolve();
        }
    });

    return d.promise;
};

Worker.prototype._linkResources = function (task) {
    var self = this;
    var d = Q.defer();

    mkdirp.sync(self.temporaryDirectory + '/executions/' + task.execution.name);
    var files = task.session.options.resources;

    if (!files) {
        d.resolve();
        return d.promise;
    }

    for (var i = 0; i < files.length; i++) {
        fs.linkSync(
                self.temporaryDirectory + '/sessions/' + task.session.name + '/resource' + i,
                self.temporaryDirectory + '/executions/' + task.execution.name + '/' + files.dst);
    }

    d.resolve();
    return d.promise;
};

Worker.prototype._unlinkResources = function (task) {
    var self = this;
    var d = Q.defer();
    rimraf(self.temporaryDirectory + '/executions/' + task.execution.name, function (error) {
        if (error) {
            d.reject(error);
        } else {
            d.resolve();
        }
    });
    return d.promise;
};

module.exports = Worker;
