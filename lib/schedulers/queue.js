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

    self.executions = {};

    self.queuedTasks = [];
    self.waitingTasks = {};

    self.unusedWorkers = [];
    self.usedWorkers = {};
};

QueueScheduler.prototype.createSession = function (options) {
    var self = this;

    var sessionName = 'session' + (new Date().getTime() | 0);

    self.sessions[sessionName] = {
        name: sessionName,
        options: options
    };

    return sessionName;
};

QueueScheduler.prototype.deleteSession = function (sessionName) {
    var self = this;

    delete self.sessions[sessionName];
};

QueueScheduler.prototype._createProducingTask = function (session, execution) {
    var self = this;

    var taskName = 'task' + (new Date().getTime() | 0);

    self.queuedTasks.push({
        name: taskName,
        type: 'PRODUCING',
        session: session,
        execution: execution,
        source: { type: 'ORIGINAL' }
    });
};

QueueScheduler.prototype._createReducingTask = function (session, execution) {
    var self = this;

    var taskName = 'task' + (new Date().getTime() | 0);

    self.queuedTasks.push({
        name: taskName,
        type: 'REDUCING',
        session: session,
        execution: execution
    });
};

QueueScheduler.prototype._generateTasks = function (executionName) {
    var self = this;

    var execution = self.executions[executionName];

    if (execution.started) {
        if (execution.remaining === 0) {
            self._createReducingTask(self.sessions[execution.sessionName], execution);
        }
    } else {
        for (var i = 0; i < execution.remaining; ++i) {
            self._createProducingTask(self.sessions[execution.sessionName], execution);
        }
        execution.started = true;
        return;
    }
};

QueueScheduler.prototype.createExecution = function (options) {
    var self = this;
    var d = Q.defer();

    if (!self.sessions.hasOwnProperty(options.sessionName)) {
        self.master.log('QueueScheduler', 'No such session available! ' + options.sessionName);
        return;
    }

    var executionName = 'execution' + (new Date().getTime() | 0);

    self.master.log('QueueScheduler', 'Execution ' + executionName + ' created.');

    self.executions[executionName] = {
        name: executionName,
        options: options,
        d: d,
        remaining: 4,
        started: false,
        startTime: new Date().getTime() | 0,
        tasks: []
    };

    self._generateTasks(executionName);
    self.schedule();

    return d.promise;
};

QueueScheduler.prototype.schedule = function () {
    var self = this;

    if (self.queuedTasks.length === 0 || self.unusedWorkers.length === 0) {
        return;
    }

    var task = self.queuedTasks.pop();
    var workerName = self.unusedWorkers.pop();

    self.waitingTasks[task.name] = task;
    self.usedWorkers[workerName] = true;

    var worker = self.master.getWorkers()[workerName];

    new JsonRpcClient(new JsonRpcClientTcp(worker.host, worker.port), {}, function (client) {
        self.master.log('QueueScheduler', 'Task ' + task.name + ' of ' + task.type + ' sent');
        client.run(task, function () {});
    });

    self.schedule();
};

QueueScheduler.prototype.updateWorkers = function () {
    var self = this;

    // TODO(peryaudo): it is valid but inefficient
    if (Object.keys(self.usedWorkers).length === 0) {
        self.unusedWorkers = Object.keys(self.master.getWorkers());
    }
};

QueueScheduler.prototype._receiveAndReturn = function (worker, taskName, execution) {
    var self = this;
    var d = Q.defer();

    request({
        uri: 'http://' + worker.host + ':' + worker.resourcePort + '/results/' + taskName,
        encoding: null
    }, function (error, response, body) {
        if (error) {
            d.reject();
            self.master.log('QueueScheduler', error);
        }

        var elapsed = (new Date().getTime() | 0) - execution.startTime;
        self.master.log('QueueScheduler', 'Elapsed time of execution ' + execution.name + ': ' + elapsed + 'ms');
        d.resolve(body);
    });

    return d.promise;
};

QueueScheduler.prototype.dispatchFinish = function (info) {
    var self = this;

    if (info.type !== 'TASK') {
        return;
    }

    self.master.log('QueueScheduler', 'Task ' + info.task.name + ' of ' + info.task.type + ' finished');

    self.unusedWorkers.push(info.workerName);
    delete self.waitingTasks[info.task.name];

    var executionName = info.task.execution.name;

    var worker = self.master.getWorkers()[info.workerName];

    switch (info.task.type) {
        case 'PRODUCING':

            self.executions[executionName].remaining--;

            self.executions[executionName].tasks.push({
                taskName: info.task.name,
                worker: {
                    host: worker.host,
                    port: worker.port,
                    resourcePort: worker.resourcePort
                }
            });
            self._generateTasks(executionName);

            break;

        case 'REDUCING':
            var execution = self.executions[executionName];
            var d = self.executions[executionName].d;
            delete self.executions[executionName];
            self._receiveAndReturn(worker, info.task.name, execution)
            .then(function (image) {
                d.resolve(image);
            });

            break;
    }

    self.schedule();
};

module.exports = QueueScheduler;
