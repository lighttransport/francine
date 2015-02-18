'use strict';

var Q = require('q');
var fs = require('fs');
var request = require('request');
var jsonrpc = require('multitransport-jsonrpc');

var JsonRpcServer = jsonrpc.server;
var JsonRpcServerTcp = jsonrpc.transports.server.tcp;
var JsonRpcClient = jsonrpc.client;
var JsonRpcClientTcp = jsonrpc.transports.client.tcp;

var LocalInstance = require('./instances/local');
var GceInstance = require('./instances/gce');
var StaticInstanceManager = require('./instance_managers/static');
var QueueScheduler = require('./schedulers/queue');

var DropboxResource = require('./resources/dropbox');

var initializeRestApi = require('./apis/rest');

var Master = function (argv) {
    var self = this;

    self.instanceType = argv.instanceType || 'local';

    self.restPort = argv.restPort || 3000;
    self.port = argv.port || 5000;
    self.instanceManagerType = argv.instanceManagerType || 'static';
    self.schedulerType = argv.schedulerType || 'queue';
    self.test = argv.test;

    self.manageInterval = 15 * 1000;
    self.waitingPongTimeout = 4;

    if (argv.test) {
        self.manageInterval = 5 * 1000;
    }

    self.statusInterval = 10 * 1000;

    self.instance = null;
    self.instanceManager = null;

    self.scheduler = null;

    self.rpcServer = null;

    self.app = null;

    self.master = null;
    self.workers = {};
    self.unrecognizedWorkers = {};
    self.waitingPong = {};

    self.finishTaskDefers = {};
    self.finishFetchingDefers = {};
    self.seed = 0;

    self.configs = {};
    self.resources = null;

    self.sessions = {};
    self.executions = {};
};

Master.prototype.start = function () {
    var self = this;

    var francinerc = process.env.HOME + '/.francinerc';
    if (fs.existsSync(francinerc)) {
        self.configs = JSON.parse(fs.readFileSync(francinerc, { encoding: 'utf-8' }));
        self.log('Master', 'Read configuration form .fracinerc');
    } else {
        self.log('Master', 'No .fracinerc available.');
    }

    // Initialize instance type specific object
    self._initializeInstance();

    // Initialize instance manager
    self._initializeInstanceManager();

    // Initialize scheduler
    self._initializeScheduler();

    // Initialize RPC
    self._initializeRpc();

    // Initialize REST API
    self._initializeRestApi();

    // Initialize resources
    self._initializeResources();

    self.loop(self.manageInterval, function () {
        return self.instance.getInstances()
        .then(function (instances) {
            return self.manageWorkers(instances);
        })
        .then(function () {
            return self.instanceManager.manage();
        });
    }).done();

    setInterval(function () {
        self.scheduler.logStatus();
    }, self.statusInterval);

    process.on('uncaughtException', function (error) {
        self.log('Master', error.stack || error);
        process.exit(1);
    });
};

Master.prototype.loop = function (interval, f) {
    return Q().then(function l () { // jshint ignore:line
        return f().delay(interval).then(l);
    });
};

//
// Getters
//

Master.prototype.getPort = function () {
    var self = this;
    return self.port;
};

Master.prototype.getRestPort = function () {
    var self = this;
    return self.restPort;
};

Master.prototype.getMaster = function () {
    var self = this;
    return self.master;
};

Master.prototype.getWorkers = function () {
    var self = this;
    return self.workers;
};

Master.prototype.getId = function () {
    var self = this;
    self.seed++;
    return (Date.now() | 0) + '-' + self.seed;
};

Master.prototype.getResourceToken = function (resourceType) {
    var self = this;
    return self.resources[resourceType].getToken();
};

Master.prototype.getSession = function () {
    var self = this;
    return self.sessions;
};

Master.prototype.getNextCachedWorker = function (sessionName) {
    var self = this;

    if (self.sessions[sessionName].cachedWorkers.length === 0) {
        return null;
    }

    // Take a worker with the session resources from top and shift it back.
    var workerName = self.sessions[sessionName].cachedWorkers.pop();
    self.sessions[sessionName].cachedWorkers.unshift(workerName);

    return self.workers[workerName];
};

//
// Logger
//

Master.prototype.log = function (from, message) {
    console.log('Francine: ' + from + ': ' + message);
};

//
// Initializers
//

Master.prototype._initializeInstance = function () {
    var self = this;

    switch (self.instanceType) {
        case 'local':
            self.instance = new LocalInstance(self);
            break;
        case 'gce':
            self.instance = new GceInstance(self);
            break;
    }

    if (!self.instance) {
        self.log('Master', 'Error: Invalid worker instance type ' + self.instanceType);
        process.exit(1);
    }

    self.log('Master', 'Worker instance type: ' + self.instanceType);
};

