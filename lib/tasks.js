'use strict';

var concatObject = require('./concat');

var Tasks = {};

Tasks.runTask = function runTask(workerName, task) {
  var _this = this;

  _this.lastTaskRequestTime = Date.now();

  var worker = _this.workers[workerName];

  if (_this.taskTimeouts[task.name]) {
    var timeout = _this.taskTimeouts[task.name];
    _this.taskTimeoutIDs[task.name] = setTimeout(function() {
      // Remove the worker from the worker list until next ping/pong
      _this._removeWorker(workerName);
      _this.scheduler.updateWorkers();

      _this._dispatchFailed({ taskName: task.name, reason: 'timeout' });
    }, timeout);
  }

  _this.connectToWorker(worker);
  worker.client.run(task, function() {
  });
};

Tasks.createProducingTask =
function createProducingTask(session, execution, seed) {
  var taskName = 'task' + this.getId();

  this.scheduler.createTask({
    name: taskName,
    type: 'PRODUCING',
    session: session,
    execution: execution,
    tokens: {},
    seed: seed
  });

  return taskName;
};

Tasks.createReducingTask =
function createReducingTask(session, execution, producings) {
  var _this = this;

  var taskName = 'task' + _this.getId();

  execution = concatObject({}, execution);

  execution.tasks = producings.map(function(producing) {
    var worker = _this.getWorkers()[producing.workerName];
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

  _this.scheduler.createTask({
    name: taskName,
    type: 'REDUCING',
    session: session,
    execution: execution
  });

  return taskName;
};

module.exports = Tasks;
