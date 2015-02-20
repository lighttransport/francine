'use strict';

var concatObject = require('../concat');

function QueueScheduler(master, instance) {
  var _this = this;

  _this.master = master;
  _this.instance = instance;

  _this.queuedTasks = [];
  _this.waitingTasks = {};

  _this.unusedWorkers = [];
  _this.usedWorkers = {};
}

QueueScheduler.prototype.createProducingTask =
function createProducingTask(session, execution, seed) {
  var _this = this;

  var taskName = 'task' + _this.master.getId();

  _this.queuedTasks.push({
    name: taskName,
    type: 'PRODUCING',
    session: session,
    execution: execution,
    tokens: {},
    seed: seed
  });

  return taskName;
};

QueueScheduler.prototype.createReducingTask =
function createReducingTask(session, execution, producings) {
  var _this = this;

  var taskName = 'task' + _this.master.getId();

  execution = concatObject({}, execution);

  execution.tasks = producings.map(function(producing) {
    var worker = _this.master.getWorkers()[producing.workerName];
    return {
      taskName: producing.task.name,
      worker: {
        host: worker.host,
        port: worker.port,
        resourcePort: worker.resourcePort
      }
    };
  });

  _this.queuedTasks.push({
    name: taskName,
    type: 'REDUCING',
    session: session,
    execution: execution
  });

  return taskName;
};

QueueScheduler.prototype.schedule = function schedule() {
  var _this = this;

  if (_this.queuedTasks.length === 0 || _this.unusedWorkers.length === 0) {
    return;
  }

  var task = _this.queuedTasks.pop();
  var workerName = _this.unusedWorkers.pop();

  task = _this._scheduleResources(task);

  _this.waitingTasks[task.name] = task;
  _this.usedWorkers[workerName] = true;

  _this.master.runTask(workerName, task);

  _this.schedule();
};

QueueScheduler.prototype.logStatus = function logStatus() {
  var _this = this;
  _this.master.log('QueueScheduler',
      _this.queuedTasks.length + ' tasks waiting, ' +
      Object.keys(_this.waitingTasks).length + ' tasks running, ' +
      _this.unusedWorkers.length + ' / ' +
      (_this.unusedWorkers.length + Object.keys(_this.usedWorkers).length) +
      ' workers free');
};

QueueScheduler.prototype._scheduleResources =
function _scheduleResources(task) {
  var _this = this;
  var worker;

  if (task.type === 'PRODUCING' && task.session.options.resources) {
    worker = _this.master.getNextCachedWorker(task.session.name);
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
          tokens[resource.type] = _this.master.getResourceToken(resource.type);
        }
      }

      task.tokens = tokens;
    }
  }

  return task;
};

QueueScheduler.prototype.updateWorkers = function updateWorkers() {
  var _this = this;

  // Generate object with workers included in the scheduler
  var included = {};

  Object.keys(_this.usedWorkers).map(function(workerName) {
    included[workerName] = true;
  });

  _this.unusedWorkers.map(function(workerName) {
    included[workerName] = true;
  });

  // Add workers that are not included in the scheduler
  Object.keys(_this.master.getWorkers()).map(function(workerName) {
    if (!included[workerName]) {
      _this.unusedWorkers.push(workerName);
    }
  });

  // Remove workers that are included in the scheduler but no longer exists
  Object.keys(_this.usedWorkers).map(function(workerName) {
    if (!_this.master.getWorkers()[workerName]) {
      delete _this.usedWorkers[workerName];
    }
  });

  _this.unusedWorkers = _this.unusedWorkers.filter(function(workerName) {
    return _this.master.getWorkers()[workerName];
  });
};

QueueScheduler.prototype.dispatchFinish = function dispatchFinish(info) {
  var _this = this;

  if (info.type === 'TASK') {
    _this.unusedWorkers.push(info.workerName);
    delete _this.usedWorkers[info.workerName];
    delete _this.waitingTasks[info.task.name];

    _this.schedule();
  }

  return;
};

module.exports = QueueScheduler;
