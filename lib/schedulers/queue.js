'use strict';

var concatObject = require('../concat');

function QueueScheduler(master, instance) {
  this.master = master;
  this.instance = instance;

  this.queuedTasks = [];
  this.waitingTasks = {};

  this.unusedWorkers = [];
  this.usedWorkers = {};

  this.stateChangeCallback = null;
}

QueueScheduler.prototype.createProducingTask =
function createProducingTask(session, execution, seed) {
  var taskName = 'task' + this.master.getId();

  this.queuedTasks.push({
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
      weight: producing.weight,
      worker: {
        host: worker.host,
        port: worker.port,
        resourcePort: worker.resourcePort
      }
    };
  });

  // Scheudle reducing task prior to all the producing tasks
  _this.queuedTasks.unshift({
    name: taskName,
    type: 'REDUCING',
    session: session,
    execution: execution
  });

  return taskName;
};

QueueScheduler.prototype.schedule = function schedule() {
  if (this.queuedTasks.length === 0 || this.unusedWorkers.length === 0) {
    this._notifyStateChange();
    return;
  }

  // Simply pick up the earliest task in the queue
  var task = this.queuedTasks.shift();

  // Simply pick up an unused worker
  var workerName = this.unusedWorkers.shift();

  task = this._scheduleResources(task);

  this.waitingTasks[task.name] = task;
  this.usedWorkers[workerName] = task.type;

  this.master.runTask(workerName, task);

  this.schedule();
};

QueueScheduler.prototype.logStatus = function logStatus() {
  this.master.log('QueueScheduler',
      this.queuedTasks.length + ' tasks waiting, ' +
      Object.keys(this.waitingTasks).length + ' tasks running, ' +
      this.unusedWorkers.length + ' / ' +
      (this.unusedWorkers.length + Object.keys(this.usedWorkers).length) +
      ' workers free');
};

QueueScheduler.prototype._scheduleResources =
function _scheduleResources(task) {
  var worker;

  if (task.type === 'PRODUCING' && task.session.resources) {
    worker = this.master.getNextCachedWorker(task.session.name);
    if (worker) {
      /**
       * If there is a worker that already have the session resources,
       * then use them.
       * Otherwise, retrieve them from external services.
       */
      task.source = {
        host: worker.host,
        port: worker.port,
        resourcePort: worker.resourcePort
      };
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
  if (info.type === 'TASK') {
    this.unusedWorkers.push(info.workerName);
    delete this.usedWorkers[info.workerName];
    delete this.waitingTasks[info.task.name];

    this.schedule();
  }
};

QueueScheduler.prototype.dispatchFailed = function dispatchFailed(info) {
  if (info.workerName) {
    this.unusedWorkers.push(info.workerName);
    delete this.usedWorkers[info.workerName];
  }

  delete this.waitingTasks[info.taskName];

  this.schedule();
};

QueueScheduler.prototype.onStateChange = function onStateChange(fn) {
  this.stateChangeCallback = fn;
};

QueueScheduler.prototype.getCurrentState = function getCurrentState() {
  var workers = {};
  for (var i = 0; i < this.unusedWorkers.length; ++i) {
    workers[this.unusedWorkers[i]] = 'UNUSED';
  }

  for (var key in this.usedWorkers) {
    if (this.usedWorkers.hasOwnProperty(key)) {
      workers[key] = this.usedWorkers[key];
    }
  }

  return {
    workers: Object.keys(workers).sort().map(function(key) {
      return workers[key];
    })
  };
};

QueueScheduler.prototype._notifyStateChange = function _notifyStateChange() {
  this.stateChangeCallback(this.getCurrentState());
};

module.exports = QueueScheduler;
