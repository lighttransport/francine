'use strict';

var Q = require('q');

var Executions = {};

Executions.createExecution = function createExecution(options, token) {
  var _this = this;

  if (!_this.sessions[options.sessionName]) {
    return { error: 'No such session exists! ' + options.sessionName };
  }

  var session = _this.sessions[options.sessionName];
  if (session.userName !== _this._getUserNameByToken(token)) {
    return {
      error: 'You are not allowed to create an execution for the session'
    };
  }

  if (session.running) {
    return { error: 'Session already has running execution.' };
  }
  session.running = true;

  session.tokens = _this._getTokensByToken(token);

  if (options.update) {
    session.updates.push(options.update);
  }

  var executionName = 'execution' + _this.getId();

  _this.log(
    'Master',
    'Execution ' + executionName + ' created. ' +
    'parallel = ' + options.parallel);

  session.executionNames.push(executionName);

  var execution = {
    name: executionName,
    sessionName: options.sessionName,
    parallel: options.parallel,
    tasks: [],
    time: {
      fetching: 0,
      producing: 0,
      reducing: 0,
      total: 0
    },
    progress: 0
  };

  _this.executions[executionName] = execution;

  return {
    execution: _this.getExecution(executionName, token),
    reduced: _this._queueTasksForExecution(executionName)
  };
};

Executions._queueTasksForExecution =
function _queueTasksForExecution(executionName) {
  var _this = this;
  var d = Q.defer();

  var execution = _this.executions[executionName];
  var session = _this.sessions[execution.sessionName];
  var startTime = Date.now();

  //
  // Francine will perform producing and reducing in these steps:
  //
  //   [] [] [] []   Producers
  //    \ /   \ /
  //     []   []     Medium reducers
  //      \  /
  //       []        Final reducers
  //
  // An execution has four states:
  //
  //  [ Producing & Medium reducing ] <--> [ Final reducing ]
  //              |                                |
  //              v                                v
  //     [ Execution failed ]             [ Execution finished ]
  //

  ////// Variables used for fault-tolerant queueing
  // numProducingTarget = numProducingInQueue + numProducingFinished

  // Target number of producing tasks
  var numProducingTarget = execution.parallel;

  // Number of producing tasks currently in the queue
  var numProducingInQueue = 0;

  // Number of producing tasks that are finished
  // including failed tasks
  var numProducingFinished = 0;

  // Number of producing tasks that are failed
  var numProducingFailed = 0;
  var lastProducingError;

  // Task informations that are waiting for reducing
  var waitingForReducing = [];

  // Number of medium reducing tasks currently in the queue
  var numMediumReducingInQueue = 0;

  // Medium reducing task informations
  var mediumReduced = [];

  var isInFinalReducing = false;

  var totalProducingTime = 0;

  ////// Semi-constants
  // Number of producing tasks in one reducing unit (does not change)
  var reducingUnit = Math.max(Math.floor(Math.sqrt(execution.parallel)), 1);

  // Threshold of producing tasks that francine considers
  // the whole execution is failed
  var producingFailLimit = Math.max(Math.floor(execution.parallel * 0.1), 1);

  var defaultProducingTimeout = 120 * 1000;

  function run() {
    /*
    _this.log('Master',
      ' pTarget: ' + numProducingTarget +
      ' pInQ: ' + numProducingInQueue +
      ' pFin: ' + numProducingFinished +
      ' pFail: ' + numProducingFailed +
      ' mrInQ: ' + numMediumReducingInQueue +
      ' mr: ' + mediumReduced.length +
      ' fin: ' + isInFinalReducing);
    */
    if (numProducingFailed >= producingFailLimit) {
      d.reject(lastProducingError);
      return;
    }

    /*
    _this.log('Master',
      (numProducingTarget === numProducingFinished) +
      ' ' + (numProducingInQueue === 0) +
      ' ' + (waitingForReducing.length === 0) +
      ' ' + (numMediumReducingInQueue === 0));
    */
    if (numProducingTarget === numProducingFinished &&
        numProducingInQueue === 0 &&
        waitingForReducing.length === 0 &&
        numMediumReducingInQueue === 0) {
      // Execution is in Final Reducing state
      queueFinalReducingTask(3);
      return;
    }

    // Execution is in Producing & Medium Reducing state

    var tasksToQueue =
      numProducingTarget - numProducingInQueue - numProducingFinished;
    // _this.log('Master', 'tasksToQueue: ' + tasksToQueue);

    // Enqueue producing tasks if necessary
    if (tasksToQueue > 0) {
      if (!_this.hasCachedWorker(execution.sessionName)) {
        tasksToQueue = 1;
      }

      for (var i = 0; i < tasksToQueue; i++) {
        queueProducingTask();
      }
      _this.scheduler.schedule();
    }

    // Enqueue medium reducing task if
    //   * finished producing tasks more than reducing unit are waiting
    //   * all the producing tasks are finished but reducing task is remaining
    if (waitingForReducing.length >= reducingUnit ||
        (waitingForReducing.length > 0 &&
         numProducingTarget === numProducingFinished &&
         isInFinalReducing === false)) {
      // It retries three times by itself.
      // If all of them again fail, it reschedules producing tasks.
      // schedule() is called inside the function.
      queueMediumReducingTask(waitingForReducing, 3);
      waitingForReducing = [];
    }
  }

  var unique = 0;
  function queueProducingTask() {
    unique++;

    var taskName = _this.createProducingTask(
      session, execution, unique);

    numProducingInQueue++;

    var timeout;
    if (numProducingFinished === 0) {
      timeout = defaultProducingTimeout;
    } else {
      timeout = Math.floor(totalProducingTime / numProducingFinished * 2);
    }

    _this.setTaskTimeout(taskName, timeout);
    _this.delayUntilFinishFetching(taskName)
    .then(function fetchingFinished() {
      run();
    });

    _this.delayUntilFinishTask(taskName)
    .then(function producingTaskFinished(info) {
      numProducingFinished++;
      numProducingInQueue--;

      waitingForReducing.push(info);

      run();
    }, function producingTaskFailed(error) {
      numProducingFinished++;
      numProducingInQueue--;

      // Increase producing target to fill the failure
      numProducingTarget++;

      numProducingFailed++;

      lastProducingError = error;

      // _this.log('Master', 'Producing task failed: ' + error);

      run();
    });
  }

  function queueMediumReducingTask(current, retry) {
    var taskName = _this.createReducingTask(
      session, execution, current);
    _this.scheduler.schedule();

    numMediumReducingInQueue++;

    _this.setTaskTimeout(taskName);
    _this.delayUntilFinishTask(taskName)
    .then(function mediumReducingTaskFinished(info) {
      numMediumReducingInQueue--;

      mediumReduced.push(info);

      // Produce missing weights again
      numProducingTarget += (current.length - info.weight);

      run();
    }, function mediumReducingTaskFailed() {
      numMediumReducingInQueue--;

      // _this.log('Master', 'Medium reducing task failed: ' + error);

      retry--;
      if (retry > 0) {
        // Retry the medium reducing until the retry limit
        // _this.log('Master', 'Medium reducing retrying...');
        queueMediumReducingTask(current, retry);
      } else {
        // Produce all the missing weights again
        numProducingTarget += current.length;

        run();
      }
    });
  }

  function queueFinalReducingTask(retry) {
    _this.log('Master', 'Final Reducing Task queued!');
    var taskName = _this.createReducingTask(
      session, execution, mediumReduced);
    _this.scheduler.schedule();

    isInFinalReducing = true;

    _this.setTaskTimeout(taskName);
    _this.delayUntilFinishTask(taskName)
    .then(function finalReducingTaskFinished(info) {
      _this.log('Master', 'Final Reducing Task finished!');
      isInFinalReducing = false;

      var targetWeight = 0;
      for (var i = 0; i < mediumReduced.length; i++) {
        targetWeight += mediumReduced[i].weight;
      }

      if (targetWeight > info.weight) {
        // Produce missing weights again
        numProducingTarget += targetWeight - info.weight;

        run();
      } else {
        execution.time.total = Date.now() - startTime;
        execution.last = info;

        _this.log('Master', 'Execution ' + execution.name + ' finished; ' +
            'fetching: ' + execution.time.fetching + 'ms ' +
            'producing: ' + execution.time.producing + 'ms ' +
            'reducing: ' + execution.time.reducing + 'ms ' +
            'total: ' + execution.time.total + 'ms');

        session.running = false;

        d.resolve(info);
      }
    }, function finalReducingTaskFailed(error) {
      _this.log('Master', 'Final Reducing Task failed!');
      isInFinalReducing = false;

      // _this.log('Master', 'Final reducing task failed: ' + error);

      retry--;
      if (retry > 0) {
        queueFinalReducingTask(retry);
      } else {
        d.reject(error);
      }
    });
  }

  run();

  return d.promise;
};

