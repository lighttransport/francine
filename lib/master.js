'use strict';

var Q = require('q');
var fs = require('fs');
var request = require('request');
var jsonrpc = require('multitransport-jsonrpc');

var JsonRpcServer = jsonrpc.server;
var JsonRpcServerTcp = jsonrpc.transports.server.tcp;
var JsonRpcClient = jsonrpc.client;
var JsonRpcClientTcp = jsonrpc.transports.client.tcp;

var jsonwebtoken = require('jsonwebtoken');

var LocalInstance = require('./instances/local');
var GceInstance = require('./instances/gce');
var StaticInstanceManager = require('./instance_managers/static');
var QueueScheduler = require('./schedulers/queue');

var DropboxResource = require('./resources/dropbox');

var initializeRestApi = require('./apis/rest');
var initializeDashboard = require('./dashboard/dashboard');

function Master(argv) {
  var _this = this;

  _this.instanceType = argv.instanceType || 'local';

  _this.restPort = argv.restPort || 3000;
  _this.port = argv.port || 5000;
  _this.dashboardPort = argv.dashboardPort || 4000;
  _this.instanceManagerType = argv.instanceManagerType || 'static';
  _this.schedulerType = argv.schedulerType || 'queue';
  _this.test = argv.test;

  _this.manageInterval = 15 * 1000;
  _this.waitingPongTimeout = 4;
  _this.statusInterval = 10 * 1000;

  _this.instance = null;

  if (argv.test) {
    _this.manageInterval = 5 * 1000;
    _this.statusInterval = 2 * 1000;

    _this.staticInstanceSize = 8;
  }

  _this.instanceManager = null;

  _this.scheduler = null;

  _this.rpcServer = null;

  _this.app = null;

  _this.master = null;
  _this.workers = {};
  _this.unrecognizedWorkers = {};
  _this.waitingPong = {};

  _this.finishTaskDefers = {};
  _this.finishFetchingDefers = {};
  _this.seed = 0;

  _this.configs = {};
  _this.resources = null;

  _this.sessions = {};
  _this.executions = {};

  _this.users = {};

  _this.taskTimeouts = {};
  _this.taskTimeoutIDs = {};
}

Master.prototype.start = function start() {
  var _this = this;

  var francinerc = (process.env.HOME || '/root') + '/.francinerc';
  if (fs.existsSync(francinerc)) {
    _this.configs = JSON.parse(
        fs.readFileSync(francinerc, { encoding: 'utf-8' }));
    _this.log('Master', 'Read configuration form ' + francinerc);

    _this.staticInstanceSize = _this.staticInstanceSize ||
      _this.configs.staticInstanceSize;

    if (_this.configs.users) {
      for (var userName in _this.configs.users) {
        if (_this.configs.users.hasOwnProperty(userName)) {
          _this.users[userName] = {
            password: _this.configs.users[userName],
            tokens: {}
          };
        }
      }
    }

    _this.privateKey = _this.configs.privateKey;
  } else {
    _this.log('Master', 'No .fracinerc available at ' + francinerc);
  }

  // Initialize instance type specific object
  _this._initializeInstance();

  // Initialize instance manager
  _this._initializeInstanceManager();

  // Initialize scheduler
  _this._initializeScheduler();

  // Initialize RPC
  _this._initializeRpc();

  // Initialize REST API
  _this._initializeRestApi();

  // Initialize web dashboard
  _this._initializeDashboard();

  // Initialize resources
  _this._initializeResources();

  _this.loop(_this.manageInterval, function() {
    return _this.instance.getInstances()
    .then(function(instances) {
      return _this.manageWorkers(instances);
    })
    .then(function() {
      return _this.instanceManager.manage();
    });
  }).done();

  setInterval(function() {
    _this.logStatus();
    _this.scheduler.logStatus();
  }, _this.statusInterval);

  process.on('uncaughtException', function(error) {
    _this.log('Master', error.stack || error);
    process.exit(1);
  });
};

Master.prototype.loop = function loop(interval, f) {
  return Q().then(function l() { // jshint ignore:line
    return f().delay(interval).then(l);
  });
};

