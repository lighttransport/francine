'use strict';

var jsonrpc = require('multitransport-jsonrpc');

var JsonRpcClient = jsonrpc.client;
var JsonRpcClientTcp = jsonrpc.transports.client.tcp;

var QueueScheduler = function (instance, master) {
    var self = this;

    self.instance = instance;
    self.instance.addOnUpdateListener(function () {
        self.updateWorkers();
        self.schedule();
    });
    self.master = master;

    self.sessions = {};

    self.queuedTasks = [];
    self.waitingTasks = {};

    self.workers = {};
    self.unusedWorkers = [];
    self.usedWorkers = {};
};

QueueScheduler.prototype.createSession = function () {
    var self = this;

    var sessionName = 'session' + (new Date().getTime() | 0);

    self.sessions[sessionName] = {
        name: sessionName
    };
};

QueueScheduler.prototype.deleteSession = function (sessionName) {
    var self = this;

    delete self.sessions[sessionName];
};

QueueScheduler.prototype.appendTask = function (sessionName, payload, done) {
    var self = this;

    var taskName = 'task' + (new Date().getTime() | 0);

    self.queuedTasks.push({
        name: taskName,
        payload: payload,
        done: done,
    });

    self.schedule();
};

QueueScheduler.prototype.schedule = function () {
    var self = this;

    if (self.unusedWorkers.length > 0 && self.queuedTasks.length > 0) {
        var workerName = self.unusedWorkers.pop();
        self.usedWorkers[workerName] = workerName;

        var task = self.queuedTasks.pop();
        task.assignedWorker = workerName;
        self.waitingTasks[task.name] = task;

        var worker = self.workers[workerName];

        new JsonRpcClient(new JsonRpcClientTcp(worker.host, worker.port), {}, function (client) {
            client.produce(task.name, function (result) {
                self.finished(task.name, result);
            });
        });

        self.schedule();
    }
};

// TODO(peryaudo): This signature might should be changed.
QueueScheduler.prototype.finished = function (taskName, result) {
    var self = this;

    var task = self.waitingTasks[taskName];
    delete self.waitingTasks[taskName];
    delete self.usedWorkers[task.assignedWorker];
    self.unusedWorkers.push(task.assignedWorker);

    var done = task.done;

    done(new Buffer(result.image, 'base64').toString('binary'), null);
};

module.exports = QueueScheduler;