Executions.delayUntilFinishTask =
function delayUntilFinishTask(taskName) {
  var _this = this;
  var d = Q.defer();
  _this.finishTaskDefers[taskName] = d;
  return d.promise;
};

Executions.delayUntilFinishFetching =
function delayUntilFinishFetching(taskName) {
  var _this = this;
  var d = Q.defer();
  _this.finishFetchingDefers[taskName] = d;
  return d.promise;
};

Executions.resolveFinishTask = function resolveFinishTask(info) {
  var _this = this;

  var d = _this.finishTaskDefers[info.task.name];
  delete _this.finishTaskDefers[info.task.name];
  if (d) {
    d.resolve(info);
  }
};

Executions.resolveFinishFetching = function resolveFinishFetching(info) {
  var _this = this;

  var d = _this.finishFetchingDefers[info.taskName];
  delete _this.finishFetchingDefers[info.taskName];
  if (d) {
    d.resolve(info);
  }
};

Executions.resolveFailed = function resolveFailed(info) {
  var _this = this;

  var taskName = info.taskName;
  var reason = info.reason;

  var d;
  if (_this.finishFetchingDefers[taskName]) {
    d = _this.finishFetchingDefers[taskName];
    delete _this.finishFetchingDefers[taskName];

    _this.log('Master', 'Fetching ' + taskName + ' failed: ' + reason);

    d.reject('Fetching ' + taskName + ' failed: ' + reason);
  }

  if (_this.finishTaskDefers[taskName]) {
    d = _this.finishTaskDefers[taskName];
    delete _this.finishTaskDefers[taskName];

    _this.log('Master', 'Task ' + taskName + ' failed: ' + reason);

    d.reject('Task ' + taskName + ' failed: ' + reason);
  }
};

Executions.setTaskTimeout = function setTaskTimeout(taskName, timeout) {
  var _this = this;

  _this.taskTimeouts[taskName] = timeout || 10 * 1000;
};

Executions.clearTaskTimeout = function clearTaskTimeout(taskName) {
  var _this = this;

  if (_this.taskTimeoutIDs[taskName]) {
    clearTimeout(_this.taskTimeoutIDs[taskName]);
    delete _this.taskTimeoutIDs[taskName];
  }
};

module.exports = Executions;