/**
 * Getters
 */

Master.prototype.getClusterInfo = function getClusterInfo() {
  return {
    instanceType: this.instanceType,
    instanceManagerType: this.instanceManagerType,
    staticInstanceSize: this.staticInstanceSize,
    schedulerType: this.schedulerType
  };
};

Master.prototype.getPort = function getPort() {
  return this.port;
};

Master.prototype.getRestPort = function getRestPort() {
  return this.restPort;
};

Master.prototype.getDashboardPort = function getDashboardPort() {
  return this.dashboardPort;
};

Master.prototype.getMaster = function getMaster() {
  return this.master;
};

Master.prototype.getWorkers = function getWorkers() {
  return this.workers;
};

Master.prototype.getId = function getId() {
  this.seed++;
  return (Date.now() | 0) + '-' + this.seed;
};

Master.prototype.getSession = function getSession(sessionName, token) {
  var session = this.sessions[sessionName];
  if (!session) {
    return { error: 'session not found' };
  }

  if (session.userName !== this._getUserNameByToken(token)) {
    return { error: 'you are not allowed to see this session.' };
  }

  return session;
};

Master.prototype.getExecution = function getExecution(executionName, token) {
  var execution = this.executions[executionName];

  if (!execution) {
    return { error: 'execution not found' };
  }

  if (this.sessions[execution.sessionName].userName !==
      this._getUserNameByToken(token)) {
    return { error: 'you are not allowed to see this execution.' };
  }

  return {
    name: execution.name,
    sessionName: execution.sessionName,
    time: execution.time,
    progress: execution.progress,
    error: execution.error,
    finished: (execution.last || execution.error) ? true : false
  };
};

Master.prototype.getNextCachedWorker =
function getNextCachedWorker(sessionName) {
  var _this = this;

  if (!_this.sessions[sessionName] ||
      !_this.sessions[sessionName].cachedWorkers.length) {
    return null;
  }

  // Take a worker with the session resources from top and shift it back.
  var workerName = _this.sessions[sessionName].cachedWorkers.pop();
  _this.sessions[sessionName].cachedWorkers.unshift(workerName);

  return _this.workers[workerName];
};

Master.prototype.getCurrentState = function getCurrentState() {
  return this.scheduler.getCurrentState();
};

Master.prototype.onStateChange = function onStateChange(fn) {
  return this.scheduler.onStateChange(fn);
};

/**
 * Logger
 */

Master.prototype.log = function log(from, message) {
  console.log('Francine: ' + from + ': ' + message);
};

Master.prototype.logStatus = function logStatus() {
  var _this = this;
  _this.log(
      'Master',
      'Sessions: ' + Object.keys(_this.sessions).length +
      ' Executions: ' + Object.keys(_this.executions).length +
      ' Timeouts: ' + Object.keys(_this.taskTimeoutIDs).length);
};

/**
 * Initializers
 */

Master.prototype._initializeInstance = function _initializeInstance() {
  var _this = this;

  switch (_this.instanceType) {
    case 'local':
      _this.instance = new LocalInstance(_this);
      break;
    case 'gce':
      _this.instance = new GceInstance(_this, _this.configs);
      break;
  }

  if (!_this.instance) {
    _this.log(
        'Master',
        'Error: Invalid worker instance type ' + _this.instanceType);
    process.exit(1);
  }

  _this.log('Master', 'Worker instance type: ' + _this.instanceType);
};

Master.prototype._initializeInstanceManager =
function _initializeInstanceManager() {
  var _this = this;

  switch (_this.instanceManagerType) {
    case 'static':
      _this.instanceManager = new StaticInstanceManager(
          _this, _this.staticInstanceSize || 8);
      break;
  }

  if (!_this.instanceManager) {
    _this.log(
        'Master',
        'Error: Invalid instance manager type ' + _this.instanceManagerType);
    process.exit(1);
  }

  _this.log('Master', 'Instance manager type: ' + _this.instanceManagerType);
};

