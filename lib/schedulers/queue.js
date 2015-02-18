'use strict';

var concatObject = require('../concat');

var QueueScheduler = function (master, instance) {
    var self = this;

    self.master = master;
    self.instance = instance;

    self.queuedTasks = [];
    self.waitingTasks = {};

    self.unusedWorkers = [];
    self.usedWorkers = {};
};

QueueScheduler.prototype.createProducingTask = function (session, execution, seed) {
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

QueueScheduler.prototype.createReducingTask = function (session, execution, producings) {
    var self = this;

    var taskName = 'task' + self.master.getId();

    execution = concatObject({}, execution);

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

    if (self.queuedTasks.length === 0 || self.unusedWorkers.length === 0) {
        return;
    }

    var task = self.queuedTasks.pop();
    var workerName = self.unusedWorkers.pop();

    task = self._scheduleResources(task);

    self.waitingTasks[task.name] = task;
    self.usedWorkers[workerName] = true;

    self.master.runTask(workerName, task);

    self.schedule();
};

QueueScheduler.prototype.logStatus = function () {
    var self = this;
    self.master.log('QueueScheduler',
            self.queuedTasks.length + ' tasks waiting, ' +
            Object.keys(self.waitingTasks).length + ' tasks running, ' +
            self.unusedWorkers.length + ' / ' +
            (self.unusedWorkers.length + Object.keys(self.usedWorkers).length) + ' workers free');
};

QueueScheduler.prototype._scheduleResources = function (task) {
    var self = this;
    var worker;

    if (task.type === 'PRODUCING' && task.session.options.resources) {
        worker = self.master.getNextCachedWorker(task.session.name);
        if (worker) {
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

    // Generate object with workers included in the scheduler
    var included = {};

    Object.keys(self.usedWorkers).map(function (workerName) {
        included[workerName] = true;
    });

    self.unusedWorkers.map(function (workerName) {
        included[workerName] = true;
    });

    // Add workers that are not included in the scheduler
    Object.keys(self.master.getWorkers()).map(function (workerName) {
        if (!included[workerName]) {
            self.unusedWorkers.push(workerName);
        }
    });

    // Remove workers that are included in the scheduler but no longer exists
    Object.keys(self.usedWorkers).map(function (workerName) {
        if (!self.master.getWorkers()[workerName]) {
            delete self.usedWorkers[workerName];
        }
    });

    self.unusedWorkers = self.unusedWorkers.filter(function (workerName) {
        return self.master.getWorkers()[workerName];
    });
};

QueueScheduler.prototype.dispatchFinish = function (info) {
    var self = this;

    if (info.type === 'TASK') {
        self.unusedWorkers.push(info.workerName);
        delete self.usedWorkers[info.workerName];
        delete self.waitingTasks[info.task.name];

        // self.master.log('QueueScheduler', 'Task ' + info.task.name + ' of ' + info.task.type + ' finished');

        self.schedule();
    }

    return;
};

module.exports = QueueScheduler;
