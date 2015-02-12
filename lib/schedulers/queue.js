'use strict';

var Q = require('q');
var request = require('request');
var jsonrpc = require('multitransport-jsonrpc');

var JsonRpcClient = jsonrpc.client;
var JsonRpcClientTcp = jsonrpc.transports.client.tcp;

var QueueScheduler = function (master, instance) {
    var self = this;

    self.master = master;
    self.instance = instance;

    self.sessions = {};

    self.queuedTasks = [];
    self.waitingTasks = {};

    self.unusedWorkers = [];
    self.usedWorkers = {};
};

QueueScheduler.prototype.createSession = function (options) {
    var self = this;

    var sessionName = 'session' + self.master.getId();

    self.sessions[sessionName] = {
        name: sessionName,
        options: {
            resources: options.resources
        },
        cachedWorkers: []
    };

    return sessionName;
};

QueueScheduler.prototype.deleteSession = function (sessionName) {
    var self = this;

    delete self.sessions[sessionName];
};

QueueScheduler.prototype._createProducingTask = function (session, execution, seed) {
    var self = this;

    var taskName = 'task' + self.master.getId();

    self.queuedTasks.push({
        name: taskName,
        type: 'PRODUCING',
        session: session,
        execution: execution,
        tokens: {},
        seed: seed
    });

    return taskName;
};

QueueScheduler.prototype._createReducingTask = function (session, execution) {
    var self = this;

    var taskName = 'task' + self.master.getId();

    self.queuedTasks.push({
        name: taskName,
        type: 'REDUCING',
        session: session,
        execution: execution
    });

    return taskName;
};

QueueScheduler.prototype.schedule = function () {
    var self = this;

    self.master.log('QueueScheduler',
            self.queuedTasks.length + ' tasks waiting, ' +
            Object.keys(self.waitingTasks).length + ' tasks running, ' +
            self.unusedWorkers.length + ' / ' +
            (self.unusedWorkers.length + Object.keys(self.usedWorkers).length) + ' workers free');

    if (self.queuedTasks.length === 0 || self.unusedWorkers.length === 0) {
        return;
    }

    var task = self.queuedTasks.pop();
    var workerName = self.unusedWorkers.pop();

    task = self._scheduleResources(task);

    self.waitingTasks[task.name] = task;
    self.usedWorkers[workerName] = true;

    var worker = self.master.getWorkers()[workerName];

    var client = new JsonRpcClient(new JsonRpcClientTcp(worker.host, worker.port));
    client.register('run');
    //self.master.log('QueueScheduler', 'Task ' + task.name + ' of ' + task.type + ' sent');
    client.run(task, function () {
        client.shutdown();
    });

    self.schedule();
};

QueueScheduler.prototype._scheduleResources = function (task) {
    var self = this;
    // TODO(peryaudo): implement cluster internal resource transfering
    if (task.type === 'PRODUCING' && task.session.options.resources) {
        // self.master.log('QueueScheduler', 'session at that POT: ' + JSON.stringify(self.sessions));

        if (self.sessions[task.session.name].cachedWorkers.length > 0) {
            // Take a worker with the session resources from top and shift it back.
            var workerName = self.sessions[task.session.name].cachedWorkers.pop();
            self.sessions[task.session.name].cachedWorkers.unshift(workerName);

            var worker = self.master.getWorkers()[workerName];
            task.source = {
                host: worker.host,
                port: worker.port,
                resourcePort: worker.resourcePort
            };
        } else {
            var tokens = {};
            var resources = task.session.options.resources;

            for (var i = 0; i < resources.length; i++) {
                var resource = resources[i];
                if (!tokens[resource.type]) {
                    tokens[resource.type] = self.master.getResourceToken(resource.type);
                }
            }

            task.tokens = tokens;
        }
    }

    return task;
};

QueueScheduler.prototype.updateWorkers = function () {
    var self = this;

    // TODO(peryaudo): it is valid but inefficient
    if (Object.keys(self.usedWorkers).length === 0) {
        self.unusedWorkers = Object.keys(self.master.getWorkers());
    }
};

QueueScheduler.prototype.dispatchFinish = function (info) {
    var self = this;

    if (info.type === 'TASK') {
        self.unusedWorkers.push(info.workerName);
        delete self.usedWorkers[info.workerName];
        delete self.waitingTasks[info.task.name];

        // self.master.log('QueueScheduler', 'Task ' + info.task.name + ' of ' + info.task.type + ' finished');

        self.schedule();
    } else if (info.type === 'FETCHING') {
        info.cachedSessions.map(function (cachedSession) {
            // TODO(peryaudo): delete session garbage collection
            if (!self.sessions[cachedSession]) {
                return;
            }

            // TODO(peryaudo): it is inefficient
            if (self.sessions[cachedSession].cachedWorkers.indexOf(info.workerName) < 0) {
                self.sessions[cachedSession].cachedWorkers.push(info.workerName);
            }
        });
    }

    return;
};

QueueScheduler.prototype._receive = function (worker, taskName) {
    var self = this;
    var d = Q.defer();

    request({
        uri: 'http://' + worker.host + ':' + worker.resourcePort + '/results/' + taskName,
        encoding: null
    }, function (error, response, body) {
        if (error) {
            self.master.log('QueueScheduler', error);
            d.reject(error);
        } else {
            d.resolve(body);
        }
    });

    return d.promise;
};

QueueScheduler.prototype.createExecution = function (options) {
    var self = this;
    var d = Q.defer();

    if (!self.sessions.hasOwnProperty(options.sessionName)) {
        self.master.log('QueueScheduler', 'No such session available! ' + options.sessionName);
        d.reject();
        return d.promise;
    }

    var session = self.sessions[options.sessionName];

    var executionName = 'execution' + self.master.getId();

    self.master.log('QueueScheduler', 'Execution ' + executionName + ' created.');

    var execution = {
        name: executionName,
        options: options,
        startTime: Date.now() | 0,
        tasks: []
    };

    var initialProducingTaskName = self._createProducingTask(session, execution, 0);
    self.schedule();

    return self.master.delayUntilFinishFetching(initialProducingTaskName)
    .then(function () {
        self.master.log('QueueScheduler', 'finished fetching.');
        var producingTaskNames = [initialProducingTaskName];
        for (var i = 1; i < execution.options.parallel; i++) {
            producingTaskNames.push(self._createProducingTask(session, execution, i));
        }
        self.schedule();

        return Q.all(producingTaskNames.map(function (producingTaskName) {
            return self.master.delayUntilFinishTask(producingTaskName);
        }));
    })
    .then(function (producings) {
        execution.tasks = producings.map(function (producing) {
            var worker = self.master.getWorkers()[producing.workerName];
            return {
                taskName: producing.task.name,
                worker: {
                    host: worker.host,
                    port: worker.port,
                    resourcePort: worker.resourcePort
                }
            };
        });
        var reducingTaskName = self._createReducingTask(session, execution);
        self.schedule();
        return self.master.delayUntilFinishTask(reducingTaskName);
    })
    .then(function (reducing) {
        var worker = self.master.getWorkers()[reducing.workerName];
        return self._receive(worker, reducing.task.name);
    })
    .then(function (image) {
        var d = Q.defer();
        var elapsed = (Date.now() | 0) - execution.startTime;
        self.master.log('QueueScheduler', 'Elapsed time of execution ' + execution.name + ': ' + elapsed + 'ms');
        d.resolve(image);
        return d.promise;
    });
};

module.exports = QueueScheduler;