Master.prototype._initializeRpc = function _initializeRpc() {
  var _this = this;

  _this.log(
      'Master',
      'Waiting on port ' + _this.port + ' for JSON RPC request...');

  _this.rpcServer = new JsonRpcServer(new JsonRpcServerTcp(_this.port), {
    pong: function pong(info, callback) {
      // _this.log('Master', 'Pong received from ' + info.workerName);
      _this.dispatchPong(info);
      callback(null, {});
    },
    finish: function finish(info, callback) {
      // _this.log('Master', 'Finish received from ' + info.workerName);
      _this._dispatchFinish(info);
      callback(null, {});
    },
    failed: function failed(info, callback) {
      _this._dispatchFailed(info);
      callback(null, {});
    }
  });
};

Master.prototype._initializeScheduler = function _initializeScheduler() {
  var _this = this;

  switch (_this.schedulerType) {
    case 'queue':
      _this.scheduler = new QueueScheduler(_this, _this.instance);
      break;
  }

  if (!_this.scheduler) {
    _this.log('Master', 'Error: invalid scheduler type ' + _this.schedulerType);
    process.exit(1);
  }

  _this.log('Master', 'Scheduler type: ' + _this.schedulerType);
};

Master.prototype._initializeRestApi = function _initializeRestApi() {
  this.app = initializeRestApi(this);
};

Master.prototype._initializeDashboard = function _initializeDashboard() {
  initializeDashboard(this);
};

Master.prototype._initializeResources = function _initializeResources() {
  this.resources = {};
  this.resources.dropbox = new DropboxResource();
  this.resources.dropbox.initializeInMaster(this, this.configs.dropbox);
};

/**
 * Ping / Pong and worker management
 */

Master.prototype.resizeWorkers = function resizeWorkers(size) {
  var _this = this;
  return _this.instance.resize(size);
};

Master.prototype.manageWorkers = function manageWorkers(instances) {
  var _this = this;

  var d = Q.defer();

  _this.master = instances.master;
  _this.unrecognizedWorkers = instances.workers;

  if (!_this.master) {
    d.resolve();
    return d.promise;
  }

  // Remove recognized workers that no longer exist
  Object.keys(_this.workers).map(function(recognizedWorkerName) {
    if (!instances.workers[recognizedWorkerName]) {
      delete _this.workers[recognizedWorkerName];

      // Delete the worker from the cached workers list of each session
      var filter = function filter(cachedWorkerName) {
        return cachedWorkerName !== recognizedWorkerName;
      };

      for (var sessionName in _this.sessions) {
        if (_this.sessions.hasOwnProperty(sessionName)) {
          var session = _this.sessions[sessionName];
          if (session.cachedWorkers.indexOf(recognizedWorkerName) >= 0) {
            session.cachedWorkers.filter(filter);
          }
        }
      }
    }
  });
  Object.keys(_this.waitingPong).map(function(recognizedWorkerName) {
    if (!instances.workers[recognizedWorkerName]) {
      delete _this.waitingPong[recognizedWorkerName];
    }
  });

  /**
   * Recognized instances that failed to reply pings within timeout
   * should be destroyed
   */
  var destroyed = [];
  for (var workerName in _this.waitingPong) {
    if (_this.waitingPong.hasOwnProperty(workerName)) {
      var count = _this.waitingPong[workerName];
      if (count >= _this.waitingPongTimeout) {
        delete instances.workers[workerName];
        destroyed.push(workerName);
        /**
         * This instance will be terminated,
         * so neither send ping nor dispatch pong
         */
        _this.waitingPong[workerName] = -1;
      }
    }
  }

  if (destroyed.length) {
    _this.instance.destroy(destroyed);
  }

  // Ping to recognized workers
  for (var key in _this.workers) {
    if (_this.workers.hasOwnProperty(key)) {
      var worker = _this.workers[key];
      _this.sendPing(worker);
    }
  }

  // Ping to unrecognized workers
  Object.keys(instances.workers).map(function(unrecognizedWorkerName) {
    if (!_this.workers[unrecognizedWorkerName]) {
      _this.sendPing(instances.workers[unrecognizedWorkerName]);
    }
  });

  _this.scheduler.updateWorkers();
  _this.scheduler.schedule();

  d.resolve();
  return d.promise;
};

