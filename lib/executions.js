'use strict';

var Q = require('q');

var Executions = {};

Executions.createExecution = function createExecution(options, token) {
  // TODO(peryaudo): timeouts should not be used
  //                 until proper error recovery is implemented
  // TODO(peryaudo): delete dead defers

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

  var startTime = Date.now();

  var initialProducingTaskName = _this.scheduler.createProducingTask(
      session, execution, 1);
  // _this.setTaskTimeout(initialProducingTaskName);
  _this.scheduler.schedule();

  var timeout;

  var p = _this.delayUntilFinishFetching(initialProducingTaskName)
  .then(function() {
    var producingTaskNames = [initialProducingTaskName];
    for (var i = 1; i < execution.parallel; i++) {
      producingTaskNames.push(
          _this.scheduler.createProducingTask(session, execution, i + 1));
    }
    _this.scheduler.schedule();

    // Set default timeouts
    // producingTaskNames.map(function(producingTaskName) {
    //   _this.setTaskTimeout(producingTaskName);
    // });

    var producingTasks = producingTaskNames.map(function(producingTaskName) {
      return _this.delayUntilFinishTask(producingTaskName)
      .then(function(info) {
        // Set timeouts of other tasks if there is no finished tasks yet
        if (!timeout) {
          timeout = info.elapsedTime * 2;
          // producingTaskNames.map(function(producingTaskName) {
          //   _this.setTaskTimeout(producingTaskName, timeout);
          // });
        }
        var d = Q.defer();
        d.resolve(info);
        return d.promise;
      });
    });

    // Do two layer reducing iff. the number of producing tasks is more than 4
    if (producingTasks.length <= 4) {
      return Q.all(producingTasks);
    } else {
      return _this._createIntermediateReducing(
          session, execution, producingTasks);
    }
  })
  .then(function(producings) {
    var reducingTaskName = _this.scheduler.createReducingTask(
        session, execution, producings);
    // _this.setTaskTimeout(reducingTaskName);
    _this.scheduler.schedule();
    return _this.delayUntilFinishTask(reducingTaskName);
  })
  .then(function(reducing) {
    var d = Q.defer();
    _this.executions[executionName].time.total = Date.now() - startTime;
    _this.executions[executionName].last = reducing;
    _this.log('Master', 'Execution ' + execution.name + ' finished; ' +
        'fetching: ' + execution.time.fetching + 'ms ' +
        'producing: ' + execution.time.producing + 'ms ' +
        'reducing: ' + execution.time.reducing + 'ms ' +
        'total: ' + execution.time.total + 'ms');
    session.running = false;
    d.resolve(reducing);
    return d.promise;
  }, function(error) {
    _this.executions[executionName].error = error;
    session.running = false;
    return error;
  });

  return {
    execution: _this.getExecution(executionName, token),
    reduced: p
  };
};

Executions._createIntermediateReducing = function _createIntermediateReducing(
    session, execution, producingTaskPromises) {
  var _this = this;
  var d = Q.defer();

  var reducingUnit = Math.sqrt(producingTaskPromises.length) | 0;
  var currentUnit = 0;
  var produceds = [];

  var totalProduced = producingTaskPromises.length;
  var currentProduced = 0;

  var reducingPromises = [];

  var producingFinished = function producingFinished(producing) {
    ++currentUnit;
    ++currentProduced;

    produceds.push(producing);

    if (currentUnit === reducingUnit || currentProduced === totalProduced) {
      var reducingTaskName = _this.scheduler.createReducingTask(
          session, execution, produceds);
      reducingPromises.push(_this.delayUntilFinishTask(reducingTaskName));
      // _this.setTaskTimeout(reducingTaskName);

      _this.scheduler.schedule();
      produceds = [];
      currentUnit = 0;
    }

    if (currentProduced === totalProduced) {
      Q.all(reducingPromises).then(function(reducings) {
        d.resolve(reducings);
      }, function(error) {
        d.reject(error);
      });
    }
  };

  producingTaskPromises.map(function(producingTaskPromise) {
    producingTaskPromise.then(producingFinished, function(error) {
      d.reject(error);
    });
  });

  return d.promise;
};

module.exports = Executions;