Master.prototype._initializeInstanceManager = function () {
    var self = this;

    switch (self.instanceManagerType) {
        case 'static':
            self.instanceManager = new StaticInstanceManager(self, 8);
            break;
    }

    if (!self.instanceManager) {
        self.log('Master', 'Error: Invalid instance manager type ' + self.instanceManagerType);
        process.exit(1);
    }

    self.log('Master', 'Instance manager type: ' + self.instanceManagerType);
};

Master.prototype._initializeRpc = function () {
    var self = this;

    self.log('Master', 'Waiting on port ' + self.port + ' for JSON RPC request...');

    self.rpcServer = new JsonRpcServer(new JsonRpcServerTcp(self.port), {
        pong: function (info, callback) {
            // self.log('Master', 'Pong received from ' + info.workerName);
            self.dispatchPong(info);
            callback(null, {});
        },
        finish: function (info, callback) {
            // self.log('Master', 'Finish received from ' + info.workerName);
            self._dispatchFinish(info);
            callback(null, {});
        },
    });
};

Master.prototype._initializeScheduler = function () {
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

Master.prototype._initializeRestApi = function () {
    var self = this;
    self.app = initializeRestApi(self);
};

Master.prototype._initializeResources = function () {
    var self = this;
    self.resources = {};
    self.resources.dropbox = new DropboxResource();
    self.resources.dropbox.initializeInMaster(self, self.configs.dropbox);
    self.resources.dropbox.registerEndpoint(self.app);
};

//
// Ping / Pong and worker management
//

Master.prototype.resizeWorkers = function (size) {
    var self = this;
    return self.instance.resize(size);
};

Master.prototype.manageWorkers = function (instances) {
    var self = this;

    var d = Q.defer();

    self.master = instances.master;
    self.unrecognizedWorkers = instances.workers;

    if (!self.master) {
        d.resolve();
        return d.promise;
    }

    // Remove recognized workers that no longer exist
    Object.keys(self.workers).map(function (recognizedWorkerName) {
        if (!instances.workers[recognizedWorkerName]) {
            delete self.workers[recognizedWorkerName];

            // Delete the worker from the cached workers list of each session
            var filter = function (cachedWorkerName) {
                return cachedWorkerName !== recognizedWorkerName;
            };

            for (var sessionName in self.sessions) {
                if (self.sessions.hasOwnProperty(sessionName)) {
                    var session = self.sessions[sessionName];
                    if (session.cachedWorkers.indexOf(recognizedWorkerName) >= 0) {
                        session.cachedWorkers.filter(filter);
                    }
                }
            }
        }
    });
    Object.keys(self.waitingPong).map(function (recognizedWorkerName) {
        if (!instances.workers[recognizedWorkerName]) {
            delete self.waitingPong[recognizedWorkerName];
        }
    });

    // Recognized instances that failed to reply pings within timeout should be destroyed
    var destroyed = [];
    for (var workerName in self.waitingPong) {
        if (self.waitingPong.hasOwnProperty(workerName)) {
            var count = self.waitingPong[workerName];
            if (count >= self.waitingPongTimeout) {
                delete instances.workers[workerName];
                destroyed.push(workerName);
                // This instance will be terminated, so neither send ping nor dispatch pong
                self.waitingPong[workerName] = -1;
            }
        }
    }

    if (destroyed.length > 0) {
        self.instance.destroy(destroyed);
    }

    // Ping to recognized workers
    for (var key in self.workers) {
        if (self.workers.hasOwnProperty(key)) {
            var worker = self.workers[key];
            self.sendPing(worker);
        }
    }

    // Ping to unrecognized workers
    Object.keys(instances.workers).map(function (unrecognizedWorkerName) {
        if (!self.workers[unrecognizedWorkerName]) {
            self.sendPing(instances.workers[unrecognizedWorkerName]);
        }
    });

    self.scheduler.updateWorkers();
    self.scheduler.schedule();

    d.resolve();
    return d.promise;
};

Master.prototype.sendPing = function (worker) {
    var self = this;

    if (self.waitingPong[worker.name] && self.waitingPong[worker.name] < 0) {
        return;
    }

    self.waitingPong[worker.name] = self.waitingPong[worker.name] || 0;
    self.waitingPong[worker.name]++;

    var client = new JsonRpcClient(new JsonRpcClientTcp(worker.host, worker.port, { timeout: 10, retries: 0 }));
    client.register('ping');
    client.ping({
        workerName: worker.name,
        master: self.getMaster()
    }, function () {
        client.shutdown();
    });
};

Master.prototype.dispatchPong = function (info) {
    var self = this;

    if (self.waitingPong[info.workerName] && self.waitingPong[info.workerName] >= 0) {
        self.waitingPong[info.workerName] = Math.max(self.waitingPong[info.workerName] - 1, 0);
    }

    if (!self.workers[info.workerName] && self.unrecognizedWorkers[info.workerName]) {
        self.workers[info.workerName] = self.unrecognizedWorkers[info.workerName];

        self.scheduler.updateWorkers();
        self.scheduler.schedule();
    }

    self._appendCachedWorker(info.workerName, info.cachedSessions);

    info.logs.map(function (message) {
        self.log('[' + info.workerName + '] ' + message.from, message.message);
    });
};

//
// Tasks
//

Master.prototype.runTask = function (workerName, task) {
    var self = this;

    var worker = self.workers[workerName];

    var client = new JsonRpcClient(new JsonRpcClientTcp(worker.host, worker.port, { timeout: 10, retries: 0 }));
    client.register('run');
    //self.master.log('Master', 'Task ' + task.name + ' of ' + task.type + ' sent');
    client.run(task, function () {
        client.shutdown();
    });
};

Master.prototype.delayUntilFinishTask = function (taskName) {
    var self = this;
    var d = Q.defer();
    self.finishTaskDefers[taskName] = d;
    return d.promise;
    // TODO(peryaudo): write timeout
};

Master.prototype.delayUntilFinishFetching = function (taskName) {
    var self = this;
    var d = Q.defer();
    self.finishFetchingDefers[taskName] = d;
    return d.promise;
    // TODO(peryaudo): write timeout
};

//
// Finish management
//

Master.prototype._dispatchFinish = function (info) {
    var self = this;
    var d;

    self.scheduler.dispatchFinish(info);

    if (info.type === 'TASK') {
        if (info.task.type === 'PRODUCING') {
            self.executions[info.task.execution.name].producingTime += info.elapsedTime;
        } else if (info.task.type === 'REDUCING') {
            self.executions[info.task.execution.name].reducingTime += info.elapsedTime;
        }

        d = self.finishTaskDefers[info.task.name];
        delete self.finishTaskDefers[info.task.name];
        // self.log('Master', Object.keys(self.finishTaskDefers).length + ' defers waiting for dispatch after ' + info.task.name + ' of ' + info.task.type);
        if (d) {
            d.resolve(info);
        }
        // TODO(peryaudo): write error handling
    } else if (info.type === 'FETCHING') {
        self.executions[info.executionName].fetchingTime += info.elapsedTime;
        self._appendCachedWorker(info.workerName, info.cachedSessions);

        d = self.finishFetchingDefers[info.taskName];
        delete self.finishFetchingDefers[info.taskName];
        if (d) {
            d.resolve(info);
        }
    }
};

//
// Session / Execution management
//

Master.prototype.createSession = function (options) {
    var self = this;

    var sessionName = 'session' + self.getId();

    self.sessions[sessionName] = {
        name: sessionName,
        options: {
            resources: options.resources
        },
        cachedWorkers: []
    };

    return sessionName;
};

Master.prototype.deleteSession = function (sessionName) {
    var self = this;

    if (!self.sessions[sessionName]) {
        self.log('Master', 'Deleting invalid session ' + sessionName);
        return;
    }

    self.sessions[sessionName].cachedWorkers.map(function (workerName) {
        self._deleteSessionCache(workerName, sessionName);
    });

    delete self.sessions[sessionName];
};

Master.prototype._appendCachedWorker = function (workerName, cachedSessionNames) {
    var self = this;

    // TODO(peryaudo): these are inefficient

    cachedSessionNames.map(function (cachedSessionName) {
        if (!self.sessions[cachedSessionName]) {
            return;
        }

        if (self.sessions[cachedSessionName].cachedWorkers.indexOf(workerName) < 0) {
            self.sessions[cachedSessionName].cachedWorkers.push(workerName);
        }
    });

    var included = {};
    cachedSessionNames.map(function (cachedSessionName) {
        included[cachedSessionName] = true;
    });

    var filter = function (cachedWorkerName) {
        return cachedWorkerName !== workerName;
    };

    for (var sessionName in self.sessions) {
        if (self.sessions.hasOwnProperty(sessionName)) {
            var session = self.sessions[sessionName];
            if (!included[sessionName] && session.cachedWorkers.indexOf(workerName) >= 0) {
                session.cachedWorkers.filter(filter);
            }
        }
    }
};

Master.prototype._deleteSessionCache = function (workerName, sessionName) {
    var self = this;

    var worker = self.workers[workerName];
    if (!worker) {
        self.log('Master', 'deleteSessionCache from invalid worker ' + workerName);
        return;
    }

    var client = new JsonRpcClient(new JsonRpcClientTcp(worker.host, worker.port, { timeout: 10, retries: 0 }));
    client.register('deleteCache');
    client.deleteCache({
        sessionName: sessionName
    }, function () {
        client.shutdown();
    });
};

Master.prototype.createExecution = function (options) {
    var self = this;
    var d = Q.defer();

    if (!self.sessions.hasOwnProperty(options.sessionName)) {
        self.log('Master', 'No such session available! ' + options.sessionName);
        d.reject();
        return d.promise;
    }

    var session = self.sessions[options.sessionName];

    var executionName = 'execution' + self.getId();

    self.log('Master', 'Execution ' + executionName + ' created.');

    var execution = {
        name: executionName,
        options: options,
        tasks: [],
        fetchingTime: 0,
        producingTime: 0,
        reducingTime: 0,
        totalTime: 0
    };

    self.executions[executionName] = execution;

    var startTime = Date.now();

    var initialProducingTaskName = self.scheduler.createProducingTask(session, execution, 0);
    self.scheduler.schedule();

    return self.delayUntilFinishFetching(initialProducingTaskName)
    .then(function () {
        self.log('Master', 'finished fetching.');
        var producingTaskNames = [initialProducingTaskName];
        for (var i = 1; i < execution.options.parallel; i++) {
            producingTaskNames.push(self.scheduler.createProducingTask(session, execution, i));
        }
        self.scheduler.schedule();

        var producingTasks = producingTaskNames.map(function (producingTaskName) {
            return self.delayUntilFinishTask(producingTaskName);
        });

        // Do two layer reducing iff. the number of producing tasks is more than 4
        if (producingTasks.length <= 4) {
            return Q.all(producingTasks);
        } else {
            return self._createIntermediateReducing(session, execution, producingTasks);
        }
    })
    .then(function (producings) {
        var reducingTaskName = self.scheduler.createReducingTask(session, execution, producings);
        self.scheduler.schedule();
        return self.delayUntilFinishTask(reducingTaskName);
    })
    .then(function (reducing) {
        return self.receive(reducing.workerName, reducing.task.name);
    })
    .then(function (image) {
        var d = Q.defer();
        self.executions[executionName].totalTime = Date.now() - startTime;
        self.log('Master', 'Execution ' + execution.name + ' finished; ' +
                'fetching: ' + execution.fetchingTime + 'ms ' +
                'producing: ' + execution.producingTime + 'ms ' +
                'reducing: ' + execution.reducingTime + 'ms ' +
                'total: ' + execution.totalTime + 'ms');
        delete self.executions[executionName];
        d.resolve(image);
        return d.promise;
    });
};

Master.prototype._createIntermediateReducing = function (session, execution, producingTaskPromises) {
    var self = this;
    var d = Q.defer();

    var reducingUnit = Math.sqrt(producingTaskPromises.length) | 0;
    var currentUnit = 0;
    var produceds = [];

    var totalProduced = producingTaskPromises.length;
    var currentProduced = 0;

    var reducingPromises = [];

    var producingFinished = function (producing) {
        ++currentUnit;
        ++currentProduced;

        produceds.push(producing);

        if (currentUnit === reducingUnit || currentProduced === totalProduced) {
            reducingPromises.push(
                    self.delayUntilFinishTask(
                        self.scheduler.createReducingTask(session, execution, produceds)));
            self.scheduler.schedule();
            produceds = [];
            currentUnit = 0;
        }

        if (currentProduced === totalProduced) {
            Q.all(reducingPromises).then(function (reducings) {
                d.resolve(reducings);
            });
        }
    };

    producingTaskPromises.map(function (producingTaskPromise) {
        producingTaskPromise.then(producingFinished);
    });

    return d.promise;
};

//
// Receiving result
//

Master.prototype.receive = function (workerName, taskName) {
    var self = this;
    var d = Q.defer();

    var worker = self.workers[workerName];

    // self.master.log('Master', 'retrieving ...');

    request({
        uri: 'http://' + worker.host + ':' + worker.resourcePort + '/results/' + taskName,
        encoding: null
    }, function (error, response, body) {
        if (error) {
            self.log('Master', error);
            d.reject(error);
        } else {
            // self.master.log('Master', 'retrieving finished!');
            d.resolve(body);
        }
    });

    return d.promise;
};

module.exports = Master;