Master.prototype.sendPing = function sendPing(worker) {
  var _this = this;

  if (_this.waitingPong[worker.name] && _this.waitingPong[worker.name] < 0) {
    return;
  }

  _this.waitingPong[worker.name] = _this.waitingPong[worker.name] || 0;
  _this.waitingPong[worker.name]++;

  var client = new JsonRpcClient(
      new JsonRpcClientTcp(
        worker.host,
        worker.port,
        { timeout: 10, retries: 0 }));
  client.register('ping');
  client.ping({
    workerName: worker.name,
    master: _this.getMaster()
  }, function() {
    client.shutdown();
  });
};

Master.prototype.dispatchPong = function dispatchPong(info) {
  var _this = this;

  if (_this.waitingPong[info.workerName] &&
      _this.waitingPong[info.workerName] >= 0) {
    _this.waitingPong[info.workerName] =
      Math.max(_this.waitingPong[info.workerName] - 1, 0);
  }

  if (!_this.workers[info.workerName] &&
      _this.unrecognizedWorkers[info.workerName]) {
    _this.workers[info.workerName] =
      _this.unrecognizedWorkers[info.workerName];

    _this.scheduler.updateWorkers();
    _this.scheduler.schedule();
  }

  _this._appendCachedWorker(info.workerName, info.cachedSessions);

  info.logs.map(function(message) {
    _this.log('[' + info.workerName + '] ' + message.from, message.message);
  });
};

/**
 * Tasks
 */

Master.prototype.runTask = function runTask(workerName, task) {
  var _this = this;

  var worker = _this.workers[workerName];

  if (_this.taskTimeouts[task.name]) {
    var timeout = _this.taskTimeouts[task.name];
    _this.taskTimeoutIDs[task.name] = setTimeout(function() {
      _this._dispatchFailed({ taskName: task.name, reason: 'timeout' });
    }, timeout);
  }

  var client = new JsonRpcClient(
      new JsonRpcClientTcp(
        worker.host,
        worker.port,
        { timeout: 10, retries: 0 }));
  client.register('run');
  client.run(task, function() {
    client.shutdown();
  });
};

Master.prototype.delayUntilFinishTask =
function delayUntilFinishTask(taskName) {
  var _this = this;
  var d = Q.defer();
  _this.finishTaskDefers[taskName] = d;
  return d.promise;
  // TODO(peryaudo): write timeout
};

Master.prototype.delayUntilFinishFetching =
function delayUntilFinishFetching(taskName) {
  var _this = this;
  var d = Q.defer();
  _this.finishFetchingDefers[taskName] = d;
  return d.promise;
  // TODO(peryaudo): write timeout
};

Master.prototype.resolveFinishTask = function resolveFinishTask(info) {
  var _this = this;

  var d = _this.finishTaskDefers[info.task.name];
  delete _this.finishTaskDefers[info.task.name];
  if (d) {
    d.resolve(info);
  }
  // TODO(peryaudo): write error handling
};

Master.prototype.resolveFinishFetching = function resolveFinishFetching(info) {
  var _this = this;

  var d = _this.finishFetchingDefers[info.taskName];
  delete _this.finishFetchingDefers[info.taskName];
  if (d) {
    d.resolve(info);
  }
};

Master.prototype.setTaskTimeout = function setTaskTimeout(taskName, timeout) {
  var _this = this;

  if (_this.finishFetchingDefers[taskName] ||
      _this.finishTaskDefers[taskName]) {
    _this.taskTimeouts[taskName] = timeout || 10 * 1000;
  }
};

Master.prototype.clearTaskTimeout = function clearTaskTimeout(taskName) {
  var _this = this;

  if (_this.taskTimeoutIDs[taskName]) {
    clearTimeout(_this.taskTimeoutIDs[taskName]);
    delete _this.taskTimeoutIDs[taskName];
  }
};

/**
 * Finish management
 */

Master.prototype._dispatchFinish = function _dispatchFinish(info) {
  var _this = this;

  _this.scheduler.dispatchFinish(info);

  if (info.type === 'TASK') {
    if (_this.executions[info.task.execution.name]) {
      if (info.task.type === 'PRODUCING') {
        _this.executions[info.task.execution.name].time.producing +=
          info.elapsedTime;
        _this.executions[info.task.execution.name].progress++;
      } else if (info.task.type === 'REDUCING') {
        _this.executions[info.task.execution.name].time.reducing +=
          info.elapsedTime;
      }
    }

    _this.clearTaskTimeout(info.task.name);
    delete _this.taskTimeouts[info.task.name];

    _this.resolveFinishTask(info);
  } else if (info.type === 'FETCHING') {
    if (_this.executions[info.executionName]) {
      _this.executions[info.executionName].time.fetching += info.elapsedTime;
    }
    _this._appendCachedWorker(info.workerName, info.cachedSessions);

    _this.resolveFinishFetching(info);
  }
};

Master.prototype._dispatchFailed = function _dispatchFailed(info) {
  var _this = this;

  var taskName = info.taskName;
  var reason = info.reason;

  _this.clearTaskTimeout(info.taskName);

  if (!_this.scheduler.dispatchFailed(info)) {
    // Stopped retrying task

    _this.log('Master', '!!!! TASK FINALLY FAILED !!!');
    delete _this.taskTimeouts[info.taskName];

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
  }
};

/**
 * Session / Execution management
 */

Master.prototype.createSession = function createSession(options, token) {
  var sessionName = 'session' + this.getId();

  this.sessions[sessionName] = {
    name: sessionName,
    resources: options.resources,
    tokens: {},
    producer: options.producer,
    format: options.format,
    cachedWorkers: [],
    executionNames: [],
    updates: [],
    userName: this._getUserNameByToken(token),
    running: false
  };

  return this.getSession(sessionName, token);
};

Master.prototype.deleteSession = function deleteSession(sessionName, token) {
  var _this = this;

  if (!_this.sessions[sessionName]) {
    _this.log('Master', 'Deleting invalid session ' + sessionName);
    return { error: 'Deleting invalid session ' + sessionName };
  }

  if (_this.sessions[sessionName].userName !==
      _this._getUserNameByToken(token)) {
    _this.log('Master', 'You are not allowed to delete this session');
    return { error: 'You are not allowed to delete this session' };
  }

  _this.sessions[sessionName].executionNames.map(function(executionName) {
    delete _this.executions[executionName];
  });

  _this.sessions[sessionName].cachedWorkers.map(function(workerName) {
    _this._deleteSessionCache(workerName, sessionName);
  });

  delete _this.sessions[sessionName];

  return { success: true };
};

Master.prototype._appendCachedWorker =
function _appendCachedWorker(workerName, cachedSessionNames) {
  var _this = this;

  // TODO(peryaudo): these are inefficient

  cachedSessionNames.map(function(cachedSessionName) {
    if (!_this.sessions[cachedSessionName]) {
      return;
    }

    var session = _this.sessions[cachedSessionName];
    if (session.cachedWorkers.indexOf(workerName) < 0) {
      session.cachedWorkers.push(workerName);
    }
  });

  var included = {};
  cachedSessionNames.map(function(cachedSessionName) {
    included[cachedSessionName] = true;
  });

  var filter = function filter(cachedWorkerName) {
    return cachedWorkerName !== workerName;
  };

  for (var sessionName in _this.sessions) {
    if (_this.sessions.hasOwnProperty(sessionName)) {
      var session = _this.sessions[sessionName];
      if (!included[sessionName] &&
          session.cachedWorkers.indexOf(workerName) >= 0) {
        session.cachedWorkers.filter(filter);
      }
    }
  }
};

Master.prototype._deleteSessionCache =
function _deleteSessionCache(workerName, sessionName) {
  var _this = this;

  var worker = _this.workers[workerName];
  if (!worker) {
    _this.log('Master', 'deleteSessionCache from invalid worker ' + workerName);
    return;
  }

  // TODO(peryaudo): delete task result images

  var client = new JsonRpcClient(
      new JsonRpcClientTcp(
        worker.host,
        worker.port,
        { timeout: 10, retries: 0 }));
  client.register('deleteCache');
  client.deleteCache({
    sessionName: sessionName
  }, function() {
    client.shutdown();
  });
};

Master.prototype.createExecution = function createExecution(options, token) {
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

Master.prototype._createIntermediateReducing =
function _createIntermediateReducing(
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

/**
 * Receiving result
 */

Master.prototype.receive = function receive(workerName, taskName) {
  var _this = this;
  var d = Q.defer();

  var worker = _this.workers[workerName];

  // _this.master.log('Master', 'retrieving ...');

  request({
    uri: 'http://' + worker.host + ':' + worker.resourcePort +
      '/results/' + taskName,
    encoding: null
  }, function(error, response, body) {
    if (error) {
      _this.log('Master', error);
      d.reject(error);
    } else {
      // _this.master.log('Master', 'retrieving finished!');
      d.resolve(body);
    }
  });

  return d.promise;
};

Master.prototype.receiveExecutionResult =
function retrieveExecutionResult(executionName, token) {
  var _this = this;
  var d = Q.defer();

  var limitedExecution = _this.getExecution(executionName, token);
  if (limitedExecution.error) {
    d.resolve(limitedExecution);
    return d.promise;
  }

  var execution = _this.executions[executionName];

  if (!execution.last) {
    d.resolve({ error: 'The task is not yet finished' });
    return d.promise;
  }

  _this.receive(execution.last.workerName, execution.last.task.name)
  .then(function(image) {
    d.resolve({
      format: _this.sessions[execution.sessionName].format,
      image: image
    });
  }, function(error) {
    d.resolve({ error: error });
  });

  return d.promise;
};

/**
 * User authentication
 */

Master.prototype.authenticate = function authenticate(userName, password) {
  if (!this.privateKey) {
    this.log(
      'Master',
      'Authentication disabled because private key is not present');
    return {
      error: 'Authentication disabled because private key is not present'
    };
  }

  if (!userName || !password) {
    return { error: 'userName and password are required.' };
  }

  if (this.users[userName] && this.users[userName].password === password) {
    return {
      authToken:jsonwebtoken.sign({ userName: userName }, this.privateKey)
    };
  } else {
    return { error: 'Invalid userName or password.' };
  }
};

Master.prototype._getUserNameByToken = function _getUserNameByToken(authToken) {
  if (!this.privateKey) {
    this.log(
      'Master',
      'Authentication disabled because private key is not present');
    return;
  }

  try {
    return jsonwebtoken.verify(authToken, this.privateKey).userName;
  } catch (error) {
    return;
  }
};

Master.prototype._getTokensByToken = function _getTokensByToken(authToken) {
  var userName = this._getUserNameByToken(authToken);
  if (userName && this.users[userName]) {
    return this.users[userName].tokens;
  } else {
    return {};
  }
};

Master.prototype.registerResourceTokenByToken =
function registerResourceTokenByToken(resourceName, code, authToken) {
  var _this = this;
  var d = Q.defer();

  var userName = _this._getUserNameByToken(authToken);
  if (!userName || !_this.users[userName]) {
    d.resove({ error: 'invalid francine auth token' });
    return d.promise;
  }

  if (!_this.resources[resourceName]) {
    d.resolve({ error: 'invalid resource name' });
    return d.promise;
  }

  _this.resources[resourceName].generateResourceToken(code)
  .then(function(resourceToken) {
    _this.users[userName].tokens[resourceName] = resourceToken;
    d.resolve({ success: true });
  }, function(error) {
    d.resolve({ error: error });
  });

  return d.promise;
};

Master.prototype.getAuthorizeStatus =
function getAuthorizeStatus(resourceName, authToken) {
  var userName = this._getUserNameByToken(authToken);
  if (!userName || !this.users[userName]) {
    return { error: 'invalid francine auth token' };
  }

  if (!this.resources[resourceName]) {
    return { error: 'invalid resource name' };
  }

  return {
    authorizeUrl: this.resources[resourceName].getAuthorizeUrl(),
    authorized: this.users[userName].tokens[resourceName] ? true : false
  };
};

module.exports = Master;
